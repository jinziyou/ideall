// Linux 内嵌浏览器 CDP 后端 (阶段 2): 用 Chromium/Chrome + DevTools Protocol 替代 WebKitGTK。
// 检测到本机 Chrome/Chromium 且未设 IDEALL_BROWSER_CDP=0 时启用; 窗口用 --app= 定位到内容区矩形。
// Agent 工具走 CDP (find_element / evaluate / press_key), 兼容性与自动化能力强于 WebKit。

use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::Page;
use chromiumoxide::cdp::browser_protocol::browser::{
    Bounds as CdpWindowBounds, GetWindowForTargetParams, SetWindowBoundsParams, WindowId,
    WindowState,
};
use futures::StreamExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::browser_scripts::{self, CONTENT_JS, LIST_INTERACTIVE_JS};
use crate::{parse_list_interactive, BrowserBackendInfo, BrowserInteractiveResult, BrowserPageContent, Bounds};

pub struct BrowserCdpState {
    pub chrome_path: Option<PathBuf>,
    session: Mutex<Option<CdpSession>>,
    bounds: Mutex<Bounds>,
    visible: Mutex<bool>,
}

struct CdpSession {
    browser: Browser,
    page: Arc<Page>,
    _handler: tokio::task::JoinHandle<()>,
    _url_poller: tokio::task::JoinHandle<()>,
}

pub fn init_state() -> BrowserCdpState {
    BrowserCdpState {
        chrome_path: find_chrome(),
        session: Mutex::new(None),
        bounds: Mutex::new(Bounds::default()),
        visible: Mutex::new(true),
    }
}

impl BrowserCdpState {
    /// 是否应尝试 CDP (Linux + 找到 Chrome + 未显式禁用)。
    pub fn enabled(&self) -> bool {
        cfg!(target_os = "linux")
            && self.chrome_path.is_some()
            && std::env::var("IDEALL_BROWSER_CDP").ok().as_deref() != Some("0")
    }

    pub async fn is_running(&self) -> bool {
        self.session.lock().await.is_some()
    }

    pub async fn backend_info(&self) -> BrowserBackendInfo {
        let running = self.is_running().await;
        BrowserBackendInfo {
            mode: if self.enabled() {
                "cdp".into()
            } else {
                "webkit".into()
            },
            cdp_available: self.enabled(),
            running,
            chrome_path: self
                .chrome_path
                .as_ref()
                .map(|p| p.display().to_string()),
        }
    }
}

async fn window_id_of(browser: &Browser, page: &Page) -> Result<WindowId, String> {
    let resp = browser
        .execute(
            GetWindowForTargetParams::builder()
                .target_id(page.target_id().clone())
                .build(),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp.result.window_id)
}

async fn apply_window_bounds(
    browser: &Browser,
    page: &Page,
    b: Bounds,
    window_state: Option<WindowState>,
) -> Result<(), String> {
    let window_id = window_id_of(browser, page).await?;
    let mut builder = CdpWindowBounds::builder()
        .left(b.x.max(0.0) as i64)
        .top(b.y.max(0.0) as i64)
        .width(b.w.max(1.0) as i64)
        .height(b.h.max(1.0) as i64);
    if let Some(state) = window_state {
        builder = builder.window_state(state);
    }
    browser
        .execute(SetWindowBoundsParams::new(
            window_id,
            builder.build(),
        ))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn spawn_url_poller(app: AppHandle, page: Arc<Page>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut last = String::new();
        loop {
            if let Ok(Some(url)) = page.url().await {
                if url != last {
                    last = url.clone();
                    let _ = app.emit("browser://url", url);
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        }
    })
}

fn find_chrome() -> Option<PathBuf> {
    for name in [
        "google-chrome-stable",
        "google-chrome",
        "chromium-browser",
        "chromium",
        "microsoft-edge",
    ] {
        if let Ok(out) = std::process::Command::new("which").arg(name).output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() {
                    return Some(PathBuf::from(p));
                }
            }
        }
    }
    for p in [
        "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
        "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe",
        "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ] {
        if Path::new(p).exists() {
            return Some(PathBuf::from(p));
        }
    }
    None
}

fn profile_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("ideall")
        .join("browser-cdp")
}

async fn page_of(state: &BrowserCdpState) -> Result<Arc<Page>, String> {
    state
        .session
        .lock()
        .await
        .as_ref()
        .map(|s| s.page.clone())
        .ok_or_else(|| "CDP 浏览器未打开".to_string())
}

async fn emit_url(app: &AppHandle, page: &Page) {
    if let Ok(Some(url)) = page.url().await {
        let _ = app.emit("browser://url", url);
    }
}

async fn eval_json_page(page: &Page, js: &str) -> Result<serde_json::Value, String> {
    let v = page
        .evaluate(js)
        .await
        .map_err(|e| format!("cdp-eval: {e}"))?
        .into_value()
        .map_err(|e| format!("cdp-eval-value: {e}"))?;
    Ok(v)
}

async fn run_act_json(page: &Page, js: String) -> Result<(), String> {
    let v = eval_json_page(page, &js).await?;
    if v.get("ok").and_then(|x| x.as_bool()) == Some(true) {
        return Ok(());
    }
    Err(v
        .get("error")
        .and_then(|x| x.as_str())
        .unwrap_or("act-failed")
        .to_string())
}

pub async fn open(
    state: &BrowserCdpState,
    app: &AppHandle,
    url: String,
    b: Bounds,
) -> Result<(), String> {
    let chrome = state
        .chrome_path
        .as_ref()
        .ok_or_else(|| "未找到 Chrome/Chromium".to_string())?;
    *state.bounds.lock().await = b;
    *state.visible.lock().await = true;
    close(state).await.ok();

    std::fs::create_dir_all(profile_dir()).map_err(|e| e.to_string())?;

    let wx = b.x.max(0.0) as i32;
    let wy = b.y.max(0.0) as i32;
    let ww = b.w.max(1.0) as u32;
    let wh = b.h.max(1.0) as u32;

    let config = BrowserConfig::builder()
        .chrome_executable(chrome)
        .user_data_dir(profile_dir())
        .no_sandbox()
        .arg("--no-first-run")
        .arg("--disable-sync")
        .arg("--disable-features=TranslateUI")
        .arg(format!("--window-position={wx},{wy}"))
        .arg(format!("--window-size={ww},{wh}"))
        .arg(format!("--app={url}"))
        .with_head()
        .build()
        .map_err(|e| e.to_string())?;

    let (browser, mut handler) = Browser::launch(config)
        .await
        .map_err(|e| format!("启动 Chrome 失败: {e}"))?;

    let handler_task = tokio::spawn(async move {
        while handler.next().await.is_some() {}
    });

    let pages = browser.pages().await.map_err(|e| e.to_string())?;
    let page = if let Some(p) = pages.into_iter().next() {
        p
    } else {
        browser.new_page(&url).await.map_err(|e| e.to_string())?
    };

    emit_url(app, &page).await;

    let page_arc = Arc::new(page);
    let url_poller = spawn_url_poller(app.clone(), page_arc.clone());

    *state.session.lock().await = Some(CdpSession {
        browser,
        page: page_arc,
        _handler: handler_task,
        _url_poller: url_poller,
    });
    Ok(())
}

pub async fn set_bounds(state: &BrowserCdpState, b: Bounds) -> Result<(), String> {
    *state.bounds.lock().await = b;
    let guard = state.session.lock().await;
    if let Some(sess) = guard.as_ref() {
        apply_window_bounds(&sess.browser, &sess.page, b, Some(WindowState::Normal)).await?;
    }
    Ok(())
}

pub async fn navigate(state: &BrowserCdpState, app: &AppHandle, url: &str) -> Result<(), String> {
    let page = page_of(state).await?;
    page.goto(url).await.map_err(|e| e.to_string())?;
    emit_url(app, &page).await;
    Ok(())
}

pub async fn back(state: &BrowserCdpState, app: &AppHandle) -> Result<(), String> {
    let page = page_of(state).await?;
    page.evaluate("history.back()")
        .await
        .map_err(|e| e.to_string())?;
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    emit_url(app, &page).await;
    Ok(())
}

pub async fn forward(state: &BrowserCdpState, app: &AppHandle) -> Result<(), String> {
    let page = page_of(state).await?;
    page.evaluate("history.forward()")
        .await
        .map_err(|e| e.to_string())?;
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    emit_url(app, &page).await;
    Ok(())
}

pub async fn reload(state: &BrowserCdpState, app: &AppHandle) -> Result<(), String> {
    let page = page_of(state).await?;
    page.reload().await.map_err(|e| e.to_string())?;
    emit_url(app, &page).await;
    Ok(())
}

pub async fn hide(state: &BrowserCdpState) -> Result<(), String> {
    *state.visible.lock().await = false;
    let guard = state.session.lock().await;
    if let Some(sess) = guard.as_ref() {
        let window_id = window_id_of(&sess.browser, &sess.page).await?;
        let bounds = CdpWindowBounds::builder()
            .window_state(WindowState::Minimized)
            .build();
        sess.browser
            .execute(SetWindowBoundsParams::new(window_id, bounds))
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn show(state: &BrowserCdpState) -> Result<(), String> {
    *state.visible.lock().await = true;
    let b = *state.bounds.lock().await;
    let guard = state.session.lock().await;
    if let Some(sess) = guard.as_ref() {
        apply_window_bounds(&sess.browser, &sess.page, b, Some(WindowState::Normal)).await?;
        let _ = sess.page.bring_to_front().await;
    }
    Ok(())
}

pub async fn close(state: &BrowserCdpState) -> Result<(), String> {
    if let Some(mut sess) = state.session.lock().await.take() {
        sess._url_poller.abort();
        sess._handler.abort();
        sess.browser.close().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn get_content(state: &BrowserCdpState) -> Result<BrowserPageContent, String> {
    let page = page_of(state).await?;
    let url = page
        .url()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let title = page.get_title().await.map_err(|e| e.to_string())?.unwrap_or_default();
    let v = eval_json_page(&page, CONTENT_JS).await?;
    if let Some(err) = v.get("error").and_then(|x| x.as_str()) {
        if !err.is_empty() {
            return Err(format!("页面脚本错误: {err}"));
        }
    }
    Ok(BrowserPageContent {
        url,
        title: v["title"].as_str().unwrap_or(&title).to_string(),
        text: v["text"].as_str().unwrap_or("").to_string(),
    })
}

pub async fn list_interactive(state: &BrowserCdpState) -> Result<BrowserInteractiveResult, String> {
    let page = page_of(state).await?;
    let v = eval_json_page(&page, LIST_INTERACTIVE_JS).await?;
    parse_list_interactive(v)
}

pub async fn eval_json(state: &BrowserCdpState, js: &str) -> Result<serde_json::Value, String> {
    let page = page_of(state).await?;
    eval_json_page(&page, js).await
}

pub async fn click(state: &BrowserCdpState, selector: &str) -> Result<(), String> {
    let page = page_of(state).await?;
    // 优先 CDP 原生点击 (自动滚入视口)
    match page.find_element(selector).await {
        Ok(el) => {
            el.click().await.map_err(|e| e.to_string())?;
            return Ok(());
        }
        Err(_) => run_act_json(&page, browser_scripts::js_click(selector)?).await,
    }
}

pub async fn fill(state: &BrowserCdpState, selector: &str, text: &str) -> Result<(), String> {
    let page = page_of(state).await?;
    match page.find_element(selector).await {
        Ok(el) => {
            el.click().await.map_err(|e| e.to_string())?;
            // 清空后输入
            el.type_str(text).await.map_err(|e| e.to_string())?;
            return Ok(());
        }
        Err(_) => run_act_json(&page, browser_scripts::js_fill(selector, text)?).await,
    }
}

pub async fn press(state: &BrowserCdpState, key: &str) -> Result<(), String> {
    let page = page_of(state).await?;
    run_act_json(&page, browser_scripts::js_press(key)?).await
}

pub async fn wait_for_selector(
    state: &BrowserCdpState,
    selector: &str,
    timeout_ms: u64,
) -> Result<(), String> {
    let page = page_of(state).await?;
    let start = std::time::Instant::now();
    let timeout = timeout_ms.clamp(500, 30_000);
    loop {
        if page.find_element(selector).await.is_ok() {
            return Ok(());
        }
        if start.elapsed().as_millis() >= timeout as u128 {
            return Err("wait-timeout".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}
