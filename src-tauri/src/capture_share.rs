use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use std::{
    borrow::Borrow,
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State, Url};

const PENDING_EVENT: &str = "capture-share://pending";
const MAX_PENDING_ITEMS: usize = 16;
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PENDING_BYTES: usize = 64 * 1024 * 1024;
const MAX_URL_BYTES: usize = 8 * 1024;
const MAX_TITLE_CHARS: usize = 512;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CaptureSharePayload {
    Url {
        url: String,
        title: Option<String>,
    },
    File {
        name: String,
        mime: String,
        base64: String,
    },
    Error {
        name: String,
        message: String,
    },
}

#[derive(Default)]
struct PendingCaptureShares {
    items: VecDeque<CaptureSharePayload>,
    encoded_bytes: usize,
}

#[derive(Default)]
pub struct CaptureShareState(Mutex<PendingCaptureShares>);

fn payload_bytes(payload: &CaptureSharePayload) -> usize {
    match payload {
        CaptureSharePayload::File { base64, .. } => base64.len(),
        _ => 0,
    }
}

fn push_payload(app: &AppHandle, payload: CaptureSharePayload) {
    let size = payload_bytes(&payload);
    let state = app.state::<CaptureShareState>();
    let mut pending = match state.0.lock() {
        Ok(value) => value,
        Err(_) => return,
    };
    if pending.items.len() >= MAX_PENDING_ITEMS
        || pending.encoded_bytes.saturating_add(size) > MAX_PENDING_BYTES
    {
        return;
    }
    pending.encoded_bytes += size;
    pending.items.push_back(payload);
    drop(pending);
    let _ = app.emit(PENDING_EVENT, ());
}

fn clean_title(value: &str) -> Option<String> {
    let title = value
        .trim()
        .chars()
        .take(MAX_TITLE_CHARS)
        .collect::<String>();
    (!title.is_empty()).then_some(title)
}

fn capture_url(url: &Url) -> Option<(String, Option<String>)> {
    if url.scheme() != "ideall" {
        return None;
    }
    let route_matches =
        url.host_str() == Some("capture") || url.path().trim_matches('/') == "capture";
    if !route_matches {
        return None;
    }
    let mut target = None;
    let mut title = None;
    for (key, value) in url.query_pairs() {
        if key == "url" && target.is_none() {
            target = Some(value.into_owned());
        } else if key == "title" && title.is_none() {
            title = clean_title(&value);
        }
    }
    let raw = target?.trim().to_string();
    if raw.is_empty() || raw.len() > MAX_URL_BYTES {
        return None;
    }
    let mut parsed = Url::parse(&raw).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return None;
    }
    let _ = parsed.set_username("");
    let _ = parsed.set_password(None);
    Some((parsed.to_string(), title))
}

pub fn enqueue_deep_links<I, U>(app: &AppHandle, urls: I)
where
    I: IntoIterator<Item = U>,
    U: Borrow<Url>,
{
    for value in urls {
        let url = value.borrow();
        if let Some((url, title)) = capture_url(url) {
            push_payload(app, CaptureSharePayload::Url { url, title });
        }
    }
}

fn supported_mime(path: &Path) -> Option<&'static str> {
    match path
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => Some("text/html"),
        "pdf" => Some("application/pdf"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "gif" => Some("image/gif"),
        "heic" => Some("image/heic"),
        "heif" => Some("image/heif"),
        "ico" => Some("image/x-icon"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "svg" => Some("image/svg+xml"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().chars().take(255).collect())
        .filter(|value: &String| !value.is_empty())
        .unwrap_or_else(|| "shared-file".to_string())
}

fn enqueue_file_path(app: &AppHandle, path: &Path, report_unsupported: bool) {
    let name = display_name(path);
    let Some(mime) = supported_mime(path) else {
        if report_unsupported {
            push_payload(
                app,
                CaptureSharePayload::Error {
                    name,
                    message: "仅支持 HTML、PDF 和图片".to_string(),
                },
            );
        }
        return;
    };
    let metadata = match std::fs::metadata(path) {
        Ok(value) if value.is_file() => value,
        Ok(_) => return,
        Err(error) => {
            push_payload(
                app,
                CaptureSharePayload::Error {
                    name,
                    message: format!("无法读取文件：{error}"),
                },
            );
            return;
        }
    };
    if metadata.len() > MAX_FILE_BYTES {
        push_payload(
            app,
            CaptureSharePayload::Error {
                name,
                message: "文件超过 32 MiB 投递上限".to_string(),
            },
        );
        return;
    }
    match std::fs::read(path) {
        Ok(bytes) => push_payload(
            app,
            CaptureSharePayload::File {
                name,
                mime: mime.to_string(),
                base64: BASE64.encode(bytes),
            },
        ),
        Err(error) => push_payload(
            app,
            CaptureSharePayload::Error {
                name,
                message: format!("无法读取文件：{error}"),
            },
        ),
    }
}

pub fn enqueue_file_paths(app: AppHandle, paths: Vec<PathBuf>, report_unsupported: bool) {
    std::thread::spawn(move || {
        for path in paths {
            enqueue_file_path(&app, &path, report_unsupported);
        }
    });
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
pub fn enqueue_opened_files(app: AppHandle, urls: &[Url]) {
    let paths = urls
        .iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .collect::<Vec<_>>();
    enqueue_file_paths(app, paths, true);
}

#[cfg(desktop)]
pub fn enqueue_args(app: AppHandle, args: &[String], cwd: &Path) {
    let paths = args
        .iter()
        .filter(|arg| !arg.starts_with('-') && !arg.starts_with("ideall:"))
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        })
        .filter(|path| supported_mime(path).is_some())
        .collect::<Vec<_>>();
    enqueue_file_paths(app, paths, false);
}

#[tauri::command]
pub fn capture_take_pending(state: State<'_, CaptureShareState>) -> Vec<CaptureSharePayload> {
    let mut pending = match state.0.lock() {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    pending.encoded_bytes = 0;
    pending.items.drain(..).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_link_accepts_only_capture_route_with_http_url() {
        let valid = Url::parse(
            "ideall://capture?url=https%3A%2F%2Fexample.com%2Farticle%23part&title=Research",
        )
        .unwrap();
        let parsed = capture_url(&valid).unwrap();
        assert_eq!(parsed.0, "https://example.com/article#part");
        assert_eq!(parsed.1.as_deref(), Some("Research"));

        assert!(
            capture_url(&Url::parse("ideall://settings?url=https://example.com").unwrap())
                .is_none()
        );
        assert!(
            capture_url(&Url::parse("ideall://capture?url=javascript%3Aalert(1)").unwrap())
                .is_none()
        );
    }

    #[test]
    fn shared_file_types_are_explicitly_bounded() {
        assert_eq!(
            supported_mime(Path::new("paper.PDF")),
            Some("application/pdf")
        );
        assert_eq!(supported_mime(Path::new("photo.webp")), Some("image/webp"));
        assert_eq!(supported_mime(Path::new("archive.zip")), None);
    }
}
