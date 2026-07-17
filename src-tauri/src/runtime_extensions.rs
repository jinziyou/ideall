use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Take, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::acp_transport::{self, AcpSessions};

const OFFICIAL_PUBLISHER: &str = "ideall.official";
pub(crate) const OFFICIAL_MINISIGN_KEY: &str =
    "RWRJZd+yMqKmCi+f6bpzu532c25RXBp3NT8jgkTQ2PWbQYvbv2doyAv5";
const OFFICIAL_VERIFIER_ID: &str = "ideall-official-minisign-v1";
const PACKAGE_DIRECTORY: &str = "extensions";
const STAGING_DIRECTORY: &str = "extension-staging";
const UPDATE_STAGING_DIRECTORY: &str = "extension-update-staging";
const BACKUP_DIRECTORY: &str = "extension-backups";
const TRUST_STORE_FILE: &str = "extension-publisher-trust.json";
const MANIFEST_FILE: &str = "manifest.json";
const SIGNATURE_FILE: &str = "manifest.json.minisig";
const MAX_PACKAGES: usize = 64;
const MAX_PUBLISHERS: usize = 64;
const MAX_REVOKED_DIGESTS: usize = 4096;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_SIGNATURE_BYTES: u64 = 8 * 1024;
const MAX_CONNECTOR_BYTES: u64 = 64 * 1024 * 1024;
const MAX_BUNDLE_BYTES: u64 = 96 * 1024 * 1024;
const MAX_ROOT_BYTES: u64 = 16 * 1024;
const MAX_ROTATION_BYTES: u64 = 32 * 1024;
const MAX_REVOCATION_BYTES: u64 = 512 * 1024;
const MAX_RETIRED_PUBLISHER_KEYS: usize = 32;
const MAX_ID_BYTES: usize = 128;
const MAX_LABEL_BYTES: usize = 160;
const MAX_ARGS: usize = 32;
const MAX_ARG_BYTES: usize = 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_CLOCK_SKEW_MS: u64 = 5 * 60 * 1000;
const ALLOWED_PERMISSIONS: &[&str] = &["resources:read", "tools:invoke"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageManifest {
    schema_version: u32,
    id: String,
    label: String,
    version: u64,
    publisher: String,
    permissions: Vec<String>,
    connector: ConnectorManifest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectorManifest {
    protocol: ConnectorProtocol,
    executable: String,
    sha256: String,
    #[serde(default)]
    args: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
enum ConnectorProtocol {
    #[serde(rename = "mcp-stdio")]
    McpStdio,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExtensionBundle {
    schema_version: u32,
    manifest: String,
    signature: String,
    connector_base64: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublisherRootDocument {
    schema_version: u32,
    publisher: String,
    label: String,
    public_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevocationEnvelope {
    schema_version: u32,
    payload: String,
    signature: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevocationPayload {
    schema_version: u32,
    publisher: String,
    sequence: u64,
    issued_at: u64,
    revoked_digests: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublisherRotationEnvelope {
    schema_version: u32,
    payload: String,
    current_signature: String,
    next_signature: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublisherRotationPayload {
    schema_version: u32,
    publisher: String,
    sequence: u64,
    issued_at: u64,
    current_fingerprint: String,
    next_public_key: String,
    next_fingerprint: String,
}

fn default_publisher_key_sequence() -> u64 {
    1
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredPublisher {
    publisher: String,
    label: String,
    public_key: String,
    fingerprint: String,
    trusted_at: u64,
    revoked_at: Option<u64>,
    #[serde(default = "default_publisher_key_sequence")]
    key_sequence: u64,
    #[serde(default)]
    last_rotation_issued_at: Option<u64>,
    #[serde(default)]
    rotated_at: Option<u64>,
    #[serde(default)]
    retired_fingerprints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredRevocationList {
    publisher: String,
    sequence: u64,
    issued_at: u64,
    imported_at: u64,
    revoked_digests: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublisherTrustStore {
    schema_version: u32,
    publishers: Vec<StoredPublisher>,
    revocations: Vec<StoredRevocationList>,
}

impl Default for PublisherTrustStore {
    fn default() -> Self {
        Self {
            schema_version: 2,
            publishers: Vec::new(),
            revocations: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct VerifiedPackage {
    manifest: PackageManifest,
    digest: String,
    permission_digest: String,
    publisher_fingerprint: String,
    verifier_id: String,
    package_dir: PathBuf,
    executable: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeExtensionPackage {
    id: String,
    label: String,
    version: u64,
    publisher: String,
    publisher_fingerprint: String,
    permissions: Vec<String>,
    digest: String,
    permission_digest: String,
    connector_protocol: &'static str,
    rollback_version: Option<u64>,
}

impl RuntimeExtensionPackage {
    fn from_verified(package: &VerifiedPackage, rollback_version: Option<u64>) -> Self {
        Self {
            id: package.manifest.id.clone(),
            label: package.manifest.label.clone(),
            version: package.manifest.version,
            publisher: package.manifest.publisher.clone(),
            publisher_fingerprint: package.publisher_fingerprint.clone(),
            permissions: package.manifest.permissions.clone(),
            digest: package.digest.clone(),
            permission_digest: package.permission_digest.clone(),
            connector_protocol: match package.manifest.connector.protocol {
                ConnectorProtocol::McpStdio => "mcp-stdio",
            },
            rollback_version,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RejectedRuntimeExtensionPackage {
    directory: String,
    code: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeExtensionDiscoveryReport {
    packages: Vec<RuntimeExtensionPackage>,
    rejected: Vec<RejectedRuntimeExtensionPackage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeExtensionVerificationReceipt {
    receipt_id: String,
    verifier_id: String,
    id: String,
    version: u64,
    digest: String,
    permission_digest: String,
    verified_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublisherRootCandidate {
    publisher: String,
    label: String,
    public_key: String,
    fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublisherStatus {
    publisher: String,
    label: String,
    fingerprint: String,
    status: &'static str,
    trusted_at: Option<u64>,
    revoked_at: Option<u64>,
    revocation_sequence: Option<u64>,
    revocation_issued_at: Option<u64>,
    revoked_digest_count: usize,
    key_sequence: u64,
    rotated_at: Option<u64>,
    retired_key_count: usize,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PublisherRotationCandidate {
    publisher: String,
    label: String,
    sequence: u64,
    issued_at: u64,
    current_fingerprint: String,
    next_fingerprint: String,
    payload: String,
    current_signature: String,
    next_signature: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublisherRotationResult {
    changed: bool,
    publisher: String,
    sequence: u64,
    previous_fingerprint: String,
    fingerprint: String,
    rotated_at: u64,
    retired_key_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackageMutationResult {
    changed: bool,
    cancelled: bool,
    operation: Option<&'static str>,
    package: Option<RuntimeExtensionPackage>,
    previous_version: Option<u64>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimeExtensionUpdateCandidate {
    token: String,
    registry_sequence: u64,
    registry_expires_at: u64,
    id: String,
    label: String,
    current_version: u64,
    next_version: u64,
    publisher: String,
    publisher_fingerprint: String,
    current_permissions: Vec<String>,
    next_permissions: Vec<String>,
    added_permissions: Vec<String>,
    removed_permissions: Vec<String>,
    digest: String,
    package_sha256: String,
    published_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevocationImportResult {
    changed: bool,
    cancelled: bool,
    publisher: Option<String>,
    sequence: Option<u64>,
    revoked_digest_count: usize,
}

fn error(code: &str) -> String {
    code.to_string()
}

fn now_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| error("clock-unavailable"))?
        .as_millis() as u64)
}

fn valid_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > MAX_ID_BYTES {
        return false;
    }
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return false;
    }
    if !bytes[bytes.len() - 1].is_ascii_lowercase() && !bytes[bytes.len() - 1].is_ascii_digit() {
        return false;
    }
    bytes.iter().copied().all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
    })
}

fn valid_text(value: &str, max_bytes: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn valid_file_name(value: &str) -> bool {
    valid_text(value, MAX_ID_BYTES)
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_content_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|encoded| {
        encoded.len() == 43
            && encoded
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    })
}

fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", URL_SAFE_NO_PAD.encode(Sha256::digest(bytes)))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| error("connector-unavailable"))?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_CONNECTOR_BYTES {
        return Err(error("invalid-connector-file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(error("connector-not-executable"));
        }
    }
    let mut file = File::open(path).map_err(|_| error("connector-unavailable"))?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 32 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| error("connector-read-failed"))?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > MAX_CONNECTOR_BYTES {
            return Err(error("connector-too-large"));
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn read_bounded_regular(path: &Path, limit: u64, code: &str) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| error(code))?;
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err(error(code));
    }
    let file = File::open(path).map_err(|_| error(code))?;
    let mut reader: Take<File> = file.take(limit + 1);
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    reader.read_to_end(&mut bytes).map_err(|_| error(code))?;
    if bytes.len() as u64 > limit {
        return Err(error(code));
    }
    Ok(bytes)
}

fn verify_minisign_with_key(key: &str, content: &[u8], encoded: &str) -> Result<(), String> {
    let key = PublicKey::from_base64(key).map_err(|_| error("invalid-trust-root"))?;
    let signature = Signature::decode(encoded).map_err(|_| error("invalid-signature"))?;
    key.verify(content, &signature, false)
        .map_err(|_| error("signature-rejected"))
}

fn validate_manifest(manifest: &PackageManifest, directory: &str) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err(error("unsupported-schema"));
    }
    if !valid_id(&manifest.id) || manifest.id != directory {
        return Err(error("invalid-package-id"));
    }
    if !valid_text(&manifest.label, MAX_LABEL_BYTES)
        || !valid_id(&manifest.publisher)
        || manifest.version == 0
        || manifest.version > MAX_SAFE_INTEGER
    {
        return Err(error("invalid-manifest-identity"));
    }
    if manifest.permissions.is_empty()
        || manifest.permissions.len() > ALLOWED_PERMISSIONS.len()
        || !manifest
            .permissions
            .windows(2)
            .all(|items| items[0] < items[1])
        || manifest
            .permissions
            .iter()
            .any(|permission| !ALLOWED_PERMISSIONS.contains(&permission.as_str()))
    {
        return Err(error("invalid-permissions"));
    }
    if !valid_file_name(&manifest.connector.executable)
        || !valid_sha256(&manifest.connector.sha256)
        || manifest.connector.args.len() > MAX_ARGS
        || manifest
            .connector
            .args
            .iter()
            .any(|arg| arg.len() > MAX_ARG_BYTES || arg.chars().any(char::is_control))
    {
        return Err(error("invalid-connector"));
    }
    Ok(())
}

fn validate_store(store: &PublisherTrustStore) -> Result<(), String> {
    if store.schema_version != 2
        || store.publishers.len() > MAX_PUBLISHERS
        || store.revocations.len() > MAX_PUBLISHERS
    {
        return Err(error("invalid-publisher-store"));
    }
    let mut publisher_ids = std::collections::HashSet::new();
    for publisher in &store.publishers {
        if publisher.publisher == OFFICIAL_PUBLISHER
            || !valid_id(&publisher.publisher)
            || !valid_text(&publisher.label, MAX_LABEL_BYTES)
            || !valid_content_digest(&publisher.fingerprint)
            || publisher.fingerprint != sha256(publisher.public_key.as_bytes())
            || PublicKey::from_base64(&publisher.public_key).is_err()
            || publisher.trusted_at == 0
            || publisher.key_sequence == 0
            || publisher.key_sequence > (MAX_RETIRED_PUBLISHER_KEYS as u64 + 1)
            || publisher.retired_fingerprints.len() > MAX_RETIRED_PUBLISHER_KEYS
            || publisher.retired_fingerprints.len() as u64 + 1 != publisher.key_sequence
            || publisher
                .retired_fingerprints
                .iter()
                .any(|fingerprint| !valid_content_digest(fingerprint))
            || publisher
                .retired_fingerprints
                .contains(&publisher.fingerprint)
            || publisher
                .retired_fingerprints
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != publisher.retired_fingerprints.len()
            || (publisher.key_sequence == 1
                && (publisher.last_rotation_issued_at.is_some() || publisher.rotated_at.is_some()))
            || (publisher.key_sequence > 1
                && (publisher.last_rotation_issued_at.is_none() || publisher.rotated_at.is_none()))
            || publisher.last_rotation_issued_at == Some(0)
            || publisher.rotated_at == Some(0)
            || !publisher_ids.insert(&publisher.publisher)
        {
            return Err(error("invalid-publisher-store"));
        }
    }
    let mut revocation_ids = std::collections::HashSet::new();
    for list in &store.revocations {
        if !valid_id(&list.publisher)
            || list.sequence == 0
            || list.sequence > MAX_SAFE_INTEGER
            || list.revoked_digests.len() > MAX_REVOKED_DIGESTS
            || !list
                .revoked_digests
                .windows(2)
                .all(|items| items[0] < items[1])
            || list
                .revoked_digests
                .iter()
                .any(|digest| !valid_content_digest(digest))
            || !revocation_ids.insert(&list.publisher)
        {
            return Err(error("invalid-publisher-store"));
        }
    }
    Ok(())
}

fn migrate_store(mut store: PublisherTrustStore) -> Result<PublisherTrustStore, String> {
    match store.schema_version {
        1 => store.schema_version = 2,
        2 => {}
        _ => return Err(error("invalid-publisher-store")),
    }
    validate_store(&store)?;
    Ok(store)
}

fn app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| error("app-data-unavailable"))
}

fn package_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_root(app)?.join(PACKAGE_DIRECTORY))
}

fn trust_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_root(app)?.join(TRUST_STORE_FILE))
}

fn load_store_at(path: &Path) -> Result<PublisherTrustStore, String> {
    if !path.exists() {
        return Ok(PublisherTrustStore::default());
    }
    let bytes = read_bounded_regular(path, MAX_REVOCATION_BYTES, "invalid-publisher-store")?;
    let store: PublisherTrustStore =
        serde_json::from_slice(&bytes).map_err(|_| error("invalid-publisher-store"))?;
    migrate_store(store)
}

fn load_store(app: &AppHandle) -> Result<PublisherTrustStore, String> {
    load_store_at(&trust_store_path(app)?)
}

fn ensure_directory(path: &Path, code: &str) -> Result<(), String> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path).map_err(|_| error(code))?;
        if !metadata.file_type().is_dir() {
            return Err(error(code));
        }
        return Ok(());
    }
    fs::create_dir_all(path).map_err(|_| error(code))?;
    let metadata = fs::symlink_metadata(path).map_err(|_| error(code))?;
    if !metadata.file_type().is_dir() {
        return Err(error(code));
    }
    Ok(())
}

fn persist_store_at(path: &Path, store: &PublisherTrustStore) -> Result<(), String> {
    validate_store(store)?;
    let parent = path.parent().ok_or_else(|| error("app-data-unavailable"))?;
    ensure_directory(parent, "app-data-unavailable")?;
    let bytes = serde_json::to_vec(store).map_err(|_| error("publisher-store-write-failed"))?;
    let temporary = parent.join(format!(".{TRUST_STORE_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    let backup = parent.join(format!(".{TRUST_STORE_FILE}.backup"));
    {
        let mut file =
            File::create(&temporary).map_err(|_| error("publisher-store-write-failed"))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| error("publisher-store-write-failed"))?;
    }
    if backup.exists() {
        fs::remove_file(&backup).map_err(|_| error("publisher-store-write-failed"))?;
    }
    let had_current = path.exists();
    if had_current {
        fs::rename(path, &backup).map_err(|_| error("publisher-store-write-failed"))?;
    }
    if fs::rename(&temporary, path).is_err() {
        if had_current {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(error("publisher-store-write-failed"));
    }
    if had_current {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn persist_store(app: &AppHandle, store: &PublisherTrustStore) -> Result<(), String> {
    persist_store_at(&trust_store_path(app)?, store)
}

fn publisher_key<'a>(
    store: &'a PublisherTrustStore,
    publisher: &str,
) -> Result<(&'a str, String, String), String> {
    if publisher == OFFICIAL_PUBLISHER {
        let fingerprint = sha256(OFFICIAL_MINISIGN_KEY.as_bytes());
        return Ok((
            OFFICIAL_MINISIGN_KEY,
            fingerprint,
            OFFICIAL_VERIFIER_ID.to_string(),
        ));
    }
    let record = store
        .publishers
        .iter()
        .find(|record| record.publisher == publisher)
        .ok_or_else(|| error("publisher-not-trusted"))?;
    if record.revoked_at.is_some() {
        return Err(error("publisher-revoked"));
    }
    Ok((
        &record.public_key,
        record.fingerprint.clone(),
        format!("publisher-minisign:{}", record.fingerprint),
    ))
}

fn validate_publisher_rotation_with<F>(
    store: &PublisherTrustStore,
    envelope: &PublisherRotationEnvelope,
    now: u64,
    mut verify: F,
) -> Result<PublisherRotationPayload, String>
where
    F: FnMut(&str, &[u8], &str) -> Result<(), String>,
{
    if envelope.schema_version != 1
        || envelope.payload.is_empty()
        || envelope.payload.len() as u64 > MAX_ROTATION_BYTES
        || envelope.current_signature.is_empty()
        || envelope.current_signature.len() as u64 > MAX_SIGNATURE_BYTES
        || envelope.next_signature.is_empty()
        || envelope.next_signature.len() as u64 > MAX_SIGNATURE_BYTES
    {
        return Err(error("invalid-publisher-rotation-envelope"));
    }
    let payload: PublisherRotationPayload = serde_json::from_str(&envelope.payload)
        .map_err(|_| error("invalid-publisher-rotation-payload"))?;
    if payload.schema_version != 1
        || payload.publisher == OFFICIAL_PUBLISHER
        || !valid_id(&payload.publisher)
        || payload.sequence == 0
        || payload.sequence > MAX_SAFE_INTEGER
        || payload.issued_at == 0
        || payload.issued_at > now.saturating_add(MAX_CLOCK_SKEW_MS)
        || !valid_content_digest(&payload.current_fingerprint)
        || !valid_text(&payload.next_public_key, 256)
        || PublicKey::from_base64(&payload.next_public_key).is_err()
        || !valid_content_digest(&payload.next_fingerprint)
        || payload.next_fingerprint != sha256(payload.next_public_key.as_bytes())
        || payload.next_fingerprint == payload.current_fingerprint
    {
        return Err(error("invalid-publisher-rotation-payload"));
    }
    let current = store
        .publishers
        .iter()
        .find(|record| record.publisher == payload.publisher)
        .ok_or_else(|| error("publisher-not-found"))?;
    if current.revoked_at.is_some() {
        return Err(error("publisher-revoked"));
    }
    if payload.current_fingerprint != current.fingerprint {
        return Err(error("publisher-rotation-current-key-mismatch"));
    }
    if payload.sequence != current.key_sequence.saturating_add(1) {
        return Err(error("stale-publisher-rotation"));
    }
    if current.retired_fingerprints.len() >= MAX_RETIRED_PUBLISHER_KEYS {
        return Err(error("publisher-rotation-limit"));
    }
    if current
        .last_rotation_issued_at
        .is_some_and(|issued_at| payload.issued_at <= issued_at)
    {
        return Err(error("stale-publisher-rotation"));
    }
    if current
        .retired_fingerprints
        .contains(&payload.next_fingerprint)
    {
        return Err(error("publisher-key-retired"));
    }
    verify(
        &current.public_key,
        envelope.payload.as_bytes(),
        &envelope.current_signature,
    )
    .map_err(|_| error("publisher-rotation-current-signature-rejected"))?;
    verify(
        &payload.next_public_key,
        envelope.payload.as_bytes(),
        &envelope.next_signature,
    )
    .map_err(|_| error("publisher-rotation-next-signature-rejected"))?;
    Ok(payload)
}

fn publisher_rotation_candidate(
    store: &PublisherTrustStore,
    envelope: &PublisherRotationEnvelope,
    payload: &PublisherRotationPayload,
) -> Result<PublisherRotationCandidate, String> {
    let label = store
        .publishers
        .iter()
        .find(|record| record.publisher == payload.publisher)
        .map(|record| record.label.clone())
        .ok_or_else(|| error("publisher-not-found"))?;
    Ok(PublisherRotationCandidate {
        publisher: payload.publisher.clone(),
        label,
        sequence: payload.sequence,
        issued_at: payload.issued_at,
        current_fingerprint: payload.current_fingerprint.clone(),
        next_fingerprint: payload.next_fingerprint.clone(),
        payload: envelope.payload.clone(),
        current_signature: envelope.current_signature.clone(),
        next_signature: envelope.next_signature.clone(),
    })
}

fn apply_publisher_rotation_to_store(
    store: &mut PublisherTrustStore,
    payload: PublisherRotationPayload,
    rotated_at: u64,
) -> Result<PublisherRotationResult, String> {
    let (previous_fingerprint, retired_key_count) = {
        let record = store
            .publishers
            .iter_mut()
            .find(|record| record.publisher == payload.publisher)
            .ok_or_else(|| error("publisher-not-found"))?;
        let previous_fingerprint = record.fingerprint.clone();
        record
            .retired_fingerprints
            .push(previous_fingerprint.clone());
        record.public_key = payload.next_public_key;
        record.fingerprint = payload.next_fingerprint.clone();
        record.key_sequence = payload.sequence;
        record.last_rotation_issued_at = Some(payload.issued_at);
        record.rotated_at = Some(rotated_at);
        (previous_fingerprint, record.retired_fingerprints.len())
    };
    validate_store(store)?;
    Ok(PublisherRotationResult {
        changed: true,
        publisher: payload.publisher,
        sequence: payload.sequence,
        previous_fingerprint,
        fingerprint: payload.next_fingerprint,
        rotated_at,
        retired_key_count,
    })
}

fn assert_not_revoked(
    store: &PublisherTrustStore,
    publisher: &str,
    digest: &str,
) -> Result<(), String> {
    if store
        .revocations
        .iter()
        .find(|list| list.publisher == publisher)
        .is_some_and(|list| {
            list.revoked_digests
                .binary_search_by(|item| item.as_str().cmp(digest))
                .is_ok()
        })
    {
        return Err(error("package-revoked"));
    }
    Ok(())
}

fn inspect_package_with<F>(
    package_dir: &Path,
    expected_id: &str,
    verify: F,
) -> Result<VerifiedPackage, String>
where
    F: Fn(&PackageManifest, &[u8], &str) -> Result<(String, String), String>,
{
    if !valid_id(expected_id) {
        return Err(error("invalid-package-directory"));
    }
    let metadata = fs::symlink_metadata(package_dir).map_err(|_| error("package-unavailable"))?;
    if !metadata.file_type().is_dir() {
        return Err(error("invalid-package-directory"));
    }
    let manifest_bytes = read_bounded_regular(
        &package_dir.join(MANIFEST_FILE),
        MAX_MANIFEST_BYTES,
        "invalid-manifest-file",
    )?;
    let signature_bytes = read_bounded_regular(
        &package_dir.join(SIGNATURE_FILE),
        MAX_SIGNATURE_BYTES,
        "invalid-signature-file",
    )?;
    let signature =
        std::str::from_utf8(&signature_bytes).map_err(|_| error("invalid-signature"))?;
    let manifest: PackageManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| error("invalid-manifest"))?;
    validate_manifest(&manifest, expected_id)?;
    let (publisher_fingerprint, verifier_id) = verify(&manifest, &manifest_bytes, signature)?;
    let executable = package_dir.join(&manifest.connector.executable);
    let connector_hash = sha256_file(&executable)?;
    if connector_hash != manifest.connector.sha256 {
        return Err(error("connector-digest-mismatch"));
    }
    let permission_bytes =
        serde_json::to_vec(&manifest.permissions).map_err(|_| error("invalid-permissions"))?;
    Ok(VerifiedPackage {
        digest: sha256(&manifest_bytes),
        permission_digest: sha256(&permission_bytes),
        publisher_fingerprint,
        verifier_id,
        manifest,
        package_dir: package_dir.to_path_buf(),
        executable,
    })
}

fn inspect_package_named(
    package_dir: &Path,
    expected_id: &str,
    store: &PublisherTrustStore,
) -> Result<VerifiedPackage, String> {
    let package =
        inspect_package_with(package_dir, expected_id, |manifest, content, signature| {
            let (key, fingerprint, verifier_id) = publisher_key(store, &manifest.publisher)?;
            verify_minisign_with_key(key, content, signature)?;
            Ok((fingerprint, verifier_id))
        })?;
    assert_not_revoked(store, &package.manifest.publisher, &package.digest)?;
    Ok(package)
}

fn inspect_package(
    package_dir: &Path,
    store: &PublisherTrustStore,
) -> Result<VerifiedPackage, String> {
    let directory = package_dir
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| valid_id(name))
        .ok_or_else(|| error("invalid-package-directory"))?;
    inspect_package_named(package_dir, directory, store)
}

fn backup_version(app: &AppHandle, id: &str, store: &PublisherTrustStore) -> Option<u64> {
    let root = app_data_root(app).ok()?.join(BACKUP_DIRECTORY);
    inspect_package_named(&root.join(id), id, store)
        .ok()
        .map(|package| package.manifest.version)
}

fn package_by_id(
    root: &Path,
    id: &str,
    store: &PublisherTrustStore,
) -> Result<VerifiedPackage, String> {
    if !valid_id(id) {
        return Err(error("invalid-package-id"));
    }
    inspect_package_named(&root.join(id), id, store)
}

fn discover_at(
    root: &Path,
    backup_root: Option<&Path>,
    store: &PublisherTrustStore,
) -> Result<RuntimeExtensionDiscoveryReport, String> {
    if !root.exists() {
        return Ok(RuntimeExtensionDiscoveryReport::default());
    }
    let metadata = fs::symlink_metadata(root).map_err(|_| error("extensions-unavailable"))?;
    if !metadata.file_type().is_dir() {
        return Err(error("invalid-extensions-directory"));
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(root).map_err(|_| error("extensions-unavailable"))? {
        let entry = entry.map_err(|_| error("extensions-unavailable"))?;
        entries.push(entry.path());
        if entries.len() > MAX_PACKAGES {
            return Err(error("too-many-packages"));
        }
    }
    entries.sort();
    let mut report = RuntimeExtensionDiscoveryReport::default();
    for (index, directory) in entries.into_iter().enumerate() {
        let name = directory
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| valid_text(value, MAX_ID_BYTES))
            .map(str::to_owned)
            .unwrap_or_else(|| format!("invalid-{}", index + 1));
        match inspect_package(&directory, store) {
            Ok(package) => {
                let rollback_version = backup_root.and_then(|root| {
                    inspect_package_named(
                        &root.join(&package.manifest.id),
                        &package.manifest.id,
                        store,
                    )
                    .ok()
                    .map(|backup| backup.manifest.version)
                });
                report.packages.push(RuntimeExtensionPackage::from_verified(
                    &package,
                    rollback_version,
                ));
            }
            Err(code) => report.rejected.push(RejectedRuntimeExtensionPackage {
                directory: name,
                code,
            }),
        }
    }
    Ok(report)
}

fn picked_path(
    app: &AppHandle,
    label: &str,
    extensions: &[&str],
) -> Result<Option<PathBuf>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter(label, extensions)
        .blocking_pick_file();
    picked
        .map(|path| {
            path.into_path()
                .map_err(|_| error("selected-file-unavailable"))
        })
        .transpose()
}

fn parse_bundle(
    path: &Path,
    store: &PublisherTrustStore,
) -> Result<(VerifiedPackage, Vec<u8>, String, Vec<u8>), String> {
    let bytes = read_bounded_regular(path, MAX_BUNDLE_BYTES, "invalid-extension-bundle")?;
    let bundle: ExtensionBundle =
        serde_json::from_slice(&bytes).map_err(|_| error("invalid-extension-bundle"))?;
    if bundle.schema_version != 1
        || bundle.manifest.len() as u64 > MAX_MANIFEST_BYTES
        || bundle.signature.len() as u64 > MAX_SIGNATURE_BYTES
        || bundle.connector_base64.len() as u64 > (MAX_CONNECTOR_BYTES * 4 / 3 + 8)
    {
        return Err(error("invalid-extension-bundle"));
    }
    let manifest_bytes = bundle.manifest.into_bytes();
    let manifest: PackageManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| error("invalid-manifest"))?;
    validate_manifest(&manifest, &manifest.id)?;
    let (key, publisher_fingerprint, verifier_id) = publisher_key(store, &manifest.publisher)?;
    verify_minisign_with_key(key, &manifest_bytes, &bundle.signature)?;
    let connector = STANDARD
        .decode(bundle.connector_base64.as_bytes())
        .map_err(|_| error("invalid-connector-encoding"))?;
    if connector.len() as u64 > MAX_CONNECTOR_BYTES
        || format!("{:x}", Sha256::digest(&connector)) != manifest.connector.sha256
    {
        return Err(error("connector-digest-mismatch"));
    }
    let permission_bytes =
        serde_json::to_vec(&manifest.permissions).map_err(|_| error("invalid-permissions"))?;
    let package = VerifiedPackage {
        digest: sha256(&manifest_bytes),
        permission_digest: sha256(&permission_bytes),
        publisher_fingerprint,
        verifier_id,
        manifest,
        package_dir: PathBuf::new(),
        executable: PathBuf::new(),
    };
    assert_not_revoked(store, &package.manifest.publisher, &package.digest)?;
    Ok((package, manifest_bytes, bundle.signature, connector))
}

fn write_stage(
    stage: &Path,
    package: &VerifiedPackage,
    manifest: &[u8],
    signature: &str,
    connector: &[u8],
) -> Result<(), String> {
    fs::create_dir(stage).map_err(|_| error("extension-install-failed"))?;
    fs::write(stage.join(MANIFEST_FILE), manifest)
        .map_err(|_| error("extension-install-failed"))?;
    fs::write(stage.join(SIGNATURE_FILE), signature.as_bytes())
        .map_err(|_| error("extension-install-failed"))?;
    let executable = stage.join(&package.manifest.connector.executable);
    fs::write(&executable, connector).map_err(|_| error("extension-install-failed"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700))
            .map_err(|_| error("extension-install-failed"))?;
    }
    Ok(())
}

fn remove_directory_if_present(path: &Path, code: &str) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| error(code))?;
    if !metadata.file_type().is_dir() {
        return Err(error(code));
    }
    fs::remove_dir_all(path).map_err(|_| error(code))?;
    Ok(true)
}

fn install_bundle_at(app: &AppHandle, path: &Path) -> Result<PackageMutationResult, String> {
    let store = load_store(app)?;
    let (candidate, manifest, signature, connector) = parse_bundle(path, &store)?;
    let app_root = app_data_root(app)?;
    let extensions = app_root.join(PACKAGE_DIRECTORY);
    let staging = app_root.join(STAGING_DIRECTORY);
    let backups = app_root.join(BACKUP_DIRECTORY);
    ensure_directory(&extensions, "invalid-extensions-directory")?;
    ensure_directory(&staging, "extension-staging-unavailable")?;
    ensure_directory(&backups, "extension-backup-unavailable")?;
    let id = &candidate.manifest.id;
    let destination = extensions.join(id);
    let backup = backups.join(id);
    let stage = staging.join(format!("{}-{}", id, uuid::Uuid::new_v4()));
    write_stage(&stage, &candidate, &manifest, &signature, &connector)?;
    let staged = match inspect_package_named(&stage, id, &store) {
        Ok(package) => package,
        Err(code) => {
            let _ = fs::remove_dir_all(&stage);
            return Err(code);
        }
    };
    let current = if destination.exists() {
        Some(package_by_id(&extensions, id, &store)?)
    } else {
        None
    };
    if let Some(current) = &current {
        if current.digest == staged.digest {
            let _ = fs::remove_dir_all(&stage);
            return Ok(PackageMutationResult {
                changed: false,
                cancelled: false,
                operation: Some("unchanged"),
                package: Some(RuntimeExtensionPackage::from_verified(
                    current,
                    backup_version(app, id, &store),
                )),
                previous_version: Some(current.manifest.version),
            });
        }
        if staged.manifest.version <= current.manifest.version {
            let _ = fs::remove_dir_all(&stage);
            return Err(error(
                if staged.manifest.version == current.manifest.version {
                    "extension-version-conflict"
                } else {
                    "extension-downgrade-rejected"
                },
            ));
        }
    }
    remove_directory_if_present(&backup, "extension-backup-unavailable")?;
    if destination.exists() {
        fs::rename(&destination, &backup).map_err(|_| error("extension-install-failed"))?;
    }
    if fs::rename(&stage, &destination).is_err() {
        if backup.exists() {
            let _ = fs::rename(&backup, &destination);
        }
        let _ = fs::remove_dir_all(&stage);
        return Err(error("extension-install-failed"));
    }
    let installed = package_by_id(&extensions, id, &store)?;
    let previous_version = current.as_ref().map(|package| package.manifest.version);
    Ok(PackageMutationResult {
        changed: true,
        cancelled: false,
        operation: Some(if current.is_some() {
            "updated"
        } else {
            "installed"
        }),
        package: Some(RuntimeExtensionPackage::from_verified(
            &installed,
            previous_version,
        )),
        previous_version,
    })
}

fn update_candidate_for(
    token: &str,
    registry: &crate::extension_registry::RegistryUpdateEntry,
    current: &VerifiedPackage,
    next: &VerifiedPackage,
) -> Result<RuntimeExtensionUpdateCandidate, String> {
    let entry = &registry.entry;
    if !uuid::Uuid::parse_str(token).is_ok_and(|value| value.to_string() == token) {
        return Err(error("invalid-extension-update-token"));
    }
    if entry.id != current.manifest.id
        || entry.id != next.manifest.id
        || entry.label != next.manifest.label
        || entry.version <= current.manifest.version
        || entry.version != next.manifest.version
        || entry.publisher != current.manifest.publisher
        || entry.publisher != next.manifest.publisher
        || entry.publisher_fingerprint != current.publisher_fingerprint
        || entry.publisher_fingerprint != next.publisher_fingerprint
        || entry.permissions != next.manifest.permissions
        || entry.digest != next.digest
    {
        return Err(error("extension-update-registry-mismatch"));
    }
    let added_permissions = next
        .manifest
        .permissions
        .iter()
        .filter(|permission| !current.manifest.permissions.contains(permission))
        .cloned()
        .collect();
    let removed_permissions = current
        .manifest
        .permissions
        .iter()
        .filter(|permission| !next.manifest.permissions.contains(permission))
        .cloned()
        .collect();
    Ok(RuntimeExtensionUpdateCandidate {
        token: token.to_string(),
        registry_sequence: registry.sequence,
        registry_expires_at: registry.expires_at,
        id: entry.id.clone(),
        label: entry.label.clone(),
        current_version: current.manifest.version,
        next_version: next.manifest.version,
        publisher: entry.publisher.clone(),
        publisher_fingerprint: entry.publisher_fingerprint.clone(),
        current_permissions: current.manifest.permissions.clone(),
        next_permissions: next.manifest.permissions.clone(),
        added_permissions,
        removed_permissions,
        digest: entry.digest.clone(),
        package_sha256: entry.package_sha256.clone(),
        published_at: entry.published_at,
    })
}

fn reset_update_staging(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app_data_root(app)?.join(UPDATE_STAGING_DIRECTORY);
    ensure_directory(&root, "extension-update-staging-unavailable")?;
    for entry in fs::read_dir(&root).map_err(|_| error("extension-update-staging-unavailable"))? {
        let path = entry
            .map_err(|_| error("extension-update-staging-unavailable"))?
            .path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| error("extension-update-staging-unavailable"))?;
        if !metadata.file_type().is_file() {
            return Err(error("invalid-extension-update-staging"));
        }
        fs::remove_file(path).map_err(|_| error("extension-update-staging-unavailable"))?;
    }
    Ok(root)
}

fn stage_downloaded_update(app: &AppHandle, bytes: &[u8]) -> Result<(String, PathBuf), String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_BUNDLE_BYTES {
        return Err(error("invalid-extension-bundle"));
    }
    let root = reset_update_staging(app)?;
    let token = uuid::Uuid::new_v4().to_string();
    let path = root.join(format!("{token}.ideall-extension"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| error("extension-update-stage-write-failed"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|_| error("extension-update-stage-write-failed"))?;
    }
    if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() {
        let _ = fs::remove_file(&path);
        return Err(error("extension-update-stage-write-failed"));
    }
    Ok((token, path))
}

fn staged_update_path(app: &AppHandle, token: &str) -> Result<PathBuf, String> {
    let parsed =
        uuid::Uuid::parse_str(token).map_err(|_| error("invalid-extension-update-token"))?;
    if parsed.to_string() != token {
        return Err(error("invalid-extension-update-token"));
    }
    Ok(app_data_root(app)?
        .join(UPDATE_STAGING_DIRECTORY)
        .join(format!("{token}.ideall-extension")))
}

fn staged_bundle_sha256(path: &Path) -> Result<String, String> {
    let bytes = read_bounded_regular(path, MAX_BUNDLE_BYTES, "invalid-extension-update-stage")?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

async fn prepare_update(
    app: &AppHandle,
    id: &str,
) -> Result<RuntimeExtensionUpdateCandidate, String> {
    if !valid_id(id) {
        return Err(error("invalid-package-id"));
    }
    let now = now_ms()?;
    let registry = crate::extension_registry::registry_update_entry(app, id, now)?;
    let store = load_store(app)?;
    let extensions = app_data_root(app)?.join(PACKAGE_DIRECTORY);
    let current = package_by_id(&extensions, id, &store)?;
    if registry.entry.version <= current.manifest.version {
        return Err(error("extension-update-not-available"));
    }
    let bytes = crate::extension_registry::download_registry_package(&registry.entry).await?;
    let (token, path) = stage_downloaded_update(app, &bytes)?;
    drop(bytes);
    let candidate = (|| {
        let (next, _, _, _) = parse_bundle(&path, &store)?;
        update_candidate_for(&token, &registry, &current, &next)
    })();
    if candidate.is_err() {
        let _ = fs::remove_file(path);
    }
    candidate
}

fn apply_prepared_update(
    app: &AppHandle,
    candidate: &RuntimeExtensionUpdateCandidate,
) -> Result<PackageMutationResult, String> {
    let path = staged_update_path(app, &candidate.token)?;
    let result = (|| {
        let now = now_ms()?;
        let registry = crate::extension_registry::registry_update_entry(app, &candidate.id, now)?;
        if staged_bundle_sha256(&path)? != registry.entry.package_sha256 {
            return Err(error("extension-package-sha256-mismatch"));
        }
        let store = load_store(app)?;
        let extensions = app_data_root(app)?.join(PACKAGE_DIRECTORY);
        let current = package_by_id(&extensions, &candidate.id, &store)?;
        let (next, _, _, _) = parse_bundle(&path, &store)?;
        let expected = update_candidate_for(&candidate.token, &registry, &current, &next)?;
        if &expected != candidate {
            return Err(error("extension-update-candidate-changed"));
        }
        install_bundle_at(app, &path)
    })();
    let _ = fs::remove_file(path);
    result
}

fn discard_prepared_update(app: &AppHandle, token: &str) -> Result<bool, String> {
    let path = staged_update_path(app, token)?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err(error("invalid-extension-update-stage")),
    };
    if !metadata.file_type().is_file() {
        return Err(error("invalid-extension-update-stage"));
    }
    fs::remove_file(path).map_err(|_| error("extension-update-discard-failed"))?;
    Ok(true)
}

fn rollback_at(app: &AppHandle, id: &str) -> Result<PackageMutationResult, String> {
    if !valid_id(id) {
        return Err(error("invalid-package-id"));
    }
    let store = load_store(app)?;
    let app_root = app_data_root(app)?;
    let extensions = app_root.join(PACKAGE_DIRECTORY);
    let backups = app_root.join(BACKUP_DIRECTORY);
    let staging = app_root.join(STAGING_DIRECTORY);
    ensure_directory(&extensions, "invalid-extensions-directory")?;
    ensure_directory(&backups, "extension-backup-unavailable")?;
    ensure_directory(&staging, "extension-staging-unavailable")?;
    let current_path = extensions.join(id);
    let backup_path = backups.join(id);
    let current = inspect_package_named(&current_path, id, &store)?;
    inspect_package_named(&backup_path, id, &store)?;
    let swap = staging.join(format!("{}-rollback-{}", id, uuid::Uuid::new_v4()));
    fs::rename(&current_path, &swap).map_err(|_| error("extension-rollback-failed"))?;
    if fs::rename(&backup_path, &current_path).is_err() {
        let _ = fs::rename(&swap, &current_path);
        return Err(error("extension-rollback-failed"));
    }
    if fs::rename(&swap, &backup_path).is_err() {
        let _ = fs::rename(&current_path, &backup_path);
        let _ = fs::rename(&swap, &current_path);
        return Err(error("extension-rollback-failed"));
    }
    let installed = inspect_package_named(&current_path, id, &store)?;
    Ok(PackageMutationResult {
        changed: true,
        cancelled: false,
        operation: Some("rolled-back"),
        package: Some(RuntimeExtensionPackage::from_verified(
            &installed,
            Some(current.manifest.version),
        )),
        previous_version: Some(current.manifest.version),
    })
}

#[tauri::command]
pub(crate) fn runtime_extension_discover(
    app: AppHandle,
) -> Result<RuntimeExtensionDiscoveryReport, String> {
    let store = load_store(&app)?;
    let app_root = app_data_root(&app)?;
    discover_at(
        &app_root.join(PACKAGE_DIRECTORY),
        Some(&app_root.join(BACKUP_DIRECTORY)),
        &store,
    )
}

#[tauri::command]
pub(crate) fn runtime_extension_verify(
    app: AppHandle,
    id: String,
    version: u64,
    digest: String,
    permission_digest: String,
) -> Result<RuntimeExtensionVerificationReceipt, String> {
    if !valid_id(&id)
        || version == 0
        || version > MAX_SAFE_INTEGER
        || !valid_content_digest(&digest)
        || !valid_content_digest(&permission_digest)
    {
        return Err(error("invalid-verification-request"));
    }
    let store = load_store(&app)?;
    let package = package_by_id(&package_root(&app)?, &id, &store)?;
    if package.manifest.version != version
        || package.digest != digest
        || package.permission_digest != permission_digest
    {
        return Err(error("package-changed"));
    }
    Ok(RuntimeExtensionVerificationReceipt {
        receipt_id: format!("minisign:{digest}"),
        verifier_id: package.verifier_id,
        id,
        version,
        digest,
        permission_digest,
        verified_at: now_ms()?,
    })
}

#[tauri::command]
pub(crate) async fn runtime_extension_spawn(
    app: AppHandle,
    sessions: State<'_, AcpSessions>,
    session_id: String,
    package_id: String,
    digest: String,
) -> Result<(), String> {
    if !valid_session_id(&session_id) || !valid_id(&package_id) || !valid_content_digest(&digest) {
        return Err(error("invalid-spawn-request"));
    }
    let store = load_store(&app)?;
    let package = package_by_id(&package_root(&app)?, &package_id, &store)?;
    if package.digest != digest {
        return Err(error("package-changed"));
    }
    acp_transport::spawn_resolved(
        app,
        &sessions,
        session_id,
        package.executable,
        package.manifest.connector.args,
        Some(package.package_dir),
        true,
    )
    .await
}

#[tauri::command]
pub(crate) fn runtime_extension_publisher_list(
    app: AppHandle,
) -> Result<Vec<PublisherStatus>, String> {
    let store = load_store(&app)?;
    let official_revocations = store
        .revocations
        .iter()
        .find(|list| list.publisher == OFFICIAL_PUBLISHER);
    let mut result = vec![PublisherStatus {
        publisher: OFFICIAL_PUBLISHER.to_string(),
        label: "ideall official".to_string(),
        fingerprint: sha256(OFFICIAL_MINISIGN_KEY.as_bytes()),
        status: "official",
        trusted_at: None,
        revoked_at: None,
        revocation_sequence: official_revocations.map(|list| list.sequence),
        revocation_issued_at: official_revocations.map(|list| list.issued_at),
        revoked_digest_count: official_revocations
            .map(|list| list.revoked_digests.len())
            .unwrap_or(0),
        key_sequence: 1,
        rotated_at: None,
        retired_key_count: 0,
    }];
    for publisher in &store.publishers {
        let revocations = store
            .revocations
            .iter()
            .find(|list| list.publisher == publisher.publisher);
        result.push(PublisherStatus {
            publisher: publisher.publisher.clone(),
            label: publisher.label.clone(),
            fingerprint: publisher.fingerprint.clone(),
            status: if publisher.revoked_at.is_some() {
                "revoked"
            } else {
                "trusted"
            },
            trusted_at: Some(publisher.trusted_at),
            revoked_at: publisher.revoked_at,
            revocation_sequence: revocations.map(|list| list.sequence),
            revocation_issued_at: revocations.map(|list| list.issued_at),
            revoked_digest_count: revocations
                .map(|list| list.revoked_digests.len())
                .unwrap_or(0),
            key_sequence: publisher.key_sequence,
            rotated_at: publisher.rotated_at,
            retired_key_count: publisher.retired_fingerprints.len(),
        });
    }
    result.sort_by(|left, right| left.publisher.cmp(&right.publisher));
    Ok(result)
}

#[tauri::command]
pub(crate) fn runtime_extension_publisher_inspect(
    app: AppHandle,
) -> Result<Option<PublisherRootCandidate>, String> {
    let Some(path) = picked_path(&app, "ideall publisher root", &["json", "ideall-publisher"])?
    else {
        return Ok(None);
    };
    let bytes = read_bounded_regular(&path, MAX_ROOT_BYTES, "invalid-publisher-root-file")?;
    let document: PublisherRootDocument =
        serde_json::from_slice(&bytes).map_err(|_| error("invalid-publisher-root"))?;
    if document.schema_version != 1
        || document.publisher == OFFICIAL_PUBLISHER
        || !valid_id(&document.publisher)
        || !valid_text(&document.label, MAX_LABEL_BYTES)
        || PublicKey::from_base64(&document.public_key).is_err()
    {
        return Err(error("invalid-publisher-root"));
    }
    Ok(Some(PublisherRootCandidate {
        fingerprint: sha256(document.public_key.as_bytes()),
        publisher: document.publisher,
        label: document.label,
        public_key: document.public_key,
    }))
}

#[tauri::command]
pub(crate) fn runtime_extension_publisher_trust(
    app: AppHandle,
    publisher: String,
    label: String,
    public_key: String,
    fingerprint: String,
) -> Result<bool, String> {
    if publisher == OFFICIAL_PUBLISHER
        || !valid_id(&publisher)
        || !valid_text(&label, MAX_LABEL_BYTES)
        || PublicKey::from_base64(&public_key).is_err()
        || !valid_content_digest(&fingerprint)
        || fingerprint != sha256(public_key.as_bytes())
    {
        return Err(error("invalid-publisher-root"));
    }
    let mut store = load_store(&app)?;
    let timestamp = now_ms()?;
    let changed = match store
        .publishers
        .iter_mut()
        .find(|record| record.publisher == publisher)
    {
        Some(record) => {
            if record.fingerprint != fingerprint {
                return Err(error("publisher-key-conflict"));
            }
            let changed = record.revoked_at.is_some() || record.label != label;
            record.label = label;
            record.revoked_at = None;
            record.trusted_at = timestamp;
            changed
        }
        None => {
            if store.publishers.len() >= MAX_PUBLISHERS {
                return Err(error("too-many-publishers"));
            }
            store.publishers.push(StoredPublisher {
                publisher,
                label,
                public_key,
                fingerprint,
                trusted_at: timestamp,
                revoked_at: None,
                key_sequence: 1,
                last_rotation_issued_at: None,
                rotated_at: None,
                retired_fingerprints: Vec::new(),
            });
            true
        }
    };
    if changed {
        store
            .publishers
            .sort_by(|left, right| left.publisher.cmp(&right.publisher));
        persist_store(&app, &store)?;
    }
    Ok(changed)
}

#[tauri::command]
pub(crate) fn runtime_extension_publisher_rotation_inspect(
    app: AppHandle,
) -> Result<Option<PublisherRotationCandidate>, String> {
    let Some(path) = picked_path(
        &app,
        "ideall publisher key rotation",
        &["json", "ideall-key-rotation"],
    )?
    else {
        return Ok(None);
    };
    let bytes = read_bounded_regular(&path, MAX_ROTATION_BYTES, "invalid-publisher-rotation-file")?;
    let envelope: PublisherRotationEnvelope =
        serde_json::from_slice(&bytes).map_err(|_| error("invalid-publisher-rotation-envelope"))?;
    let store = load_store(&app)?;
    let payload = validate_publisher_rotation_with(
        &store,
        &envelope,
        now_ms()?,
        |key, content, signature| verify_minisign_with_key(key, content, signature),
    )?;
    Ok(Some(publisher_rotation_candidate(
        &store, &envelope, &payload,
    )?))
}

#[tauri::command]
pub(crate) fn runtime_extension_publisher_rotation_apply(
    app: AppHandle,
    candidate: PublisherRotationCandidate,
) -> Result<PublisherRotationResult, String> {
    let envelope = PublisherRotationEnvelope {
        schema_version: 1,
        payload: candidate.payload.clone(),
        current_signature: candidate.current_signature.clone(),
        next_signature: candidate.next_signature.clone(),
    };
    let mut store = load_store(&app)?;
    let timestamp = now_ms()?;
    let payload = validate_publisher_rotation_with(
        &store,
        &envelope,
        timestamp,
        |key, content, signature| verify_minisign_with_key(key, content, signature),
    )?;
    let expected = publisher_rotation_candidate(&store, &envelope, &payload)?;
    if candidate != expected {
        return Err(error("publisher-rotation-candidate-changed"));
    }
    let result = apply_publisher_rotation_to_store(&mut store, payload, timestamp)?;
    persist_store(&app, &store)?;
    Ok(result)
}

#[tauri::command]
pub(crate) fn runtime_extension_publisher_revoke(
    app: AppHandle,
    publisher: String,
    fingerprint: String,
) -> Result<bool, String> {
    if publisher == OFFICIAL_PUBLISHER
        || !valid_id(&publisher)
        || !valid_content_digest(&fingerprint)
    {
        return Err(error("invalid-publisher-revocation"));
    }
    let mut store = load_store(&app)?;
    let record = store
        .publishers
        .iter_mut()
        .find(|record| record.publisher == publisher && record.fingerprint == fingerprint)
        .ok_or_else(|| error("publisher-not-found"))?;
    if record.revoked_at.is_some() {
        return Ok(false);
    }
    record.revoked_at = Some(now_ms()?);
    persist_store(&app, &store)?;
    Ok(true)
}

#[tauri::command]
pub(crate) fn runtime_extension_revocation_import(
    app: AppHandle,
) -> Result<RevocationImportResult, String> {
    let Some(path) = picked_path(
        &app,
        "ideall publisher revocations",
        &["json", "ideall-revocations"],
    )?
    else {
        return Ok(RevocationImportResult {
            changed: false,
            cancelled: true,
            publisher: None,
            sequence: None,
            revoked_digest_count: 0,
        });
    };
    let bytes = read_bounded_regular(&path, MAX_REVOCATION_BYTES, "invalid-revocation-file")?;
    let envelope: RevocationEnvelope =
        serde_json::from_slice(&bytes).map_err(|_| error("invalid-revocation-envelope"))?;
    if envelope.schema_version != 1
        || envelope.payload.len() as u64 > MAX_REVOCATION_BYTES
        || envelope.signature.len() as u64 > MAX_SIGNATURE_BYTES
    {
        return Err(error("invalid-revocation-envelope"));
    }
    let payload: RevocationPayload =
        serde_json::from_str(&envelope.payload).map_err(|_| error("invalid-revocation-payload"))?;
    if payload.schema_version != 1
        || !valid_id(&payload.publisher)
        || payload.sequence == 0
        || payload.sequence > MAX_SAFE_INTEGER
        || payload.issued_at == 0
        || payload.revoked_digests.len() > MAX_REVOKED_DIGESTS
        || !payload
            .revoked_digests
            .windows(2)
            .all(|items| items[0] < items[1])
        || payload
            .revoked_digests
            .iter()
            .any(|digest| !valid_content_digest(digest))
    {
        return Err(error("invalid-revocation-payload"));
    }
    let mut store = load_store(&app)?;
    let (key, _, _) = publisher_key(&store, &payload.publisher)?;
    verify_minisign_with_key(key, envelope.payload.as_bytes(), &envelope.signature)?;
    if let Some(current) = store
        .revocations
        .iter()
        .find(|list| list.publisher == payload.publisher)
    {
        if payload.sequence <= current.sequence {
            return Err(error("stale-revocation-list"));
        }
        if current
            .revoked_digests
            .iter()
            .any(|digest| payload.revoked_digests.binary_search(digest).is_err())
        {
            return Err(error("revocation-list-not-cumulative"));
        }
    }
    let publisher = payload.publisher.clone();
    let sequence = payload.sequence;
    let count = payload.revoked_digests.len();
    let replacement = StoredRevocationList {
        publisher: payload.publisher,
        sequence: payload.sequence,
        issued_at: payload.issued_at,
        imported_at: now_ms()?,
        revoked_digests: payload.revoked_digests,
    };
    if let Some(current) = store
        .revocations
        .iter_mut()
        .find(|list| list.publisher == replacement.publisher)
    {
        *current = replacement;
    } else {
        store.revocations.push(replacement);
    }
    store
        .revocations
        .sort_by(|left, right| left.publisher.cmp(&right.publisher));
    persist_store(&app, &store)?;
    Ok(RevocationImportResult {
        changed: true,
        cancelled: false,
        publisher: Some(publisher),
        sequence: Some(sequence),
        revoked_digest_count: count,
    })
}

#[tauri::command]
pub(crate) async fn runtime_extension_update_prepare(
    app: AppHandle,
    id: String,
) -> Result<RuntimeExtensionUpdateCandidate, String> {
    prepare_update(&app, &id).await
}

#[tauri::command]
pub(crate) fn runtime_extension_update_apply(
    app: AppHandle,
    candidate: RuntimeExtensionUpdateCandidate,
) -> Result<PackageMutationResult, String> {
    apply_prepared_update(&app, &candidate)
}

#[tauri::command]
pub(crate) fn runtime_extension_update_discard(
    app: AppHandle,
    token: String,
) -> Result<bool, String> {
    discard_prepared_update(&app, &token)
}

#[tauri::command]
pub(crate) fn runtime_extension_install(app: AppHandle) -> Result<PackageMutationResult, String> {
    let Some(path) = picked_path(
        &app,
        "ideall signed extension",
        &["ideall-extension", "json"],
    )?
    else {
        return Ok(PackageMutationResult {
            changed: false,
            cancelled: true,
            operation: None,
            package: None,
            previous_version: None,
        });
    };
    install_bundle_at(&app, &path)
}

#[tauri::command]
pub(crate) fn runtime_extension_rollback(
    app: AppHandle,
    id: String,
) -> Result<PackageMutationResult, String> {
    rollback_at(&app, &id)
}

#[tauri::command]
pub(crate) fn runtime_extension_uninstall(app: AppHandle, id: String) -> Result<bool, String> {
    if !valid_id(&id) {
        return Err(error("invalid-package-id"));
    }
    let app_root = app_data_root(&app)?;
    let changed = remove_directory_if_present(
        &app_root.join(PACKAGE_DIRECTORY).join(&id),
        "extension-uninstall-failed",
    )?;
    let backup_changed = remove_directory_if_present(
        &app_root.join(BACKUP_DIRECTORY).join(&id),
        "extension-uninstall-failed",
    )?;
    Ok(changed || backup_changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_package(id: &str, permissions: &[&str]) -> (PathBuf, Vec<u8>) {
        let root = std::env::temp_dir().join(format!("ideall-extension-{}", uuid::Uuid::new_v4()));
        let package = root.join(id);
        fs::create_dir_all(&package).unwrap();
        let connector = package.join("connector");
        fs::write(&connector, b"connector fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&connector, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let connector_hash = sha256_file(&connector).unwrap();
        let manifest = serde_json::json!({
            "schemaVersion": 1,
            "id": id,
            "label": "Fixture connector",
            "version": 1,
            "publisher": OFFICIAL_PUBLISHER,
            "permissions": permissions,
            "connector": {
                "protocol": "mcp-stdio",
                "executable": "connector",
                "sha256": connector_hash,
                "args": ["--stdio"]
            }
        });
        let bytes = serde_json::to_vec(&manifest).unwrap();
        fs::write(package.join(MANIFEST_FILE), &bytes).unwrap();
        fs::write(package.join(SIGNATURE_FILE), b"fixture signature").unwrap();
        (root, bytes)
    }

    fn accept_fixture(
        _manifest: &PackageManifest,
        _content: &[u8],
        _signature: &str,
    ) -> Result<(String, String), String> {
        Ok((sha256(b"fixture-key"), "fixture-verifier".into()))
    }

    fn publisher_store_with_key(key: &str) -> PublisherTrustStore {
        PublisherTrustStore {
            schema_version: 2,
            publishers: vec![StoredPublisher {
                publisher: "acme.tools".into(),
                label: "Acme Tools".into(),
                public_key: key.into(),
                fingerprint: sha256(key.as_bytes()),
                trusted_at: 10,
                revoked_at: None,
                key_sequence: 1,
                last_rotation_issued_at: None,
                rotated_at: None,
                retired_fingerprints: Vec::new(),
            }],
            revocations: Vec::new(),
        }
    }

    fn rotation_envelope(
        current_key: &str,
        next_key: &str,
        sequence: u64,
        issued_at: u64,
    ) -> PublisherRotationEnvelope {
        let payload = serde_json::json!({
            "schemaVersion": 1,
            "publisher": "acme.tools",
            "sequence": sequence,
            "issuedAt": issued_at,
            "currentFingerprint": sha256(current_key.as_bytes()),
            "nextPublicKey": next_key,
            "nextFingerprint": sha256(next_key.as_bytes()),
        });
        PublisherRotationEnvelope {
            schema_version: 1,
            payload: serde_json::to_string(&payload).unwrap(),
            current_signature: "current-signature".into(),
            next_signature: "next-signature".into(),
        }
    }

    fn verified_update_package(
        version: u64,
        permissions: &[&str],
        digest: &str,
    ) -> VerifiedPackage {
        let permissions = permissions
            .iter()
            .map(|permission| permission.to_string())
            .collect::<Vec<_>>();
        VerifiedPackage {
            manifest: PackageManifest {
                schema_version: 1,
                id: "acme.search".into(),
                label: "Acme Search".into(),
                version,
                publisher: "acme.tools".into(),
                permissions: permissions.clone(),
                connector: ConnectorManifest {
                    protocol: ConnectorProtocol::McpStdio,
                    executable: "connector".into(),
                    sha256: "a".repeat(64),
                    args: Vec::new(),
                },
            },
            digest: digest.into(),
            permission_digest: sha256(&serde_json::to_vec(&permissions).unwrap()),
            publisher_fingerprint: sha256(b"publisher-key"),
            verifier_id: "fixture-verifier".into(),
            package_dir: PathBuf::new(),
            executable: PathBuf::new(),
        }
    }

    #[test]
    fn minisign_verifier_accepts_documented_vector_and_rejects_mutation() {
        let key = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
        let signature = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1633700835\tfile:test\tprehashed\nwLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ==";
        assert!(verify_minisign_with_key(key, b"test", signature).is_ok());
        assert_eq!(
            verify_minisign_with_key(key, b"changed", signature),
            Err("signature-rejected".into())
        );
    }

    #[test]
    fn extension_trust_root_matches_the_tauri_updater_key() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let encoded = config["plugins"]["updater"]["pubkey"].as_str().unwrap();
        let decoded = STANDARD.decode(encoded).unwrap();
        let updater_key = std::str::from_utf8(&decoded)
            .unwrap()
            .lines()
            .find(|line| line.starts_with("RW"))
            .unwrap();
        assert_eq!(OFFICIAL_MINISIGN_KEY, updater_key);
    }

    #[test]
    fn package_parser_binds_manifest_permissions_and_connector_digest() {
        let (root, bytes) = temp_package("example.connector", &["resources:read", "tools:invoke"]);
        let package = inspect_package_with(
            &root.join("example.connector"),
            "example.connector",
            |_, content, _| {
                assert_eq!(content, bytes);
                accept_fixture(
                    &serde_json::from_slice(content).unwrap(),
                    content,
                    "fixture",
                )
            },
        )
        .unwrap();
        assert_eq!(package.manifest.id, "example.connector");
        assert!(package.digest.starts_with("sha256:"));
        assert!(package.permission_digest.starts_with("sha256:"));

        fs::write(&package.executable, b"tampered").unwrap();
        assert_eq!(
            inspect_package_with(
                &root.join("example.connector"),
                "example.connector",
                accept_fixture,
            )
            .unwrap_err(),
            "connector-digest-mismatch"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn package_parser_rejects_permission_reordering_and_unknown_fields() {
        let (root, _) = temp_package("invalid.connector", &["tools:invoke", "resources:read"]);
        assert_eq!(
            inspect_package_with(
                &root.join("invalid.connector"),
                "invalid.connector",
                accept_fixture,
            )
            .unwrap_err(),
            "invalid-permissions"
        );

        let manifest_path = root.join("invalid.connector").join(MANIFEST_FILE);
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        value["permissions"] = serde_json::json!(["resources:read"]);
        value["unexpected"] = serde_json::json!(true);
        fs::write(&manifest_path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(
            inspect_package_with(
                &root.join("invalid.connector"),
                "invalid.connector",
                accept_fixture,
            )
            .unwrap_err(),
            "invalid-manifest"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn package_parser_rejects_connector_path_traversal() {
        let (root, _) = temp_package("traversal.connector", &["resources:read"]);
        let manifest_path = root.join("traversal.connector").join(MANIFEST_FILE);
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        value["connector"]["executable"] = serde_json::json!("../escape");
        fs::write(&manifest_path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(
            inspect_package_with(
                &root.join("traversal.connector"),
                "traversal.connector",
                accept_fixture,
            )
            .unwrap_err(),
            "invalid-connector"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn publisher_store_rejects_tampering_and_revocation_rollback() {
        let key = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
        let digest = sha256(b"revoked-package");
        let store = PublisherTrustStore {
            schema_version: 2,
            publishers: vec![StoredPublisher {
                publisher: "acme.tools".into(),
                label: "Acme Tools".into(),
                public_key: key.into(),
                fingerprint: sha256(key.as_bytes()),
                trusted_at: 1,
                revoked_at: None,
                key_sequence: 1,
                last_rotation_issued_at: None,
                rotated_at: None,
                retired_fingerprints: Vec::new(),
            }],
            revocations: vec![StoredRevocationList {
                publisher: "acme.tools".into(),
                sequence: 2,
                issued_at: 2,
                imported_at: 3,
                revoked_digests: vec![digest.clone()],
            }],
        };
        assert!(validate_store(&store).is_ok());
        assert_eq!(
            assert_not_revoked(&store, "acme.tools", &digest),
            Err("package-revoked".into())
        );
        let mut tampered = store;
        tampered.publishers[0].fingerprint = sha256(b"other");
        assert_eq!(
            validate_store(&tampered),
            Err("invalid-publisher-store".into())
        );
    }

    #[test]
    fn publisher_rotation_requires_both_keys_and_rejects_replay_or_retired_keys() {
        let current_key = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
        let next_key = OFFICIAL_MINISIGN_KEY;
        let mut store = publisher_store_with_key(current_key);
        let envelope = rotation_envelope(current_key, next_key, 2, 100);
        let payload =
            validate_publisher_rotation_with(&store, &envelope, 200, |key, content, signature| {
                assert_eq!(content, envelope.payload.as_bytes());
                match signature {
                    "current-signature" if key == current_key => Ok(()),
                    "next-signature" if key == next_key => Ok(()),
                    _ => Err(error("rejected")),
                }
            })
            .unwrap();
        let candidate = publisher_rotation_candidate(&store, &envelope, &payload).unwrap();
        assert_eq!(
            candidate.current_fingerprint,
            sha256(current_key.as_bytes())
        );
        assert_eq!(candidate.next_fingerprint, sha256(next_key.as_bytes()));

        let result = apply_publisher_rotation_to_store(&mut store, payload, 250).unwrap();
        assert_eq!(result.sequence, 2);
        assert_eq!(result.retired_key_count, 1);
        assert_eq!(store.publishers[0].public_key, next_key);
        assert_eq!(
            validate_publisher_rotation_with(&store, &envelope, 300, |_, _, _| Ok(())).unwrap_err(),
            "publisher-rotation-current-key-mismatch"
        );

        let rotate_back = rotation_envelope(next_key, current_key, 3, 200);
        assert_eq!(
            validate_publisher_rotation_with(&store, &rotate_back, 300, |_, _, _| Ok(()))
                .unwrap_err(),
            "publisher-key-retired"
        );
    }

    #[test]
    fn publisher_rotation_rejects_missing_new_key_proof_and_migrates_v1_store() {
        let current_key = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
        let next_key = OFFICIAL_MINISIGN_KEY;
        let store = publisher_store_with_key(current_key);
        let envelope = rotation_envelope(current_key, next_key, 2, 100);
        assert_eq!(
            validate_publisher_rotation_with(&store, &envelope, 200, |_, _, signature| {
                if signature == "current-signature" {
                    Ok(())
                } else {
                    Err(error("rejected"))
                }
            })
            .unwrap_err(),
            "publisher-rotation-next-signature-rejected"
        );

        let legacy = serde_json::json!({
            "schemaVersion": 1,
            "publishers": [{
                "publisher": "acme.tools",
                "label": "Acme Tools",
                "publicKey": current_key,
                "fingerprint": sha256(current_key.as_bytes()),
                "trustedAt": 10,
                "revokedAt": null
            }],
            "revocations": []
        });
        let decoded: PublisherTrustStore = serde_json::from_value(legacy).unwrap();
        let migrated = migrate_store(decoded).unwrap();
        assert_eq!(migrated.schema_version, 2);
        assert_eq!(migrated.publishers[0].key_sequence, 1);
        assert!(migrated.publishers[0].retired_fingerprints.is_empty());
    }

    #[test]
    fn update_candidate_binds_registry_package_and_permission_delta() {
        let current = verified_update_package(1, &["resources:read"], &sha256(b"current"));
        let next = verified_update_package(2, &["tools:invoke"], &sha256(b"next"));
        let registry = crate::extension_registry::RegistryUpdateEntry {
            sequence: 7,
            expires_at: 500,
            entry: crate::extension_registry::RegistryEntry {
                id: "acme.search".into(),
                label: "Acme Search".into(),
                summary: "Search local resources.".into(),
                version: 2,
                publisher: "acme.tools".into(),
                publisher_fingerprint: sha256(b"publisher-key"),
                permissions: vec!["tools:invoke".into()],
                digest: sha256(b"next"),
                package_url: "https://downloads.example.test/acme.ideall-extension".into(),
                package_sha256: "a".repeat(64),
                published_at: 100,
            },
        };
        let token = uuid::Uuid::new_v4().to_string();
        let candidate = update_candidate_for(&token, &registry, &current, &next).unwrap();
        assert_eq!(candidate.current_version, 1);
        assert_eq!(candidate.next_version, 2);
        assert_eq!(candidate.added_permissions, vec!["tools:invoke"]);
        assert_eq!(candidate.removed_permissions, vec!["resources:read"]);

        let mut mismatched = registry;
        mismatched.entry.digest = sha256(b"other");
        assert_eq!(
            update_candidate_for(&token, &mismatched, &current, &next).unwrap_err(),
            "extension-update-registry-mismatch"
        );
    }

    #[test]
    fn verification_and_spawn_identifiers_are_strictly_bounded() {
        assert!(valid_content_digest(&format!("sha256:{}", "A".repeat(43))));
        assert!(!valid_content_digest("sha256:short"));
        assert!(valid_session_id("runtime-extension-abc_123"));
        assert!(!valid_session_id("../session"));
        assert!(!valid_session_id(&"x".repeat(161)));
    }

    #[cfg(unix)]
    #[test]
    fn package_parser_rejects_symlinked_connector() {
        use std::os::unix::fs::symlink;
        let (root, _) = temp_package("symlink.connector", &["resources:read"]);
        let package = root.join("symlink.connector");
        let connector = package.join("connector");
        fs::remove_file(&connector).unwrap();
        symlink("manifest.json", &connector).unwrap();
        assert_eq!(
            inspect_package_with(&package, "symlink.connector", accept_fixture).unwrap_err(),
            "invalid-connector-file"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discovery_reports_rejected_packages_without_exposing_paths() {
        let root = std::env::temp_dir().join(format!("ideall-extension-{}", uuid::Uuid::new_v4()));
        let package = root.join("unsigned.connector");
        fs::create_dir_all(&package).unwrap();
        File::create(package.join(MANIFEST_FILE))
            .unwrap()
            .write_all(b"{}")
            .unwrap();
        fs::write(package.join(SIGNATURE_FILE), b"invalid").unwrap();
        let report = discover_at(&root, None, &PublisherTrustStore::default()).unwrap();
        assert!(report.packages.is_empty());
        assert_eq!(report.rejected.len(), 1);
        assert_eq!(report.rejected[0].directory, "unsigned.connector");
        assert_eq!(report.rejected[0].code, "invalid-manifest");
        fs::remove_dir_all(root).unwrap();
    }
}
