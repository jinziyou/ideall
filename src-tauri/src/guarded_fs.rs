use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_READ_BYTES: u64 = 32 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 16 * 1024 * 1024;
const MAX_IDENTITY_SCAN_ENTRIES: usize = 100_000;
const GRANTS_FILE_NAME: &str = "guarded-fs-grants.json";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredGrant {
    grant_id: String,
    root: PathBuf,
    stable_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardedFsGrant {
    grant_id: String,
    path: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardedFsEntry {
    name: String,
    relative_path: String,
    stable_id: String,
    kind: &'static str,
    size: u64,
    modified_at: Option<u64>,
    version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardedFsRead {
    base64: String,
    size: u64,
    version: String,
}

pub struct GuardedFsGrants {
    grants: RwLock<HashMap<String, StoredGrant>>,
    entry_paths: RwLock<HashMap<String, HashMap<String, PathBuf>>>,
    write_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    persistence_path: Option<PathBuf>,
}

pub fn init_state(app: &AppHandle) -> GuardedFsGrants {
    let persistence_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join(GRANTS_FILE_NAME));
    GuardedFsGrants::load(persistence_path)
}

impl GuardedFsGrants {
    fn load(persistence_path: Option<PathBuf>) -> Self {
        let stored = persistence_path
            .as_ref()
            .and_then(|path| fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Vec<StoredGrant>>(&bytes).ok())
            .unwrap_or_default();
        let grants = stored
            .into_iter()
            .filter(|grant| Uuid::parse_str(&grant.grant_id).is_ok())
            .filter(|grant| validate_stored_root(grant).is_ok())
            .map(|grant| (grant.grant_id.clone(), grant))
            .collect();
        Self {
            grants: RwLock::new(grants),
            entry_paths: RwLock::new(HashMap::new()),
            write_locks: Mutex::new(HashMap::new()),
            persistence_path,
        }
    }

    #[cfg(test)]
    fn for_test(root: &Path) -> (Self, String) {
        let root = canonical_directory(root).expect("test root must be available");
        let stable_id = stable_id(&fs::metadata(&root).unwrap(), &root).unwrap();
        let grant_id = Uuid::new_v4().to_string();
        let grant = StoredGrant {
            grant_id: grant_id.clone(),
            root,
            stable_id,
        };
        let mut grants = HashMap::new();
        grants.insert(grant_id.clone(), grant);
        (
            Self {
                grants: RwLock::new(grants),
                entry_paths: RwLock::new(HashMap::new()),
                write_locks: Mutex::new(HashMap::new()),
                persistence_path: None,
            },
            grant_id,
        )
    }

    fn grant_root(&self, grant_id: &str) -> Result<PathBuf, String> {
        if Uuid::parse_str(grant_id).is_err() {
            return Err("filesystem grant is invalid".into());
        }
        let grant = self
            .grants
            .read()
            .map_err(|_| "filesystem grant registry is unavailable".to_string())?
            .get(grant_id)
            .cloned()
            .ok_or_else(|| "filesystem grant is unavailable".to_string())?;
        validate_stored_root(&grant)
    }

    fn info(&self, grant_id: &str) -> Result<GuardedFsGrant, String> {
        let root = self.grant_root(grant_id)?;
        Ok(grant_response(grant_id.to_string(), root))
    }

    fn insert(&self, selected: &Path) -> Result<GuardedFsGrant, String> {
        let root = canonical_directory(selected)?;
        let metadata = fs::metadata(&root).map_err(|error| error.to_string())?;
        let root_stable_id = stable_id(&metadata, &root)?;
        let mut grants = self
            .grants
            .write()
            .map_err(|_| "filesystem grant registry is unavailable".to_string())?;
        if let Some(existing) = grants
            .values()
            .find(|grant| grant.root == root && grant.stable_id == root_stable_id)
            .cloned()
        {
            return Ok(grant_response(existing.grant_id, root));
        }
        let grant_id = Uuid::new_v4().to_string();
        let grant = StoredGrant {
            grant_id: grant_id.clone(),
            root: root.clone(),
            stable_id: root_stable_id,
        };
        let mut snapshot = grants.values().cloned().collect::<Vec<_>>();
        snapshot.push(grant.clone());
        self.persist(&snapshot)?;
        grants.insert(grant_id.clone(), grant);
        Ok(grant_response(grant_id, root))
    }

    fn revoke(&self, grant_id: &str) -> Result<bool, String> {
        let mut grants = self
            .grants
            .write()
            .map_err(|_| "filesystem grant registry is unavailable".to_string())?;
        if !grants.contains_key(grant_id) {
            return Ok(false);
        }
        let snapshot = grants
            .iter()
            .filter(|(id, _)| id.as_str() != grant_id)
            .map(|(_, grant)| grant.clone())
            .collect::<Vec<_>>();
        self.persist(&snapshot)?;
        grants.remove(grant_id);
        self.entry_paths
            .write()
            .map_err(|_| "filesystem entry cache is unavailable".to_string())?
            .remove(grant_id);
        let prefix = format!("{grant_id}\0");
        self.write_locks
            .lock()
            .map_err(|_| "filesystem write lock registry is unavailable".to_string())?
            .retain(|key, _| !key.starts_with(&prefix));
        Ok(true)
    }

    fn remember_entry(&self, grant_id: &str, entry_id: &str, path: &Path) -> Result<(), String> {
        self.entry_paths
            .write()
            .map_err(|_| "filesystem entry cache is unavailable".to_string())?
            .entry(grant_id.to_string())
            .or_default()
            .insert(entry_id.to_string(), path.to_path_buf());
        Ok(())
    }

    fn cached_entry(&self, grant_id: &str, entry_id: &str) -> Result<Option<PathBuf>, String> {
        Ok(self
            .entry_paths
            .read()
            .map_err(|_| "filesystem entry cache is unavailable".to_string())?
            .get(grant_id)
            .and_then(|entries| entries.get(entry_id))
            .cloned())
    }

    fn entry_write_lock(&self, grant_id: &str, entry_id: &str) -> Result<Arc<Mutex<()>>, String> {
        let key = format!("{grant_id}\0{entry_id}");
        Ok(self
            .write_locks
            .lock()
            .map_err(|_| "filesystem write lock registry is unavailable".to_string())?
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    fn persist(&self, grants: &[StoredGrant]) -> Result<(), String> {
        let Some(path) = &self.persistence_path else {
            return Ok(());
        };
        let parent = path
            .parent()
            .ok_or_else(|| "filesystem grant path is invalid".to_string())?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let bytes = serde_json::to_vec(grants).map_err(|error| error.to_string())?;
        let temporary = path.with_extension("json.tmp");
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        #[cfg(windows)]
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        fs::rename(temporary, path).map_err(|error| error.to_string())
    }
}

fn canonical_directory(root: &Path) -> Result<PathBuf, String> {
    let root =
        fs::canonicalize(root).map_err(|error| format!("invalid filesystem root: {error}"))?;
    if !root.is_dir() {
        return Err("filesystem root is not a directory".into());
    }
    Ok(root)
}

fn validate_stored_root(grant: &StoredGrant) -> Result<PathBuf, String> {
    let root = canonical_directory(&grant.root)?;
    if root != grant.root {
        return Err("filesystem grant root changed".into());
    }
    let metadata = fs::metadata(&root).map_err(|error| error.to_string())?;
    if stable_id(&metadata, &root)? != grant.stable_id {
        return Err("filesystem grant root changed".into());
    }
    Ok(root)
}

fn grant_response(grant_id: String, root: PathBuf) -> GuardedFsGrant {
    let name = root
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_text(&root));
    GuardedFsGrant {
        grant_id,
        path: path_text(&root),
        name,
    }
}

fn resolve_entry(
    grants: &GuardedFsGrants,
    grant_id: &str,
    entry_id: Option<&str>,
) -> Result<(PathBuf, PathBuf), String> {
    let root = grants.grant_root(grant_id)?;
    let Some(entry_id) = entry_id else {
        return Ok((root.clone(), root));
    };
    if entry_id.is_empty() || entry_id.len() > 200 {
        return Err("filesystem entry identity is invalid".into());
    }
    // Paths are cache hints only. Identity is rechecked after canonicalization; a rename falls
    // through to the bounded grant-local scan below without changing the frontend FileRef.
    if let Some(cached) = grants.cached_entry(grant_id, entry_id)? {
        if let Ok(canonical) = fs::canonicalize(cached) {
            if canonical.starts_with(&root) && !is_git_internal(&root, &canonical) {
                if let Ok(metadata) = fs::metadata(&canonical) {
                    if stable_id(&metadata, &canonical).as_deref() == Ok(entry_id) {
                        return Ok((root, canonical));
                    }
                }
            }
        }
    }
    let target = scan_for_entry(&root, entry_id)?
        .ok_or_else(|| "filesystem target is unavailable".to_string())?;
    grants.remember_entry(grant_id, entry_id, &target)?;
    Ok((root, target))
}

fn scan_for_entry(root: &Path, wanted: &str) -> Result<Option<PathBuf>, String> {
    let mut pending = vec![root.to_path_buf()];
    let mut visited_directories = std::collections::HashSet::new();
    let mut scanned = 0_usize;
    while let Some(directory) = pending.pop() {
        let directory_metadata = fs::metadata(&directory).map_err(|error| error.to_string())?;
        if !visited_directories.insert(stable_id(&directory_metadata, &directory)?) {
            continue;
        }
        for item in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            scanned += 1;
            if scanned > MAX_IDENTITY_SCAN_ENTRIES {
                return Err("filesystem identity scan limit exceeded".into());
            }
            let item = item.map_err(|error| error.to_string())?;
            if item.file_name() == ".git" {
                continue;
            }
            let canonical = match fs::canonicalize(item.path()) {
                Ok(path) if path.starts_with(root) => path,
                _ => continue,
            };
            if is_git_internal(root, &canonical) {
                continue;
            }
            let metadata = match fs::metadata(&canonical) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if stable_id(&metadata, &canonical)? == wanted {
                return Ok(Some(canonical));
            }
            if metadata.is_dir() {
                pending.push(canonical);
            }
        }
    }
    Ok(None)
}

fn modified_at(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn version(metadata: &fs::Metadata) -> String {
    let modified_nanos = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{modified_nanos}:{}", metadata.len())
}

#[cfg(unix)]
fn stable_id(metadata: &fs::Metadata, _path: &Path) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    Ok(format!("unix:{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(windows)]
fn stable_id_from_windows_handle(
    handle: windows::Win32::Foundation::HANDLE,
) -> Result<String, String> {
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(handle, &mut information) }
        .map_err(|error| error.to_string())?;
    let file_index =
        (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow);
    Ok(format!(
        "windows:{}:{file_index}",
        information.dwVolumeSerialNumber
    ))
}

#[cfg(windows)]
fn stable_id(_metadata: &fs::Metadata, path: &Path) -> Result<String, String> {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(once(0))
        .collect::<Vec<_>>();
    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    }
    .map_err(|error| error.to_string())?;
    let result = stable_id_from_windows_handle(handle);
    let _ = unsafe { CloseHandle(handle) };
    result
}

#[cfg(unix)]
fn stable_id_for_open_file(file: &fs::File, path: &Path) -> Result<String, String> {
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    stable_id(&metadata, path)
}

#[cfg(windows)]
fn stable_id_for_open_file(file: &fs::File, _path: &Path) -> Result<String, String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;

    stable_id_from_windows_handle(HANDLE(file.as_raw_handle()))
}

fn path_text(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    {
        if let Some(unc) = text.strip_prefix("//?/UNC/") {
            return format!("//{unc}");
        }
        if let Some(local) = text.strip_prefix("//?/") {
            return local.to_string();
        }
    }
    text
}

fn relative_to_root(root: &Path, target: &Path) -> Result<String, String> {
    target
        .strip_prefix(root)
        .map(path_text)
        .map_err(|_| "filesystem target escapes the granted root".to_string())
}

fn is_git_internal(root: &Path, target: &Path) -> bool {
    target
        .strip_prefix(root)
        .ok()
        .is_some_and(|relative| relative.components().any(|part| part.as_os_str() == ".git"))
}

fn entry_from_path(
    path: &Path,
    relative_path: String,
    name: String,
) -> Result<GuardedFsEntry, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let entry_id = stable_id(&metadata, path)?;
    entry_from_metadata(&metadata, relative_path, name, entry_id)
}

fn entry_from_metadata(
    metadata: &fs::Metadata,
    relative_path: String,
    name: String,
    entry_id: String,
) -> Result<GuardedFsEntry, String> {
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        "file"
    } else {
        return Err("unsupported filesystem entry".into());
    };
    Ok(GuardedFsEntry {
        name,
        relative_path,
        stable_id: entry_id,
        kind,
        size: metadata.len(),
        modified_at: modified_at(metadata),
        version: version(metadata),
    })
}

fn open_resolved_file(
    grants: &GuardedFsGrants,
    grant_id: &str,
    entry_id: &str,
    write: bool,
) -> Result<(PathBuf, PathBuf, fs::File, fs::Metadata), String> {
    let (root, target) = resolve_entry(grants, grant_id, Some(entry_id))?;
    let mut options = fs::OpenOptions::new();
    options.read(true).write(write);
    let file = options.open(&target).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || stable_id_for_open_file(&file, &target)? != entry_id {
        return Err("filesystem target is unavailable".into());
    }
    Ok((root, target, file, metadata))
}

fn guarded_fs_stat_impl(
    grants: &GuardedFsGrants,
    grant_id: &str,
    entry_id: Option<&str>,
) -> Result<GuardedFsEntry, String> {
    let (root, target) = resolve_entry(grants, grant_id, entry_id)?;
    let relative_path = relative_to_root(&root, &target)?;
    let name = target
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| relative_path.clone());
    entry_from_path(&target, relative_path, name)
}

fn guarded_fs_stat_optional_impl(
    grants: &GuardedFsGrants,
    grant_id: &str,
    entry_id: Option<&str>,
) -> Result<Option<GuardedFsEntry>, String> {
    match guarded_fs_stat_impl(grants, grant_id, entry_id) {
        Ok(entry) => Ok(Some(entry)),
        Err(error) if error == "filesystem target is unavailable" => Ok(None),
        Err(error) => Err(error),
    }
}

fn guarded_fs_list_impl(
    grants: &GuardedFsGrants,
    grant_id: &str,
    entry_id: Option<&str>,
) -> Result<Vec<GuardedFsEntry>, String> {
    let (root, directory) = resolve_entry(grants, grant_id, entry_id)?;
    if !directory.is_dir() {
        return Err("filesystem target is not a directory".into());
    }
    let mut entries = Vec::new();
    for item in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let item = item.map_err(|error| error.to_string())?;
        let name = item.file_name();
        if name == ".git" {
            continue;
        }
        let canonical = match fs::canonicalize(item.path()) {
            Ok(path) if path.starts_with(&root) => path,
            _ => continue,
        };
        if is_git_internal(&root, &canonical) {
            continue;
        }
        let relative_path = relative_to_root(&root, &canonical)?;
        if let Ok(entry) = entry_from_path(
            &canonical,
            relative_path,
            name.to_string_lossy().into_owned(),
        ) {
            grants.remember_entry(grant_id, &entry.stable_id, &canonical)?;
            entries.push(entry);
        }
    }
    entries.sort_by(|left, right| {
        let left_dir = left.kind == "directory";
        let right_dir = right.kind == "directory";
        right_dir
            .cmp(&left_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

fn guarded_fs_read_impl(
    grants: &GuardedFsGrants,
    grant_id: &str,
    entry_id: &str,
    start: Option<u64>,
    end: Option<u64>,
) -> Result<GuardedFsRead, String> {
    let (_, _, mut file, metadata) = open_resolved_file(grants, grant_id, entry_id, false)?;
    let start = start.unwrap_or(0);
    let end = end.unwrap_or(metadata.len());
    if start > end || end > metadata.len() {
        return Err("invalid file range".into());
    }
    let length = end - start;
    if length > MAX_READ_BYTES {
        return Err("file range exceeds the 32 MiB read limit".into());
    }
    file.seek(SeekFrom::Start(start))
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![0_u8; length as usize];
    file.read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(GuardedFsRead {
        base64: STANDARD.encode(bytes),
        size: metadata.len(),
        version: version(&metadata),
    })
}

fn guarded_fs_write_text_impl(
    grants: &GuardedFsGrants,
    grant_id: &str,
    entry_id: &str,
    content: &str,
    expected_version: Option<&str>,
) -> Result<GuardedFsEntry, String> {
    if content.len() > MAX_WRITE_BYTES {
        return Err("file content exceeds the 16 MiB write limit".into());
    }
    resolve_entry(grants, grant_id, Some(entry_id))?;
    let write_lock = grants.entry_write_lock(grant_id, entry_id)?;
    let _serial = write_lock
        .lock()
        .map_err(|_| "filesystem entry write lock is unavailable".to_string())?;
    let (root, target, mut file, before) = open_resolved_file(grants, grant_id, entry_id, true)?;
    if let Some(expected) = expected_version {
        if expected != version(&before) {
            return Err("filesystem version conflict".into());
        }
    }
    file.set_len(0).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;
    file.sync_data().map_err(|error| error.to_string())?;
    let after = file.metadata().map_err(|error| error.to_string())?;
    let opened_entry_id = stable_id_for_open_file(&file, &target)?;
    if opened_entry_id != entry_id {
        return Err("filesystem target is unavailable".into());
    }
    let relative_path = relative_to_root(&root, &target)?;
    let name = target
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| relative_path.clone());
    entry_from_metadata(&after, relative_path, name, opened_entry_id)
}

#[tauri::command]
pub async fn guarded_fs_pick_root(
    app: AppHandle,
    grants: State<'_, GuardedFsGrants>,
) -> Result<Option<GuardedFsGrant>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Select Git repository")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|_| "selected folder is not a local filesystem path".to_string())?;
    grants.insert(&selected).map(Some)
}

#[tauri::command]
pub fn guarded_fs_grant_info(
    grant_id: String,
    grants: State<'_, GuardedFsGrants>,
) -> Result<GuardedFsGrant, String> {
    grants.info(&grant_id)
}

#[tauri::command]
pub fn guarded_fs_revoke_grant(
    grant_id: String,
    grants: State<'_, GuardedFsGrants>,
) -> Result<bool, String> {
    grants.revoke(&grant_id)
}

#[tauri::command]
pub fn guarded_fs_stat(
    grant_id: String,
    entry_id: Option<String>,
    grants: State<'_, GuardedFsGrants>,
) -> Result<Option<GuardedFsEntry>, String> {
    guarded_fs_stat_optional_impl(&grants, &grant_id, entry_id.as_deref())
}

#[tauri::command]
pub fn guarded_fs_list(
    grant_id: String,
    entry_id: Option<String>,
    grants: State<'_, GuardedFsGrants>,
) -> Result<Vec<GuardedFsEntry>, String> {
    guarded_fs_list_impl(&grants, &grant_id, entry_id.as_deref())
}

#[tauri::command]
pub fn guarded_fs_read(
    grant_id: String,
    entry_id: String,
    start: Option<u64>,
    end: Option<u64>,
    grants: State<'_, GuardedFsGrants>,
) -> Result<GuardedFsRead, String> {
    guarded_fs_read_impl(&grants, &grant_id, &entry_id, start, end)
}

#[tauri::command]
pub fn guarded_fs_write_text(
    grant_id: String,
    entry_id: String,
    content: String,
    expected_version: Option<String>,
    grants: State<'_, GuardedFsGrants>,
) -> Result<GuardedFsEntry, String> {
    guarded_fs_write_text_impl(
        &grants,
        &grant_id,
        &entry_id,
        &content,
        expected_version.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        guarded_fs_list_impl, guarded_fs_read_impl, guarded_fs_stat_impl,
        guarded_fs_stat_optional_impl, guarded_fs_write_text_impl, path_text, stable_id,
        GuardedFsGrants,
    };
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Barrier};
    use uuid::Uuid;

    fn test_directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("ideall-guarded-fs-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn unknown_grants_cannot_resolve_paths() {
        let root = test_directory();
        let (grants, _) = GuardedFsGrants::for_test(&root);
        assert!(guarded_fs_stat_impl(&grants, &Uuid::new_v4().to_string(), None).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_entries_stat_as_none_but_unknown_grants_remain_errors() {
        let root = test_directory();
        fs::write(root.join("file.txt"), b"hello").unwrap();
        let (grants, grant_id) = GuardedFsGrants::for_test(&root);
        assert!(
            guarded_fs_stat_optional_impl(&grants, &grant_id, Some("unix:0:0"))
                .unwrap()
                .is_none()
        );
        assert!(guarded_fs_stat_optional_impl(&grants, &Uuid::new_v4().to_string(), None).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn grants_persist_restore_and_revoke_without_frontend_roots() {
        let base = test_directory();
        let root = base.join("repo");
        fs::create_dir(&root).unwrap();
        let persistence = base.join("grants.json");
        let grants = GuardedFsGrants::load(Some(persistence.clone()));
        let granted = grants.insert(&root).unwrap();

        let restored = GuardedFsGrants::load(Some(persistence.clone()));
        assert_eq!(
            restored.info(&granted.grant_id).unwrap().path,
            path_text(&root)
        );
        assert!(restored.revoke(&granted.grant_id).unwrap());
        let after_revoke = GuardedFsGrants::load(Some(persistence));
        assert!(after_revoke.info(&granted.grant_id).is_err());

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn replacing_a_granted_root_invalidates_the_grant() {
        let base = test_directory();
        let root = base.join("repo");
        let displaced = base.join("repo-old");
        fs::create_dir(&root).unwrap();
        let grants = GuardedFsGrants::load(None);
        let granted = grants.insert(&root).unwrap();
        fs::rename(&root, &displaced).unwrap();
        fs::create_dir(&root).unwrap();

        assert!(grants.info(&granted.grant_id).is_err());

        fs::remove_dir_all(base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_entries_use_canonical_relative_targets() {
        use std::os::unix::fs::symlink;

        let root = test_directory();
        fs::create_dir(root.join("actual")).unwrap();
        fs::write(root.join("actual/file.txt"), b"hello").unwrap();
        symlink("actual/file.txt", root.join("alias.txt")).unwrap();
        let (grants, grant_id) = GuardedFsGrants::for_test(&root);

        let listed = guarded_fs_list_impl(&grants, &grant_id, None).unwrap();
        let alias = listed
            .iter()
            .find(|entry| entry.name == "alias.txt")
            .unwrap();
        assert_eq!(alias.relative_path, "actual/file.txt");
        let stat = guarded_fs_stat_impl(&grants, &grant_id, Some(&alias.stable_id)).unwrap();
        assert_eq!(stat.relative_path, alias.relative_path);
        assert_eq!(stat.stable_id, alias.stable_id);

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn git_internals_and_escaping_symlinks_cannot_be_resolved_by_identity() {
        use std::os::unix::fs::symlink;

        let root = test_directory();
        let outside = test_directory();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join(".git/secret"), b"git-internal").unwrap();
        fs::write(outside.join("secret"), b"outside").unwrap();
        symlink(".git/secret", root.join("git-alias")).unwrap();
        symlink(outside.join("secret"), root.join("escape-alias")).unwrap();
        let (grants, grant_id) = GuardedFsGrants::for_test(&root);

        let listed = guarded_fs_list_impl(&grants, &grant_id, None).unwrap();
        assert!(listed.iter().all(|entry| entry.name != "git-alias"));
        assert!(listed.iter().all(|entry| entry.name != "escape-alias"));
        let git_path = root.join(".git/secret");
        let git_id = stable_id(&fs::metadata(&git_path).unwrap(), &git_path).unwrap();
        let outside_path = outside.join("secret");
        let outside_id = stable_id(&fs::metadata(&outside_path).unwrap(), &outside_path).unwrap();
        assert!(guarded_fs_stat_impl(&grants, &grant_id, Some(&git_id)).is_err());
        assert!(guarded_fs_stat_impl(&grants, &grant_id, Some(&outside_id)).is_err());

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn stable_identity_survives_rename_for_stat_and_read() {
        let root = test_directory();
        fs::write(root.join("before.txt"), b"hello").unwrap();
        let (grants, grant_id) = GuardedFsGrants::for_test(&root);
        let listed = guarded_fs_list_impl(&grants, &grant_id, None).unwrap();
        let before = listed
            .iter()
            .find(|entry| entry.name == "before.txt")
            .unwrap();
        let entry_id = before.stable_id.clone();
        fs::rename(root.join("before.txt"), root.join("after.txt")).unwrap();

        let stat = guarded_fs_stat_impl(&grants, &grant_id, Some(&entry_id)).unwrap();
        assert_eq!(stat.stable_id, entry_id);
        assert_eq!(stat.name, "after.txt");
        let read = guarded_fs_read_impl(&grants, &grant_id, &entry_id, None, None).unwrap();
        assert_eq!(STANDARD.decode(read.base64).unwrap(), b"hello");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn expected_version_check_and_write_are_serialized_per_identity() {
        let root = test_directory();
        fs::write(root.join("file.txt"), b"start").unwrap();
        let (grants, grant_id) = GuardedFsGrants::for_test(&root);
        let listed = guarded_fs_list_impl(&grants, &grant_id, None).unwrap();
        let file = listed
            .iter()
            .find(|entry| entry.name == "file.txt")
            .unwrap();
        let entry_id = file.stable_id.clone();
        let expected = file.version.clone();
        let grants = Arc::new(grants);
        let barrier = Arc::new(Barrier::new(2));
        let mut workers = Vec::new();
        for content in ["one-longer", "two-much-longer"] {
            let grants = Arc::clone(&grants);
            let barrier = Arc::clone(&barrier);
            let grant_id = grant_id.clone();
            let entry_id = entry_id.clone();
            let expected = expected.clone();
            workers.push(std::thread::spawn(move || {
                barrier.wait();
                guarded_fs_write_text_impl(&grants, &grant_id, &entry_id, content, Some(&expected))
            }));
        }
        let results = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| {
                    matches!(result, Err(error) if error == "filesystem version conflict")
                })
                .count(),
            1
        );

        fs::remove_dir_all(root).unwrap();
    }
}
