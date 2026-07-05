const SERVICE: &str = "ideall";
const MAX_KEY_LEN: usize = 160;
const MAX_VALUE_LEN: usize = 512 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStoreStatus {
    pub backend: &'static str,
    pub native: bool,
}

fn validate_key(key: &str) -> Result<&str, String> {
    let k = key.trim();
    if k.is_empty() || k.len() > MAX_KEY_LEN {
        return Err("invalid-key".into());
    }
    if !k
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '.' | '_' | '-'))
    {
        return Err("invalid-key".into());
    }
    Ok(k)
}

fn validate_value(value: &str) -> Result<(), String> {
    if value.len() > MAX_VALUE_LEN {
        return Err("value-too-large".into());
    }
    Ok(())
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    let k = validate_key(key)?;
    keyring::Entry::new(SERVICE, k).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_store_status() -> SecureStoreStatus {
    SecureStoreStatus {
        backend: "system-keychain",
        native: true,
    }
}

#[tauri::command]
pub fn secure_store_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn secure_store_set(key: String, value: String) -> Result<(), String> {
    validate_value(&value)?;
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_store_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_key;

    #[test]
    fn key_validation_allows_namespaced_safe_keys() {
        assert_eq!(
            validate_key("ideall:agent.settings-api_key_1").unwrap(),
            "ideall:agent.settings-api_key_1"
        );
        assert!(validate_key("../secret").is_err());
        assert!(validate_key("").is_err());
    }
}
