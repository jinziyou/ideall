// Linux/WSL 内嵌浏览器: 默认 WebKitGTK (wry) 嵌在窗口内; IDEALL_BROWSER_CDP=1 时改用 CDP 独立 Chrome。
// 所有公开函数须在 GTK 主线程调用 (lib.rs 经 run_on_main_thread_sync 派发); thread_local 状态亦绑定主线程。

use gtk::prelude::*;
use std::cell::RefCell;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use webkit2gtk::{TLSErrorsPolicy, WebContextExt, WebViewExt, WebsiteDataManagerExt};
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::{PageLoadEvent, Rect, WebView, WebViewBuilder, WebViewBuilderExtUnix, WebViewExtUnix};

use crate::browser_cdp::BrowserCdpState;
use crate::browser_scripts::CONTENT_JS;
use crate::Bounds;

#[derive(Copy, Clone, Debug, Default)]
struct PixelRect {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

fn bounds_to_pixel_rect(b: &Bounds) -> PixelRect {
    PixelRect {
        x: b.x.round() as i32,
        y: b.y.round() as i32,
        w: b.w.max(1.0).round() as i32,
        h: b.h.max(1.0).round() as i32,
    }
}

#[derive(Default)]
struct Inner {
    window_overlay: Option<gtk::Overlay>,
    overlay_fixed: Option<gtk::Fixed>,
    webview: Option<WebView>,
    overlay_ready: bool,
    visible: bool,
}

thread_local! {
    static BROWSER: RefCell<Inner> = RefCell::new(Inner::default());
    static LAST_CONTENT: RefCell<Bounds> = const { RefCell::new(Bounds {
        x: 0.0,
        y: 0.0,
        w: 0.0,
        h: 0.0,
    }) };
}

fn with_browser<F, R>(f: F) -> R
where
    F: FnOnce(&mut Inner) -> R,
{
    BROWSER.with(|cell| f(&mut cell.borrow_mut()))
}

fn remember_content(b: &Bounds) {
    LAST_CONTENT.with(|c| *c.borrow_mut() = *b);
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".into())
}

fn cdp_enabled(app: &AppHandle) -> bool {
    app.state::<BrowserCdpState>().enabled()
}

fn ensure_overlay(main: &WebviewWindow, inner: &mut Inner) -> Result<(), String> {
    if inner.overlay_ready {
        return Ok(());
    }
    let gtk_win = main.gtk_window().map_err(|e| e.to_string())?;
    let vbox = main.default_vbox().map_err(|e| e.to_string())?;

    gtk_win.remove(&vbox);
    let overlay = gtk::Overlay::new();
    overlay.add(&vbox);

    // 铺满 overlay 以便 gtk_fixed_move 用视口绝对坐标; 点击用 input shape 限制在内容区。
    let fixed = gtk::Fixed::new();
    fixed.set_hexpand(true);
    fixed.set_vexpand(true);
    fixed.set_halign(gtk::Align::Fill);
    fixed.set_valign(gtk::Align::Fill);
    overlay.add_overlay(&fixed);

    gtk_win.add(&overlay);
    overlay.show_all();

    inner.window_overlay = Some(overlay);
    inner.overlay_fixed = Some(fixed);
    inner.overlay_ready = true;
    Ok(())
}

/// 仅内容区接收鼠标, 其余区域穿透到主 webview (侧栏/标签/工具条可点)。
fn update_fixed_input_shape(fixed: &gtk::Fixed, b: &Bounds) {
    let Some(window) = fixed.window() else {
        return;
    };
    let r = bounds_to_pixel_rect(b);
    if r.w < 1 || r.h < 1 {
        clear_fixed_input_shape(fixed);
        return;
    }
    let region = cairo::Region::create_rectangle(&cairo::RectangleInt::new(r.x, r.y, r.w, r.h));
    window.input_shape_combine_region(&region, 0, 0);
}

fn clear_fixed_input_shape(fixed: &gtk::Fixed) {
    if let Some(window) = fixed.window() {
        let empty = cairo::Region::create();
        window.input_shape_combine_region(&empty, 0, 0);
    }
}

fn reposition_embedded_webview(fixed: &gtk::Fixed, wv: &WebView, b: &Bounds) -> Result<(), String> {
    let r = bounds_to_pixel_rect(b);
    let gtk_wv = wv.webview();
    gtk_wv.set_size_request(r.w, r.h);
    fixed.move_(&gtk_wv, r.x, r.y);
    wv.set_bounds(webview_bounds(b))
        .map_err(|e| e.to_string())?;
    update_fixed_input_shape(fixed, b);
    Ok(())
}

fn webview_bounds(b: &Bounds) -> Rect {
    let r = bounds_to_pixel_rect(b);
    Rect {
        position: LogicalPosition::new(r.x as f64, r.y as f64).into(),
        size: LogicalSize::new(r.w as f64, r.h as f64).into(),
    }
}

/// 内嵌浏览器需访问内网自签 HTTPS (如 inventory); 仅作用于本子 webview 的 WebContext, 不影响主窗口。
fn configure_embedded_browser_tls(wv: &WebView) {
    let gtk_wv = wv.webview();
    if let Some(ctx) = gtk_wv.context() {
        if let Some(wdm) = ctx.website_data_manager() {
            wdm.set_tls_errors_policy(TLSErrorsPolicy::Ignore);
        }
    }
}

fn close_webview(inner: &mut Inner) {
    inner.webview = None;
}

pub fn open(app: &AppHandle, url: String, b: Bounds) -> Result<(), String> {
    if cdp_enabled(app) {
        let state = app.state::<BrowserCdpState>();
        return tauri::async_runtime::block_on(crate::browser_cdp::open(&state, app, url, b));
    }

    let target = if url.trim().is_empty() {
        "https://www.google.com".to_string()
    } else {
        url
    };
    crate::parse_http_url(&target)?;

    let main = main_window(app)?;
    remember_content(&b);
    with_browser(|inner| {
        ensure_overlay(&main, inner)?;

        close_webview(inner);

        let fixed = inner
            .overlay_fixed
            .as_ref()
            .ok_or_else(|| "浏览器 overlay 未就绪".to_string())?;
        let app_nav = app.clone();
        let app_load = app.clone();
        let webview = WebViewBuilder::new()
            .with_url(&target)
            .with_bounds(webview_bounds(&b))
            .with_navigation_handler(move |nav_url| {
                let _ = app_nav.emit("browser://url", nav_url);
                true
            })
            .with_on_page_load_handler(move |event, nav_url| {
                if matches!(event, PageLoadEvent::Finished) {
                    let _ = app_load.emit("browser://url", nav_url);
                }
            })
            .build_gtk(fixed)
            .map_err(|e| e.to_string())?;
        configure_embedded_browser_tls(&webview);
        reposition_embedded_webview(fixed, &webview, &b)?;

        inner.webview = Some(webview);
        inner.visible = true;
        Ok(())
    })
}

pub fn set_bounds(app: &AppHandle, b: Bounds) -> Result<(), String> {
    remember_content(&b);
    if cdp_enabled(app) {
        let state = app.state::<BrowserCdpState>();
        return tauri::async_runtime::block_on(crate::browser_cdp::set_bounds(&state, app, b));
    }
    with_browser(|inner| {
        if !inner.visible {
            return Ok(());
        }
        if let (Some(fixed), Some(wv)) = (inner.overlay_fixed.as_ref(), inner.webview.as_ref()) {
            reposition_embedded_webview(fixed, wv, &b)?;
        }
        Ok(())
    })
}

pub fn navigate(app: &AppHandle, url: &str) -> Result<(), String> {
    crate::parse_http_url(url)?;
    if cdp_enabled(app) {
        let state = app.state::<BrowserCdpState>();
        return tauri::async_runtime::block_on(crate::browser_cdp::navigate(&state, app, url));
    }
    with_browser(|inner| {
        inner
            .webview
            .as_ref()
            .ok_or_else(|| "浏览器视图不存在".to_string())?
            .load_url(url)
            .map_err(|e| e.to_string())
    })
}

fn eval_script(js: &str) -> Result<(), String> {
    with_browser(|inner| {
        inner
            .webview
            .as_ref()
            .ok_or_else(|| "浏览器视图不存在".to_string())?
            .evaluate_script(js)
            .map_err(|e| e.to_string())
    })
}

/// 在子 webview 执行 JS 并解析 JSON 返回值 (evaluate_script_with_callback)。
pub fn eval_json(js: &str) -> Result<serde_json::Value, String> {
    use std::sync::mpsc;
    use std::time::Duration;

    with_browser(|inner| {
        let wv = inner
            .webview
            .as_ref()
            .ok_or_else(|| "浏览器视图不存在".to_string())?;
        let (tx, rx) = mpsc::sync_channel(1);
        wv.evaluate_script_with_callback(js, move |result| {
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
        let json_str = rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "执行超时".to_string())?;
        serde_json::from_str(&json_str).map_err(|e| format!("解析脚本结果失败: {e}"))
    })
}

pub fn back(app: &AppHandle) -> Result<(), String> {
    if cdp_enabled(app) {
        let state = app.state::<BrowserCdpState>();
        return tauri::async_runtime::block_on(crate::browser_cdp::back(&state, app));
    }
    eval_script("history.back()")
}

pub fn forward(app: &AppHandle) -> Result<(), String> {
    if cdp_enabled(app) {
        let state = app.state::<BrowserCdpState>();
        return tauri::async_runtime::block_on(crate::browser_cdp::forward(&state, app));
    }
    eval_script("history.forward()")
}

pub fn reload(app: &AppHandle) -> Result<(), String> {
    if cdp_enabled(app) {
        let state = app.state::<BrowserCdpState>();
        return tauri::async_runtime::block_on(crate::browser_cdp::reload(&state, app));
    }
    with_browser(|inner| {
        inner
            .webview
            .as_ref()
            .ok_or_else(|| "浏览器视图不存在".to_string())?
            .reload()
            .map_err(|e| e.to_string())
    })
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    if cdp_enabled(app) {
        let state = app.state::<BrowserCdpState>();
        return tauri::async_runtime::block_on(crate::browser_cdp::hide(&state));
    }
    with_browser(|inner| {
        inner.visible = false;
        if let Some(wv) = inner.webview.as_ref() {
            wv.set_visible(false).map_err(|e| e.to_string())?;
        }
        if let Some(fixed) = inner.overlay_fixed.as_ref() {
            clear_fixed_input_shape(fixed);
            fixed.hide();
        }
        Ok(())
    })
}

pub fn show(app: &AppHandle) -> Result<(), String> {
    if cdp_enabled(app) {
        let state = app.state::<BrowserCdpState>();
        return tauri::async_runtime::block_on(crate::browser_cdp::show(&state, app));
    }
    with_browser(|inner| {
        inner.visible = true;
        let b = LAST_CONTENT.with(|c| *c.borrow());
        if let (Some(fixed), Some(wv)) = (inner.overlay_fixed.as_ref(), inner.webview.as_ref()) {
            reposition_embedded_webview(fixed, wv, &b)?;
            fixed.show_all();
        }
        if let Some(wv) = inner.webview.as_ref() {
            wv.set_visible(true).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}

pub fn close(app: &AppHandle) -> Result<(), String> {
    if cdp_enabled(app) {
        let state = app.state::<BrowserCdpState>();
        return tauri::async_runtime::block_on(crate::browser_cdp::close(&state));
    }
    with_browser(|inner| {
        inner.visible = false;
        if let Some(wv) = inner.webview.as_ref() {
            let _ = wv.set_visible(false);
        }
        if let Some(fixed) = inner.overlay_fixed.as_ref() {
            clear_fixed_input_shape(fixed);
            fixed.hide();
        }
        close_webview(inner);
        Ok(())
    })
}

pub fn get_content(app: &AppHandle) -> Result<crate::BrowserPageContent, String> {
    if cdp_enabled(app) {
        let state = app.state::<BrowserCdpState>();
        if tauri::async_runtime::block_on(state.is_running()) {
            return tauri::async_runtime::block_on(crate::browser_cdp::get_content(&state));
        }
    }

    with_browser(|inner| {
        let wv = inner
            .webview
            .as_ref()
            .ok_or_else(|| "浏览器视图不存在".to_string())?;
        let url = wv.url().unwrap_or_default();
        let v = eval_json(CONTENT_JS)?;
        if let Some(err) = v.get("error").and_then(|x| x.as_str()) {
            if !err.is_empty() {
                return Err(format!("页面脚本错误: {err}"));
            }
        }
        Ok(crate::BrowserPageContent {
            url,
            title: v["title"].as_str().unwrap_or("").to_string(),
            text: v["text"].as_str().unwrap_or("").to_string(),
        })
    })
}
