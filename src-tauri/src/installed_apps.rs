// 本机已安装应用 (Linux .desktop / macOS .app / Windows 开始菜单快捷方式)。
// 供本地模式「应用」模块列举与启动; 解析与 exec 均在 Rust 侧完成, 前端只收展示字段 + id。

#[cfg(target_os = "linux")]
use std::collections::HashMap;
use std::path::{Path, PathBuf};
#[cfg(not(target_os = "linux"))]
use std::process::Command;
#[cfg(target_os = "linux")]
use std::process::{Command, Stdio};

use base64::{engine::general_purpose::STANDARD, Engine as _};

const MAX_ICON_BYTES: usize = 512 * 1024;
const MAX_APP_ID_BYTES: usize = 255;

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn user_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[cfg(target_os = "windows")]
fn user_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub id: String,
    pub name: String,
    pub comment: Option<String>,
    pub categories: Vec<String>,
    /// 已解析的图标文件绝对路径 (供 read_app_icon_data_url 读取); 无则前端用占位符。
    pub icon_path: Option<String>,
}

/// App id 是各平台受信任目录中的单个文件名/Bundle 名，不是路径。
/// 前端只能把枚举返回的 opaque id 送回来；Rust 仍会在每次敏感操作前重新枚举确认。
fn validate_app_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > MAX_APP_ID_BYTES
        || id != id.trim()
        || id == "."
        || id == ".."
        || id.contains(['/', '\\', '\0'])
        || id.chars().any(char::is_control)
    {
        return Err("无效的应用 id".into());
    }
    Ok(())
}

fn require_installed_app(id: &str) -> Result<InstalledApp, String> {
    validate_app_id(id)?;
    list_installed_apps()?
        .into_iter()
        .find(|app| app.id == id)
        .ok_or_else(|| format!("未找到应用: {id}"))
}

fn canonical_descendant(root: &Path, candidate: &Path) -> Option<PathBuf> {
    let root = root.canonicalize().ok()?;
    let candidate = candidate.canonicalize().ok()?;
    (candidate.starts_with(&root) && candidate != root).then_some(candidate)
}

#[tauri::command]
pub fn list_installed_apps() -> Result<Vec<InstalledApp>, String> {
    #[cfg(target_os = "linux")]
    return list_linux_apps();
    #[cfg(target_os = "macos")]
    return list_macos_apps();
    #[cfg(target_os = "windows")]
    return list_windows_apps();
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Ok(vec![])
    }
}

#[tauri::command]
pub fn launch_installed_app(id: String) -> Result<(), String> {
    // 不直接把前端 id 拼进路径或交给系统 launcher；先以受信任枚举重解析为 canonical id。
    let app = require_installed_app(&id)?;
    #[cfg(target_os = "linux")]
    return launch_linux_app(&app.id);
    #[cfg(target_os = "macos")]
    return launch_macos_app(&app.id);
    #[cfg(target_os = "windows")]
    return launch_windows_app(&app.id);
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        Err("当前平台不支持启动应用".into())
    }
}

/// 按 opaque app id 重新枚举应用，再读取 Rust 侧解析出的 canonical 图标。
/// 命令刻意不接受 path，避免主 WebView 把它变成任意本机文件读取面。
#[tauri::command]
pub fn read_app_icon_data_url(id: String) -> Result<Option<String>, String> {
    let app = require_installed_app(&id)?;
    let Some(path) = app.icon_path else {
        return Ok(None);
    };
    read_icon_data_url_from_path(Path::new(&path))
}

fn read_icon_data_url_from_path(path: &Path) -> Result<Option<String>, String> {
    let Some((canonical, format)) = canonical_allowed_icon(path) else {
        return Ok(None);
    };
    let meta = std::fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if meta.len() as usize > MAX_ICON_BYTES {
        return Ok(None);
    }
    let bytes = std::fs::read(&canonical).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_ICON_BYTES {
        return Ok(None);
    }
    Ok(icon_data_url(format, &bytes))
}

fn icon_data_url(format: IconFormat, bytes: &[u8]) -> Option<String> {
    format
        .matches(bytes)
        .then(|| format!("data:{};base64,{}", format.mime(), STANDARD.encode(bytes)))
}

fn canonical_allowed_icon(path: &Path) -> Option<(PathBuf, IconFormat)> {
    let canonical = path.canonicalize().ok()?;
    if !canonical.is_file() || !is_allowed_icon_candidate(&canonical) {
        return None;
    }
    let format = IconFormat::from_path(&canonical)?;
    Some((canonical, format))
}

fn is_allowed_icon_path(path: &Path) -> bool {
    canonical_allowed_icon(path).is_some()
}

fn is_allowed_icon_candidate(canonical: &Path) -> bool {
    if IconFormat::from_path(canonical).is_none() {
        return false;
    }
    let s = canonical.to_string_lossy();
    #[cfg(target_os = "linux")]
    if is_allowed_linux_icon_location(&s) {
        return true;
    }
    #[cfg(target_os = "macos")]
    if is_allowed_macos_icon_location(canonical, &s) {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        if (s.ends_with(".ico") || s.ends_with(".png"))
            && (s.contains("\\Program Files\\") || s.contains("\\Program Files (x86)\\"))
        {
            return true;
        }
        if let Some(home) = user_home() {
            if s.starts_with(home.to_string_lossy().as_ref()) {
                return true;
            }
        }
    }
    false
}

#[cfg(target_os = "linux")]
fn is_allowed_linux_icon_location(canonical: &str) -> bool {
    const EXACT_ICON_PREFIXES: &[&str] = &[
        "/usr/share/icons/",
        "/usr/share/pixmaps/",
        "/usr/local/share/icons/",
        "/usr/local/share/pixmaps/",
        "/var/lib/flatpak/exports/share/icons/",
        "/var/lib/snapd/desktop/icons/",
    ];
    if EXACT_ICON_PREFIXES
        .iter()
        .any(|prefix| canonical.starts_with(prefix))
    {
        return true;
    }
    if let Some(home) = user_home().and_then(|home| home.canonicalize().ok()) {
        for relative in [".local/share/icons", ".local/share/pixmaps", ".icons"] {
            if Path::new(canonical).starts_with(home.join(relative)) {
                return true;
            }
        }
    }
    // 发行版/容器应用的图标必须位于明确的 icon export/meta 目录；不再放行整个 /opt、/snap。
    if canonical.starts_with("/var/lib/flatpak/") && canonical.contains("/export/share/icons/") {
        return true;
    }
    if canonical.starts_with("/snap/") && canonical.contains("/meta/gui/") {
        return true;
    }
    canonical.starts_with("/opt/")
        && (canonical.contains("/icons/")
            || canonical.contains("/pixmaps/")
            || canonical.contains("/share/icons/"))
}

#[cfg(target_os = "macos")]
fn is_allowed_macos_icon_location(path: &Path, canonical: &str) -> bool {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];
    if let Some(home) = user_home() {
        roots.push(home.join("Applications"));
    }
    roots.into_iter().any(|root| path.starts_with(root))
        && canonical.contains(".app/Contents/Resources/")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IconFormat {
    Png,
    Svg,
    Xpm,
    Jpeg,
    Gif,
    Webp,
    Ico,
    Icns,
}

impl IconFormat {
    fn from_path(path: &Path) -> Option<Self> {
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "png" => Some(Self::Png),
            "svg" => Some(Self::Svg),
            "xpm" => Some(Self::Xpm),
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "gif" => Some(Self::Gif),
            "webp" => Some(Self::Webp),
            "ico" => Some(Self::Ico),
            "icns" => Some(Self::Icns),
            _ => None,
        }
    }

    fn mime(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Svg => "image/svg+xml",
            Self::Xpm => "image/x-xpixmap",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
            Self::Ico => "image/x-icon",
            Self::Icns => "image/icns",
        }
    }

    fn matches(self, bytes: &[u8]) -> bool {
        match self {
            Self::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            Self::Svg => is_safe_svg(bytes),
            Self::Xpm => trim_ascii_start(bytes).starts_with(b"/* XPM */"),
            Self::Jpeg => bytes.starts_with(&[0xff, 0xd8, 0xff]),
            Self::Gif => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
            Self::Webp => {
                bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP"
            }
            Self::Ico => bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]),
            Self::Icns => bytes.starts_with(b"icns"),
        }
    }
}

fn trim_ascii_start(mut value: &[u8]) -> &[u8] {
    while value.first().is_some_and(u8::is_ascii_whitespace) {
        value = &value[1..];
    }
    value
}

fn has_xml_event_attribute(lower: &[u8]) -> bool {
    for index in 0..lower.len().saturating_sub(3) {
        if !lower[index].is_ascii_whitespace()
            || lower[index + 1] != b'o'
            || lower[index + 2] != b'n'
            || !lower[index + 3].is_ascii_alphabetic()
        {
            continue;
        }
        let mut cursor = index + 3;
        while cursor < lower.len()
            && (lower[cursor].is_ascii_alphanumeric()
                || matches!(lower[cursor], b'-' | b'_' | b':'))
        {
            cursor += 1;
        }
        while cursor < lower.len() && lower[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if lower.get(cursor) == Some(&b'=') {
            return true;
        }
    }
    false
}

/// SVG 会原样进入 WebView；只接受无脚本、事件、外链、CSS 和嵌套资源的静态子集。
fn is_safe_svg(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let text = text.trim_start_matches('\u{feff}').trim_start();
    if !(text.starts_with("<svg") || (text.starts_with("<?xml") && text.contains("<svg"))) {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    let denied = [
        "<!doctype",
        "<!entity",
        "<script",
        "<foreignobject",
        "<iframe",
        "<object",
        "<embed",
        "<image",
        "<use",
        "<style",
        "<animate",
        "<set",
        "href",
        "javascript:",
        "vbscript:",
        "@import",
        "url(",
        "style=",
    ];
    !denied.iter().any(|value| lower.contains(value)) && !has_xml_event_attribute(lower.as_bytes())
}

// ── Linux (.desktop) ─────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn list_linux_apps() -> Result<Vec<InstalledApp>, String> {
    let mut by_id: HashMap<String, InstalledApp> = HashMap::new();
    // 自低至高优先级遍历, 同 id 时后写入覆盖 (用户本地 > snap/flatpak > 系统)。
    for dir in linux_desktop_dirs() {
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue;
        };
        for ent in read.flatten() {
            let Some(path) = canonical_descendant(&dir, &ent.path()) else {
                continue;
            };
            if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
                continue;
            }
            let Some(parsed) = parse_desktop_file(&path) else {
                continue;
            };
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if validate_app_id(&id).is_err() {
                continue;
            }
            let icon_path = parsed
                .icon
                .as_deref()
                .and_then(|icon| resolve_linux_icon(icon, Some(&path)))
                .filter(|p| is_allowed_icon_path(p))
                .map(|p| p.to_string_lossy().into_owned());
            by_id.insert(
                id.clone(),
                InstalledApp {
                    id,
                    name: parsed.name,
                    comment: parsed.comment,
                    categories: parsed.categories,
                    icon_path,
                },
            );
        }
    }
    let mut apps: Vec<_> = by_id.into_values().collect();
    apps.sort_by_key(|a| a.name.to_lowercase());
    Ok(apps)
}

#[cfg(target_os = "linux")]
fn linux_desktop_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
        PathBuf::from("/var/lib/snapd/desktop/applications"),
        PathBuf::from("/var/lib/flatpak/exports/share/applications"),
    ];
    if let Some(home) = user_home() {
        dirs.push(home.join(".local/share/applications"));
    }
    dirs
}

#[cfg(target_os = "linux")]
struct DesktopParsed {
    name: String,
    comment: Option<String>,
    categories: Vec<String>,
    icon: Option<String>,
    exec: Option<String>,
}

#[cfg(target_os = "linux")]
fn parse_desktop_file(path: &Path) -> Option<DesktopParsed> {
    let raw = std::fs::read_to_string(path).ok()?;
    let mut in_entry = false;
    let mut type_ = String::new();
    let mut no_display = false;
    let mut hidden = false;
    let mut name: Option<String> = None;
    let mut name_zh: Option<String> = None;
    let mut generic_name: Option<String> = None;
    let mut comment: Option<String> = None;
    let mut icon: Option<String> = None;
    let mut categories = String::new();
    let mut exec: Option<String> = None;

    for line in raw.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry || line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, val)) = line.split_once('=') else {
            continue;
        };
        let val = unescape_desktop_value(val.trim());
        match key {
            "Type" => type_ = val,
            "NoDisplay" => no_display = parse_desktop_bool(&val),
            "Hidden" => hidden = parse_desktop_bool(&val),
            "Name" => name = Some(val),
            "Name[zh_CN]" | "Name[zh]" => name_zh = Some(val),
            "GenericName" => generic_name = Some(val),
            "Comment" => comment = Some(val),
            "Icon" => icon = Some(val),
            "Categories" => categories = val,
            "Exec" => exec = Some(val),
            _ => {}
        }
    }

    if no_display || hidden {
        return None;
    }
    if !type_.is_empty() && type_ != "Application" {
        return None;
    }
    let display_name = name_zh.or(name).or(generic_name)?;
    // map_or 而非 is_none_or: 后者 1.82 才稳定, 超出 Cargo.toml 声明的 MSRV 1.77.2。
    if exec.as_ref().map_or(true, |e| e.trim().is_empty()) {
        return None;
    }
    let cats: Vec<String> = categories
        .split(';')
        .filter(|s| !s.is_empty())
        .map(category_label)
        .collect();

    Some(DesktopParsed {
        name: display_name,
        comment,
        categories: cats,
        icon,
        exec,
    })
}

#[cfg(target_os = "linux")]
fn resolve_linux_desktop(id: &str, dirs: &[PathBuf]) -> Option<(PathBuf, DesktopParsed)> {
    validate_app_id(id).ok()?;
    for dir in dirs.iter().rev() {
        let Some(path) = canonical_descendant(dir, &dir.join(format!("{id}.desktop"))) else {
            continue;
        };
        if let Some(parsed) = parse_desktop_file(&path) {
            return Some((path, parsed));
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn parse_desktop_bool(s: &str) -> bool {
    matches!(s.to_lowercase().as_str(), "true" | "1" | "yes")
}

#[cfg(target_os = "linux")]
fn unescape_desktop_value(s: &str) -> String {
    s.replace("\\s", " ")
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\r", "\r")
        .replace("\\\\", "\\")
}

// 输出标签集是 app 分类的真相源; 前端 src/modules/apps/apps-page.tsx 的
// STANDARD_CATEGORY_ORDER 必须与此处同步, 否则未识别标签会落入「其他」分组。
#[cfg(target_os = "linux")]
fn category_label(key: &str) -> String {
    match key {
        "AudioVideo" => "影音",
        "Audio" => "音频",
        "Video" => "视频",
        "Development" => "开发",
        "Education" => "教育",
        "Game" => "游戏",
        "Graphics" => "图形",
        "Network" => "网络",
        "Office" => "办公",
        "Science" => "科学",
        "Settings" => "设置",
        "System" => "系统",
        "Utility" => "工具",
        "TextEditor" => "文本",
        "WebBrowser" => "浏览器",
        _ => key,
    }
    .to_string()
}

#[cfg(target_os = "linux")]
fn resolve_linux_icon(icon: &str, desktop_path: Option<&Path>) -> Option<PathBuf> {
    let icon = icon.trim();
    if icon.is_empty() {
        return None;
    }

    let p = Path::new(icon);
    if p.is_absolute() && p.exists() {
        return Some(p.to_path_buf());
    }

    // Icon 相对 .desktop 文件所在目录。
    if let Some(desktop) = desktop_path {
        if let Some(parent) = desktop.parent() {
            let rel = parent.join(icon);
            if rel.exists() {
                return Some(rel);
            }
            for ext in [".png", ".svg", ".xpm"] {
                let with_ext = parent.join(format!("{icon}{ext}"));
                if with_ext.exists() {
                    return Some(with_ext);
                }
            }
        }
    }

    let exts = [".png", ".svg", ".xpm", ""];
    for ext in exts {
        let file = if ext.is_empty() {
            icon.to_string()
        } else {
            format!("{icon}{ext}")
        };
        let pixmap = PathBuf::from(format!("/usr/share/pixmaps/{file}"));
        if pixmap.exists() {
            return Some(pixmap);
        }
    }

    let preferred_sizes = [64, 48, 128, 32, 256, 24, 22, 16];
    for size in preferred_sizes {
        for ext in [".png", ".svg"] {
            let candidate = PathBuf::from(format!(
                "/usr/share/icons/hicolor/{size}x{size}/apps/{icon}{ext}"
            ));
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    let scalable = PathBuf::from(format!("/usr/share/icons/hicolor/scalable/apps/{icon}.svg"));
    if scalable.exists() {
        return Some(scalable);
    }

    // 扫描 /usr/share/icons 下所有主题 (含 Flat-Remix 等第三方主题)。
    if let Ok(themes) = std::fs::read_dir("/usr/share/icons") {
        for theme in themes.flatten() {
            let theme_path = theme.path();
            if !theme_path.is_dir() {
                continue;
            }
            let scalable = theme_path.join(format!("scalable/apps/{icon}.svg"));
            if scalable.exists() {
                return Some(scalable);
            }
            for size in preferred_sizes {
                for ext in [".png", ".svg"] {
                    let candidate = theme_path.join(format!("{size}x{size}/apps/{icon}{ext}"));
                    if candidate.exists() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    None
}

#[cfg(target_os = "linux")]
fn launch_linux_app(id: &str) -> Result<(), String> {
    validate_app_id(id)?;
    // 先从固定 applications 根重解析；即使该 helper 被命令以外的内部调用，也不能跳过枚举边界。
    let dirs = linux_desktop_dirs();
    let Some((_desktop_path, parsed)) = resolve_linux_desktop(id, &dirs) else {
        return Err(format!("未找到应用: {id}"));
    };
    // gtk-launch 按 .desktop id 启动, 正确处理 Exec 字段码。
    if Command::new("gtk-launch")
        .arg("--")
        .arg(id)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
    {
        return Ok(());
    }
    // 回退只使用上面从受信任 applications 根取得的 Exec，不再按前端 id 二次拼接路径。
    let exec = parsed.exec.ok_or_else(|| "应用 Exec 为空".to_string())?;
    let cmd = strip_exec_field_codes(&exec);
    if cmd.trim().is_empty() {
        return Err("应用 Exec 为空".into());
    }
    Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn strip_exec_field_codes(exec: &str) -> String {
    exec.split_whitespace()
        .filter(|t| !t.starts_with('%'))
        .collect::<Vec<_>>()
        .join(" ")
}

// ── macOS (/Applications) ────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn list_macos_apps() -> Result<Vec<InstalledApp>, String> {
    let mut apps = Vec::new();
    for dir in ["/Applications", "/System/Applications"] {
        scan_macos_apps_dir(Path::new(dir), &mut apps);
    }
    if let Some(home) = user_home() {
        scan_macos_apps_dir(&home.join("Applications"), &mut apps);
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

#[cfg(target_os = "macos")]
fn scan_macos_apps_dir(dir: &Path, out: &mut Vec<InstalledApp>) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for ent in read.flatten() {
        let Some(path) = canonical_descendant(dir, &ent.path()) else {
            continue;
        };
        if path.extension().and_then(|e| e.to_str()) != Some("app") {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if validate_app_id(&id).is_err() {
            continue;
        }
        let plist = path.join("Contents/Info.plist");
        let name = read_macos_display_name(&plist).unwrap_or_else(|| id.clone());
        let icon_path = path.join("Contents/Resources/AppIcon.icns");
        out.push(InstalledApp {
            id,
            name,
            comment: None,
            categories: vec!["应用".into()],
            icon_path: icon_path
                .exists()
                .then(|| icon_path.to_string_lossy().into_owned()),
        });
    }
}

#[cfg(target_os = "macos")]
fn read_macos_display_name(plist: &Path) -> Option<String> {
    let out = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleDisplayName", plist.to_str()?])
        .output()
        .ok()?;
    if out.status.success() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() {
            return Some(s);
        }
    }
    let out = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleName", plist.to_str()?])
        .output()
        .ok()?;
    if out.status.success() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() {
            return Some(s);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn launch_macos_app(id: &str) -> Result<(), String> {
    validate_app_id(id)?;
    for dir in ["/Applications", "/System/Applications"] {
        let root = PathBuf::from(dir);
        if let Some(path) = canonical_descendant(&root, &root.join(format!("{id}.app"))) {
            Command::new("open")
                .arg("-a")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("启动失败: {e}"))?;
            return Ok(());
        }
    }
    if let Some(home) = user_home() {
        let root = home.join("Applications");
        if let Some(path) = canonical_descendant(&root, &root.join(format!("{id}.app"))) {
            Command::new("open")
                .arg("-a")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("启动失败: {e}"))?;
            return Ok(());
        }
    }
    Err(format!("未找到应用: {id}"))
}

// ── Windows (开始菜单 .lnk) ──────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn list_windows_apps() -> Result<Vec<InstalledApp>, String> {
    let mut apps = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let dirs = windows_start_menu_dirs();
    for dir in dirs {
        scan_windows_dir(&dir, &mut apps, &mut seen);
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

#[cfg(target_os = "windows")]
fn windows_start_menu_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(progdata) = std::env::var_os("ProgramData") {
        dirs.push(
            PathBuf::from(progdata)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(
            PathBuf::from(appdata)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    dirs
}

#[cfg(target_os = "windows")]
fn scan_windows_dir(
    dir: &Path,
    out: &mut Vec<InstalledApp>,
    seen: &mut std::collections::HashSet<String>,
) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for ent in read.flatten() {
        let path = ent.path();
        let Ok(file_type) = ent.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            scan_windows_dir(&path, out, seen);
            continue;
        }
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if ext.eq_ignore_ascii_case("lnk") {
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if validate_app_id(&stem).is_err() || !seen.insert(stem.clone()) {
                continue;
            }
            out.push(InstalledApp {
                id: stem.clone(),
                name: stem,
                comment: path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
                    .map(String::from),
                categories: vec!["应用".into()],
                icon_path: None,
            });
        }
    }
}

#[cfg(target_os = "windows")]
fn launch_windows_app(id: &str) -> Result<(), String> {
    validate_app_id(id)?;
    for dir in windows_start_menu_dirs() {
        if let Some(path) = find_windows_shortcut(&dir, id) {
            Command::new("cmd")
                .args(["/C", "start", "", &path.to_string_lossy()])
                .spawn()
                .map_err(|e| format!("启动失败: {e}"))?;
            return Ok(());
        }
    }
    Err(format!("未找到应用: {id}"))
}

#[cfg(target_os = "windows")]
fn find_windows_shortcut(dir: &Path, id: &str) -> Option<PathBuf> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return None;
    };
    for ent in read.flatten() {
        let path = ent.path();
        let Ok(file_type) = ent.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if let Some(found) = find_windows_shortcut(&path, id) {
                return Some(found);
            }
            continue;
        }
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("lnk"))
            && path
                .file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.eq_ignore_ascii_case(id))
        {
            return Some(path);
        }
    }
    None
}

#[cfg(test)]
mod security_tests {
    use super::*;

    #[test]
    fn app_ids_are_opaque_single_components() {
        for valid in [
            "org.example.Editor",
            "Visual Studio Code",
            "微信",
            "app_name-2",
        ] {
            assert!(validate_app_id(valid).is_ok(), "valid id rejected: {valid}");
        }
        for invalid in [
            "",
            ".",
            "..",
            "../evil",
            "a/b",
            "a\\b",
            "/tmp/evil",
            " Coder",
            "Coder ",
            "bad\0id",
            "bad\nid",
        ] {
            assert!(
                validate_app_id(invalid).is_err(),
                "unsafe id accepted: {invalid:?}"
            );
        }
        assert!(validate_app_id(&"a".repeat(MAX_APP_ID_BYTES + 1)).is_err());
        assert!(read_app_icon_data_url("../evil".into()).is_err());
        assert!(launch_installed_app("/tmp/evil".into()).is_err());
    }

    #[test]
    fn icon_extension_and_magic_must_agree() {
        assert!(IconFormat::Png.matches(b"\x89PNG\r\n\x1a\nrest"));
        assert!(!IconFormat::Png.matches(b"not really a png"));
        assert!(IconFormat::Jpeg.matches(&[0xff, 0xd8, 0xff, 0xe0]));
        assert!(!IconFormat::Jpeg.matches(b"GIF89a"));
        assert!(IconFormat::Webp.matches(b"RIFF\x00\x00\x00\x00WEBP"));
        assert!(!IconFormat::Webp.matches(b"RIFF\x00\x00\x00\x00FAKE"));
        assert!(icon_data_url(IconFormat::Png, b"\x89PNG\r\n\x1a\nrest")
            .is_some_and(|url| url.starts_with("data:image/png;base64,")));
        assert!(icon_data_url(IconFormat::Png, b"fake png").is_none());
    }

    #[test]
    fn svg_accepts_static_markup_and_rejects_active_or_external_content() {
        assert!(is_safe_svg(
            br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>"#
        ));
        for unsafe_svg in [
            br#"<svg onload="alert(1)"></svg>"#.as_slice(),
            br#"<svg><script>alert(1)</script></svg>"#.as_slice(),
            br#"<svg><image href="file:///etc/passwd"/></svg>"#.as_slice(),
            br#"<svg><style>@import url(https://example.test/x)</style></svg>"#.as_slice(),
            br#"<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>"#.as_slice(),
        ] {
            assert!(!is_safe_svg(unsafe_svg));
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_icon_locations_do_not_allow_arbitrary_opt_files() {
        assert!(!is_allowed_icon_candidate(Path::new(
            "/opt/vendor/private/secret.txt"
        )));
        assert!(!is_allowed_icon_candidate(Path::new(
            "/opt/vendor/private/secret.png"
        )));
        assert!(is_allowed_icon_candidate(Path::new(
            "/opt/vendor/icons/example.png"
        )));
        assert!(is_allowed_icon_candidate(Path::new(
            "/usr/share/icons/hicolor/48x48/apps/example.png"
        )));
    }
}

#[cfg(all(test, target_os = "linux"))]
mod linux_connector_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_app_dir() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "ideall-installed-apps-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn trusted_directory_resolves_valid_desktop_id_and_rejects_traversal() {
        let dir = temp_app_dir();
        std::fs::create_dir_all(&dir).expect("create temp applications dir");
        let desktop = dir.join("org.example.Editor.desktop");
        std::fs::write(
            &desktop,
            "[Desktop Entry]\nType=Application\nName=Example Editor\nExec=/usr/bin/true\n",
        )
        .expect("write desktop fixture");

        let resolved = resolve_linux_desktop("org.example.Editor", std::slice::from_ref(&dir))
            .expect("resolve valid desktop");
        assert_eq!(
            resolved.0,
            desktop.canonicalize().expect("canonical fixture")
        );
        assert_eq!(resolved.1.name, "Example Editor");
        assert!(resolve_linux_desktop("../org.example.Editor", &[dir.clone()]).is_none());
        assert!(resolve_linux_desktop("/tmp/evil", &[dir.clone()]).is_none());

        std::fs::remove_dir_all(dir).expect("remove temp applications dir");
    }

    #[test]
    fn installed_icon_command_re_resolves_an_opaque_id() {
        // 环境探测型：只在系统存在一个通过目录、扩展、magic/SVG 安全检查的真实图标时执行。
        let Some(app) = list_linux_apps()
            .expect("list apps")
            .into_iter()
            .find(|app| {
                app.icon_path.as_deref().is_some_and(|path| {
                    read_icon_data_url_from_path(Path::new(path))
                        .ok()
                        .flatten()
                        .is_some()
                })
            })
        else {
            eprintln!("skip: 本机无安全图标样例");
            return;
        };

        let url = read_app_icon_data_url(app.id)
            .expect("read")
            .expect("data url");
        assert!(url.starts_with("data:image/"));
    }
}
