// 本机已安装应用 (Linux .desktop / macOS .app / Windows 开始菜单快捷方式)。
// 供本地模式「应用」模块列举与启动; 解析与 exec 均在 Rust 侧完成, 前端只收展示字段 + id。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use base64::{engine::general_purpose::STANDARD, Engine as _};

const MAX_ICON_BYTES: usize = 512 * 1024;

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
    if id.trim().is_empty() {
        return Err("无效的应用 id".into());
    }
    #[cfg(target_os = "linux")]
    return launch_linux_app(&id);
    #[cfg(target_os = "macos")]
    return launch_macos_app(&id);
    #[cfg(target_os = "windows")]
    return launch_windows_app(&id);
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = id;
        Err("当前平台不支持启动应用".into())
    }
}

/// 读取已解析的图标文件并返回 data URL (绕过 webview asset 协议 scope 限制)。
#[tauri::command]
pub fn read_app_icon_data_url(path: String) -> Result<Option<String>, String> {
    let pb = PathBuf::from(&path);
    if !is_allowed_icon_path(&pb) {
        return Err("icon path not allowed".into());
    }
    if !pb.is_file() {
        return Ok(None);
    }
    let meta = std::fs::metadata(&pb).map_err(|e| e.to_string())?;
    if meta.len() as usize > MAX_ICON_BYTES {
        return Ok(None);
    }
    let bytes = std::fs::read(&pb).map_err(|e| e.to_string())?;
    let mime = mime_for_icon_path(&pb).unwrap_or("image/png");
    Ok(Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes))))
}

fn is_allowed_icon_path(path: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    let s = canonical.to_string_lossy();
    if s.starts_with("/usr/share/icons/")
        || s.starts_with("/usr/share/pixmaps/")
        || s.starts_with("/usr/local/share/icons/")
        || s.starts_with("/var/lib/flatpak/exports/share/icons/")
        || s.contains("/.local/share/icons/")
    {
        return true;
    }
    #[cfg(target_os = "macos")]
    if s.contains(".app/Contents/Resources/") {
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

fn mime_for_icon_path(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_lowercase().as_str() {
        "png" => Some("image/png"),
        "svg" => Some("image/svg+xml"),
        "xpm" => Some("image/x-xpixmap"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "ico" => Some("image/x-icon"),
        "icns" => Some("image/icns"),
        _ => None,
    }
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
            let path = ent.path();
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
            if id.is_empty() {
                continue;
            }
            let icon_path = parsed
                .icon
                .as_deref()
                .and_then(|icon| resolve_linux_icon(icon, Some(&path)))
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
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
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
    if exec.as_ref().is_none_or(|e| e.trim().is_empty()) {
        return None;
    }
    let cats: Vec<String> = categories
        .split(';')
        .filter(|s| !s.is_empty())
        .map(|s| category_label(s))
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
            let candidate =
                PathBuf::from(format!("/usr/share/icons/hicolor/{size}x{size}/apps/{icon}{ext}"));
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
    // gtk-launch 按 .desktop id 启动, 正确处理 Exec 字段码。
    if Command::new("gtk-launch")
        .arg(id)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
    {
        return Ok(());
    }
    // 回退: 找到 .desktop 并解析 Exec。
    for dir in linux_desktop_dirs() {
        let path = dir.join(format!("{id}.desktop"));
        if !path.exists() {
            continue;
        }
        let Some(parsed) = parse_desktop_file(&path) else {
            continue;
        };
        let Some(exec) = parsed.exec else {
            continue;
        };
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
        return Ok(());
    }
    Err(format!("未找到应用: {id}"))
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
        let path = ent.path();
        if path.extension().and_then(|e| e.to_str()) != Some("app") {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
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
            icon_path: icon_path.exists().then(|| icon_path.to_string_lossy().into_owned()),
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
    for dir in ["/Applications", "/System/Applications"] {
        let path = PathBuf::from(dir).join(format!("{id}.app"));
        if path.exists() {
            Command::new("open")
                .arg("-a")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("启动失败: {e}"))?;
            return Ok(());
        }
    }
    if let Some(home) = user_home() {
        let path = home.join("Applications").join(format!("{id}.app"));
        if path.exists() {
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
        if path.is_dir() {
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
            if stem.is_empty() || !seen.insert(stem.clone()) {
                continue;
            }
            out.push(InstalledApp {
                id: stem.clone(),
                name: stem,
                comment: path.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()).map(String::from),
                categories: vec!["应用".into()],
                icon_path: None,
            });
        }
    }
}

#[cfg(target_os = "windows")]
fn launch_windows_app(id: &str) -> Result<(), String> {
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
        if path.is_dir() {
            if let Some(found) = find_windows_shortcut(&path, id) {
                return Some(found);
            }
            continue;
        }
        if path
            .file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case(id))
        {
            return Some(path);
        }
    }
    None
}

#[cfg(all(test, target_os = "linux"))]
mod icon_tests {
    use super::*;

    #[test]
    fn resolves_kali_icon_and_reads_data_url() {
        let path = resolve_linux_icon("kali-ssldump", None).expect("icon path");
        assert!(path.exists());
        assert!(is_allowed_icon_path(&path));
        let url = read_app_icon_data_url(path.to_string_lossy().into_owned())
            .expect("read")
            .expect("data url");
        assert!(url.starts_with("data:image/"));
    }
}
