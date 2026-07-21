use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Take, Write};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::runtime_extensions::OFFICIAL_MINISIGN_KEY;

const REGISTRY_URL: &str = "https://api.wonita.link/v2/extensions/registry";
const REGISTRY_ID: &str = "ideall.official";
const CACHE_FILE: &str = "extension-registry-cache.json";
const MAX_PAGE_BYTES: usize = 256 * 1024;
const MAX_CACHE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PAGES: usize = 8;
const PAGE_LIMIT: usize = 64;
const MAX_ENTRIES: usize = 256;
const MAX_CURSOR_BYTES: usize = 256;
const MAX_ID_BYTES: usize = 128;
const MAX_LABEL_BYTES: usize = 160;
const MAX_SUMMARY_BYTES: usize = 512;
const MAX_PACKAGE_BYTES: usize = 96 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_CLOCK_SKEW_MS: u64 = 5 * 60 * 1000;
const MAX_VALIDITY_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_PERMISSIONS: &[&str] = &["resources:read", "tools:invoke"];

fn error(code: &str) -> String {
    code.to_string()
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistryEnvelope {
    schema_version: u32,
    payload: String,
    signature: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistryPage {
    schema_version: u32,
    registry: String,
    sequence: u64,
    generated_at: u64,
    expires_at: u64,
    cursor: Option<String>,
    next_cursor: Option<String>,
    entries: Vec<RegistryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RegistryEntry {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) summary: String,
    pub(crate) version: u64,
    pub(crate) publisher: String,
    pub(crate) publisher_fingerprint: String,
    pub(crate) permissions: Vec<String>,
    pub(crate) digest: String,
    pub(crate) package_url: String,
    pub(crate) package_sha256: String,
    pub(crate) published_at: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct RegistryUpdateEntry {
    pub(crate) sequence: u64,
    pub(crate) expires_at: u64,
    pub(crate) entry: RegistryEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistryCache {
    schema_version: u32,
    fetched_at: u64,
    pages: Vec<RegistryEnvelope>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegistrySnapshot {
    source: &'static str,
    stale: bool,
    fetched_at: u64,
    generated_at: u64,
    expires_at: u64,
    sequence: u64,
    failure_code: Option<String>,
    entries: Vec<RegistryEntry>,
}

#[derive(Debug)]
struct AggregatedRegistry {
    generated_at: u64,
    expires_at: u64,
    sequence: u64,
    entries: Vec<RegistryEntry>,
}

fn now_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| error("system-clock-invalid"))?
        .as_millis() as u64)
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
}

fn valid_content_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|encoded| {
        encoded.len() == 43
            && encoded
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    })
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_cursor(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CURSOR_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_package_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
}

fn validate_entry(entry: &RegistryEntry, generated_at: u64) -> Result<(), String> {
    if !valid_id(&entry.id)
        || !valid_text(&entry.label, MAX_LABEL_BYTES)
        || !valid_text(&entry.summary, MAX_SUMMARY_BYTES)
        || entry.version == 0
        || entry.version > MAX_SAFE_INTEGER
        || !valid_id(&entry.publisher)
        || !valid_content_digest(&entry.publisher_fingerprint)
        || !valid_content_digest(&entry.digest)
        || !valid_package_url(&entry.package_url)
        || !valid_sha256(&entry.package_sha256)
        || entry.published_at == 0
        || entry.published_at > generated_at
    {
        return Err(error("invalid-extension-registry-entry"));
    }
    if entry.permissions.is_empty()
        || entry.permissions.len() > ALLOWED_PERMISSIONS.len()
        || !entry
            .permissions
            .windows(2)
            .all(|items| items[0] < items[1])
        || entry
            .permissions
            .iter()
            .any(|permission| !ALLOWED_PERMISSIONS.contains(&permission.as_str()))
    {
        return Err(error("invalid-extension-registry-permissions"));
    }
    Ok(())
}

fn validate_page(
    page: &RegistryPage,
    expected_cursor: Option<&str>,
    now: u64,
) -> Result<(), String> {
    if page.schema_version != 1
        || page.registry != REGISTRY_ID
        || page.sequence == 0
        || page.sequence > MAX_SAFE_INTEGER
        || page.generated_at == 0
        || page.generated_at > now.saturating_add(MAX_CLOCK_SKEW_MS)
        || page.expires_at <= page.generated_at
        || page.expires_at.saturating_sub(page.generated_at) > MAX_VALIDITY_MS
        || page.cursor.as_deref() != expected_cursor
        || page.entries.len() > PAGE_LIMIT
        || page
            .cursor
            .as_deref()
            .is_some_and(|value| !valid_cursor(value))
        || page
            .next_cursor
            .as_deref()
            .is_some_and(|value| !valid_cursor(value))
        || (page.next_cursor.is_some() && page.next_cursor == page.cursor)
    {
        return Err(error("invalid-extension-registry-page"));
    }
    for entry in &page.entries {
        validate_entry(entry, page.generated_at)?;
    }
    if !page
        .entries
        .windows(2)
        .all(|items| items[0].id < items[1].id)
    {
        return Err(error("invalid-extension-registry-order"));
    }
    Ok(())
}

fn decode_page_with<F>(
    envelope: &RegistryEnvelope,
    expected_cursor: Option<&str>,
    now: u64,
    verifier: F,
) -> Result<RegistryPage, String>
where
    F: FnOnce(&[u8], &str) -> Result<(), String>,
{
    if envelope.schema_version != 1
        || envelope.payload.len() > MAX_PAGE_BYTES
        || envelope.signature.len() > 8 * 1024
    {
        return Err(error("invalid-extension-registry-envelope"));
    }
    verifier(envelope.payload.as_bytes(), &envelope.signature)?;
    let page: RegistryPage = serde_json::from_str(&envelope.payload)
        .map_err(|_| error("invalid-extension-registry-payload"))?;
    validate_page(&page, expected_cursor, now)?;
    Ok(page)
}

fn verify_official(content: &[u8], encoded: &str) -> Result<(), String> {
    let key = PublicKey::from_base64(OFFICIAL_MINISIGN_KEY)
        .map_err(|_| error("invalid-extension-registry-root"))?;
    let signature =
        Signature::decode(encoded).map_err(|_| error("invalid-extension-registry-signature"))?;
    key.verify(content, &signature, false)
        .map_err(|_| error("extension-registry-signature-rejected"))
}

fn aggregate_pages<F>(
    envelopes: &[RegistryEnvelope],
    now: u64,
    mut verifier: F,
) -> Result<AggregatedRegistry, String>
where
    F: FnMut(&[u8], &str) -> Result<(), String>,
{
    if envelopes.is_empty() || envelopes.len() > MAX_PAGES {
        return Err(error("invalid-extension-registry-pages"));
    }
    let mut expected_cursor: Option<String> = None;
    let mut seen_cursors = HashSet::new();
    let mut metadata: Option<(u64, u64, u64)> = None;
    let mut entries = Vec::new();
    for (index, envelope) in envelopes.iter().enumerate() {
        let page = decode_page_with(
            envelope,
            expected_cursor.as_deref(),
            now,
            |content, signature| verifier(content, signature),
        )?;
        let current_metadata = (page.sequence, page.generated_at, page.expires_at);
        if metadata.is_some_and(|value| value != current_metadata) {
            return Err(error("extension-registry-page-mismatch"));
        }
        metadata.get_or_insert(current_metadata);
        if !page.entries.is_empty()
            && entries
                .last()
                .is_some_and(|previous: &RegistryEntry| previous.id >= page.entries[0].id)
        {
            return Err(error("invalid-extension-registry-order"));
        }
        entries.extend(page.entries);
        if entries.len() > MAX_ENTRIES {
            return Err(error("extension-registry-too-large"));
        }
        match page.next_cursor {
            Some(next) => {
                if index + 1 == envelopes.len() || !seen_cursors.insert(next.clone()) {
                    return Err(error("invalid-extension-registry-pagination"));
                }
                expected_cursor = Some(next);
            }
            None => {
                if index + 1 != envelopes.len() {
                    return Err(error("invalid-extension-registry-pagination"));
                }
                expected_cursor = None;
            }
        }
    }
    if expected_cursor.is_some() {
        return Err(error("incomplete-extension-registry"));
    }
    let (sequence, generated_at, expires_at) = metadata.unwrap();
    Ok(AggregatedRegistry {
        generated_at,
        expires_at,
        sequence,
        entries,
    })
}

fn snapshot_from_cache(
    cache: &RegistryCache,
    source: &'static str,
    failure_code: Option<String>,
    now: u64,
) -> Result<RegistrySnapshot, String> {
    if cache.schema_version != 1
        || cache.fetched_at == 0
        || cache.fetched_at > now.saturating_add(MAX_CLOCK_SKEW_MS)
    {
        return Err(error("invalid-extension-registry-cache"));
    }
    let registry = aggregate_pages(&cache.pages, now, verify_official)
        .map_err(|_| error("invalid-extension-registry-cache"))?;
    Ok(RegistrySnapshot {
        source,
        stale: registry.expires_at <= now,
        fetched_at: cache.fetched_at,
        generated_at: registry.generated_at,
        expires_at: registry.expires_at,
        sequence: registry.sequence,
        failure_code,
        entries: registry.entries,
    })
}

fn assert_registry_forward_progress_with<F>(
    previous: &RegistryCache,
    next: &RegistryCache,
    now: u64,
    mut verifier: F,
) -> Result<(), String>
where
    F: FnMut(&[u8], &str) -> Result<(), String>,
{
    let Ok(previous_registry) = aggregate_pages(&previous.pages, now, |content, signature| {
        verifier(content, signature)
    }) else {
        // A corrupt local cache is not authoritative and must remain recoverable from a valid
        // network snapshot. persist_cache will atomically replace it after this check.
        return Ok(());
    };
    let next_registry = aggregate_pages(&next.pages, now, |content, signature| {
        verifier(content, signature)
    })?;
    if next_registry.sequence < previous_registry.sequence {
        return Err(error("extension-registry-sequence-rollback"));
    }
    if next_registry.sequence == previous_registry.sequence && next.pages != previous.pages {
        return Err(error("extension-registry-sequence-conflict"));
    }
    Ok(())
}

fn assert_registry_forward_progress(
    previous: &RegistryCache,
    next: &RegistryCache,
    now: u64,
) -> Result<(), String> {
    assert_registry_forward_progress_with(previous, next, now, verify_official)
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| error("app-data-unavailable"))?
        .join(CACHE_FILE))
}

fn read_bounded_regular(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| error("invalid-extension-registry-cache"))?;
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err(error("invalid-extension-registry-cache"));
    }
    let file = File::open(path).map_err(|_| error("invalid-extension-registry-cache"))?;
    let mut reader: Take<File> = file.take(limit + 1);
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    reader
        .read_to_end(&mut bytes)
        .map_err(|_| error("invalid-extension-registry-cache"))?;
    if bytes.len() as u64 > limit {
        return Err(error("invalid-extension-registry-cache"));
    }
    Ok(bytes)
}

fn load_cache(app: &AppHandle) -> Result<Option<RegistryCache>, String> {
    let path = cache_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = read_bounded_regular(&path, MAX_CACHE_BYTES)?;
    let cache =
        serde_json::from_slice(&bytes).map_err(|_| error("invalid-extension-registry-cache"))?;
    Ok(Some(cache))
}

pub(crate) fn registry_update_entry(
    app: &AppHandle,
    id: &str,
    now: u64,
) -> Result<RegistryUpdateEntry, String> {
    let cache = load_cache(app)?.ok_or_else(|| error("extension-registry-unavailable"))?;
    let snapshot = snapshot_from_cache(&cache, "cache", None, now)?;
    if snapshot.stale {
        return Err(error("extension-registry-stale"));
    }
    let entry = snapshot
        .entries
        .binary_search_by(|entry| entry.id.as_str().cmp(id))
        .ok()
        .map(|index| snapshot.entries[index].clone())
        .ok_or_else(|| error("extension-update-not-listed"))?;
    Ok(RegistryUpdateEntry {
        sequence: snapshot.sequence,
        expires_at: snapshot.expires_at,
        entry,
    })
}

fn persist_cache(app: &AppHandle, cache: &RegistryCache) -> Result<(), String> {
    let path = cache_path(app)?;
    let parent = path.parent().ok_or_else(|| error("app-data-unavailable"))?;
    fs::create_dir_all(parent).map_err(|_| error("extension-registry-cache-write-failed"))?;
    if !fs::symlink_metadata(parent)
        .map_err(|_| error("extension-registry-cache-write-failed"))?
        .file_type()
        .is_dir()
    {
        return Err(error("extension-registry-cache-write-failed"));
    }
    let bytes =
        serde_json::to_vec(cache).map_err(|_| error("extension-registry-cache-write-failed"))?;
    if bytes.len() as u64 > MAX_CACHE_BYTES {
        return Err(error("extension-registry-cache-write-failed"));
    }
    let temporary = parent.join(format!(".{CACHE_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    {
        let mut file =
            File::create(&temporary).map_err(|_| error("extension-registry-cache-write-failed"))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| error("extension-registry-cache-write-failed"))?;
    }
    let backup = parent.join(format!(".{CACHE_FILE}.backup"));
    if backup.exists() {
        fs::remove_file(&backup).map_err(|_| error("extension-registry-cache-write-failed"))?;
    }
    let had_current = path.exists();
    if had_current {
        fs::rename(&path, &backup).map_err(|_| error("extension-registry-cache-write-failed"))?;
    }
    if fs::rename(&temporary, &path).is_err() {
        if had_current {
            let _ = fs::rename(&backup, &path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(error("extension-registry-cache-write-failed"));
    }
    if had_current {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

async fn read_response(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    if response.status() != reqwest::StatusCode::OK {
        return Err(error("extension-registry-http-failed"));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !content_type
        .split(';')
        .next()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
    {
        return Err(error("extension-registry-content-type-rejected"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| error("extension-registry-read-failed"))?
    {
        if body.len().saturating_add(chunk.len()) > MAX_PAGE_BYTES {
            return Err(error("extension-registry-page-too-large"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn fetch_registry(now: u64) -> Result<RegistryCache, String> {
    let endpoint = reqwest::Url::parse(REGISTRY_URL)
        .map_err(|_| error("invalid-extension-registry-endpoint"))?;
    if endpoint.scheme() != "https"
        || endpoint.host_str().is_none()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.port().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(error("invalid-extension-registry-endpoint"));
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("ideall-extension-registry/1")
        .build()
        .map_err(|_| error("extension-registry-client-failed"))?;
    let mut pages = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen = HashSet::new();
    loop {
        if pages.len() >= MAX_PAGES {
            return Err(error("extension-registry-page-limit"));
        }
        let mut url = endpoint.clone();
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("limit", &PAGE_LIMIT.to_string());
            if let Some(cursor) = &cursor {
                query.append_pair("cursor", cursor);
            }
        }
        let response = client
            .get(url)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| error("extension-registry-network-failed"))?;
        let body = read_response(response).await?;
        let envelope: RegistryEnvelope = serde_json::from_slice(&body)
            .map_err(|_| error("invalid-extension-registry-envelope"))?;
        let page = decode_page_with(&envelope, cursor.as_deref(), now, verify_official)?;
        cursor = page.next_cursor;
        if cursor
            .as_ref()
            .is_some_and(|value| !seen.insert(value.clone()))
        {
            return Err(error("invalid-extension-registry-pagination"));
        }
        pages.push(envelope);
        if cursor.is_none() {
            break;
        }
    }
    let registry = aggregate_pages(&pages, now, verify_official)?;
    if registry.expires_at <= now {
        return Err(error("extension-registry-expired"));
    }
    Ok(RegistryCache {
        schema_version: 1,
        fetched_at: now,
        pages,
    })
}

fn allowed_package_content_type(value: &str) -> bool {
    matches!(
        value.split(';').next().map(str::trim),
        Some("application/json")
            | Some("application/octet-stream")
            | Some("application/vnd.ideall.extension+json")
    )
}

pub(crate) async fn download_registry_package(entry: &RegistryEntry) -> Result<Vec<u8>, String> {
    validate_entry(entry, entry.published_at.max(1))?;
    let url = reqwest::Url::parse(&entry.package_url)
        .map_err(|_| error("invalid-extension-package-url"))?;
    let host = url
        .host_str()
        .ok_or_else(|| error("invalid-extension-package-url"))?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 443))
        .await
        .map_err(|_| error("extension-package-dns-failed"))?
        .collect();
    if addrs.is_empty() {
        return Err(error("extension-package-dns-failed"));
    }
    if addrs
        .iter()
        .any(|address| crate::is_blocked_ip(address.ip()))
    {
        return Err(error("extension-package-host-rejected"));
    }
    let client = reqwest::Client::builder()
        .resolve_to_addrs(&host, &addrs)
        .no_proxy()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::none())
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .user_agent("ideall-extension-updater/1")
        .build()
        .map_err(|_| error("extension-package-client-failed"))?;
    let mut response = client
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "application/vnd.ideall.extension+json, application/json",
        )
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|_| error("extension-package-download-failed"))?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(error("extension-package-http-failed"));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PACKAGE_BYTES as u64)
    {
        return Err(error("extension-package-too-large"));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !allowed_package_content_type(content_type) {
        return Err(error("extension-package-content-type-rejected"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| error("extension-package-read-failed"))?
    {
        if body.len().saturating_add(chunk.len()) > MAX_PACKAGE_BYTES {
            return Err(error("extension-package-too-large"));
        }
        body.extend_from_slice(&chunk);
    }
    if format!("{:x}", Sha256::digest(&body)) != entry.package_sha256 {
        return Err(error("extension-package-sha256-mismatch"));
    }
    Ok(body)
}

#[tauri::command]
pub(crate) fn runtime_extension_registry_snapshot(
    app: AppHandle,
) -> Result<Option<RegistrySnapshot>, String> {
    let Some(cache) = load_cache(&app)? else {
        return Ok(None);
    };
    Ok(Some(snapshot_from_cache(&cache, "cache", None, now_ms()?)?))
}

#[tauri::command]
pub(crate) async fn runtime_extension_registry_refresh(
    app: AppHandle,
) -> Result<RegistrySnapshot, String> {
    let now = now_ms()?;
    match fetch_registry(now).await {
        Ok(cache) => {
            if let Ok(Some(previous)) = load_cache(&app) {
                if let Err(failure) = assert_registry_forward_progress(&previous, &cache, now) {
                    return snapshot_from_cache(&previous, "cache", Some(failure), now);
                }
            }
            let snapshot = snapshot_from_cache(&cache, "network", None, now)?;
            persist_cache(&app, &cache)?;
            Ok(snapshot)
        }
        Err(failure) => match load_cache(&app) {
            Ok(Some(cache)) => snapshot_from_cache(&cache, "cache", Some(failure), now),
            Ok(None) | Err(_) => Err(failure),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_endpoint_uses_public_v2_contract() {
        let endpoint = reqwest::Url::parse(REGISTRY_URL).unwrap();
        assert_eq!(endpoint.scheme(), "https");
        assert_eq!(endpoint.host_str(), Some("api.wonita.link"));
        assert_eq!(endpoint.path(), "/v2/extensions/registry");
    }

    fn entry(id: &str) -> RegistryEntry {
        RegistryEntry {
            id: id.into(),
            label: "Fixture extension".into(),
            summary: "A bounded fixture extension.".into(),
            version: 2,
            publisher: "ideall.official".into(),
            publisher_fingerprint: format!("sha256:{}", "A".repeat(43)),
            permissions: vec!["resources:read".into()],
            digest: format!("sha256:{}", "B".repeat(43)),
            package_url: format!("https://downloads.wonita.link/extensions/{id}.ideall-extension"),
            package_sha256: "a".repeat(64),
            published_at: 100,
        }
    }

    fn envelope(
        cursor: Option<&str>,
        next: Option<&str>,
        entries: Vec<RegistryEntry>,
    ) -> RegistryEnvelope {
        let payload = serde_json::json!({
            "schemaVersion": 1,
            "registry": REGISTRY_ID,
            "sequence": 7,
            "generatedAt": 200,
            "expiresAt": 400,
            "cursor": cursor,
            "nextCursor": next,
            "entries": entries,
        });
        RegistryEnvelope {
            schema_version: 1,
            payload: serde_json::to_string(&payload).unwrap(),
            signature: "fixture".into(),
        }
    }

    fn accept(_content: &[u8], signature: &str) -> Result<(), String> {
        if signature == "fixture" {
            Ok(())
        } else {
            Err(error("rejected"))
        }
    }

    #[test]
    fn registry_pages_bind_metadata_cursor_order_and_bounds() {
        let pages = vec![
            envelope(None, Some("next_1"), vec![entry("alpha.reader")]),
            envelope(Some("next_1"), None, vec![entry("beta.search")]),
        ];
        let registry = aggregate_pages(&pages, 250, accept).unwrap();
        assert_eq!(registry.sequence, 7);
        assert_eq!(registry.entries.len(), 2);

        let reordered = vec![
            envelope(None, Some("next_1"), vec![entry("beta.search")]),
            envelope(Some("next_1"), None, vec![entry("alpha.reader")]),
        ];
        assert_eq!(
            aggregate_pages(&reordered, 250, accept).unwrap_err(),
            "invalid-extension-registry-order"
        );
    }

    #[test]
    fn registry_rejects_unsafe_package_urls_permissions_and_unknown_payload_fields() {
        let mut unsafe_entry = entry("alpha.reader");
        unsafe_entry.package_url = "http://downloads.wonita.link/alpha".into();
        assert_eq!(
            aggregate_pages(&[envelope(None, None, vec![unsafe_entry])], 250, accept).unwrap_err(),
            "invalid-extension-registry-entry"
        );

        let mut permissions = entry("alpha.reader");
        permissions.permissions = vec!["tools:invoke".into(), "resources:read".into()];
        assert_eq!(
            aggregate_pages(&[envelope(None, None, vec![permissions])], 250, accept).unwrap_err(),
            "invalid-extension-registry-permissions"
        );

        let mut unknown = envelope(None, None, vec![entry("alpha.reader")]);
        unknown.payload = unknown
            .payload
            .replace("\"entries\":", "\"unexpected\":true,\"entries\":");
        assert_eq!(
            aggregate_pages(&[unknown], 250, accept).unwrap_err(),
            "invalid-extension-registry-payload"
        );
    }

    #[test]
    fn update_download_content_types_are_explicitly_bounded() {
        assert!(allowed_package_content_type(
            "application/vnd.ideall.extension+json"
        ));
        assert!(allowed_package_content_type(
            "application/json; charset=utf-8"
        ));
        assert!(allowed_package_content_type("application/octet-stream"));
        assert!(!allowed_package_content_type("text/html"));
        assert!(!allowed_package_content_type(""));
    }

    #[test]
    fn registry_verifies_the_exact_payload_bytes_before_parsing() {
        let page = envelope(None, None, vec![entry("alpha.reader")]);
        let expected = page.payload.clone();
        let decoded = decode_page_with(&page, None, 250, |content, signature| {
            assert_eq!(content, expected.as_bytes());
            assert_eq!(signature, "fixture");
            Ok(())
        })
        .unwrap();
        assert_eq!(decoded.entries[0].id, "alpha.reader");
    }

    #[test]
    fn registry_cache_rejects_sequence_rollback_and_same_sequence_forks() {
        let cache = |page: RegistryEnvelope| RegistryCache {
            schema_version: 1,
            fetched_at: 250,
            pages: vec![page],
        };
        let previous = cache(envelope(None, None, vec![entry("alpha.reader")]));

        let mut rollback_page = envelope(None, None, vec![entry("alpha.reader")]);
        rollback_page.payload = rollback_page
            .payload
            .replace("\"sequence\":7", "\"sequence\":6");
        assert_eq!(
            assert_registry_forward_progress_with(&previous, &cache(rollback_page), 250, accept)
                .unwrap_err(),
            "extension-registry-sequence-rollback"
        );

        let fork = cache(envelope(None, None, vec![entry("beta.search")]));
        assert_eq!(
            assert_registry_forward_progress_with(&previous, &fork, 250, accept).unwrap_err(),
            "extension-registry-sequence-conflict"
        );
        assert!(assert_registry_forward_progress_with(&previous, &previous, 250, accept).is_ok());

        let mut forward_page = envelope(None, None, vec![entry("beta.search")]);
        forward_page.payload = forward_page
            .payload
            .replace("\"sequence\":7", "\"sequence\":8");
        assert!(assert_registry_forward_progress_with(
            &previous,
            &cache(forward_page),
            250,
            accept
        )
        .is_ok());
    }
}
