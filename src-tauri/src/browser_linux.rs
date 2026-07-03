// Linux/WSL 内嵌浏览器 (gtk::Overlay / gtk::Fixed 精确定位子 webview)。

use gtk::prelude::*;
use std::cell::RefCell;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::{PageLoadEvent, Rect, WebView, WebViewBuilder, WebViewBuilderExtUnix};

use crate::Bounds;

#[derive(Default)]
struct Inner {
    window_overlay: Option<gtk::Overlay>,
    overlay_fixed: Option<gtk::Fixed>,
    webview: Option<WebView>,
    overlay_ready: bool,
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

fn ensure_overlay(main: &WebviewWindow, inner: &mut Inner) -> Result<(), String> {
    if inner.overlay_ready {
        return Ok(());
    }
    let gtk_win = main.gtk_window().map_err(|e| e.to_string())?;
    let vbox = main.default_vbox().map_err(|e| e.to_string())?;

    gtk_win.remove(&vbox);
    let overlay = gtk::Overlay::new();
    overlay.add(&vbox);

    let fixed = gtk::Fixed::new();
    fixed.set_halign(gtk::Align::Start);
    fixed.set_valign(gtk::Align::Start);
    overlay.add_overlay(&fixed);

    gtk_win.add(&overlay);
    overlay.show_all();

    inner.window_overlay = Some(overlay);
    inner.overlay_fixed = Some(fixed);
    inner.overlay_ready = true;
    Ok(())
}

fn apply_fixed_geometry(fixed: &gtk::Fixed, b: &Bounds) {
    fixed.set_margin_start(b.x as i32);
    fixed.set_margin_top(b.y as i32);
    fixed.set_size_request(b.w.max(1.0) as i32, b.h.max(1.0) as i32);
}

fn webview_bounds(b: &Bounds) -> Rect {
    Rect {
        position: LogicalPosition::new(0.0, 0.0).into(),
        size: LogicalSize::new(b.w.max(1.0), b.h.max(1.0)).into(),
    }
}

fn close_webview(inner: &mut Inner) {
    inner.webview = None;
}

pub fn open(app: &AppHandle, url: String, b: Bounds) -> Result<(), String> {
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
        apply_fixed_geometry(fixed, &b);

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

        inner.webview = Some(webview);
        Ok(())
    })
}

pub fn set_bounds(b: Bounds) -> Result<(), String> {
    remember_content(&b);
    with_browser(|inner| {
        if let Some(fixed) = inner.overlay_fixed.as_ref() {
            apply_fixed_geometry(fixed, &b);
        }
        if let Some(wv) = inner.webview.as_ref() {
            wv.set_bounds(webview_bounds(&b))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}

pub fn navigate(url: &str) -> Result<(), String> {
    crate::parse_http_url(url)?;
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

pub fn back() -> Result<(), String> {
    eval_script("history.back()")
}

pub fn forward() -> Result<(), String> {
    eval_script("history.forward()")
}

pub fn reload() -> Result<(), String> {
    with_browser(|inner| {
        inner
            .webview
            .as_ref()
            .ok_or_else(|| "浏览器视图不存在".to_string())?
            .reload()
            .map_err(|e| e.to_string())
    })
}

pub fn hide() -> Result<(), String> {
    with_browser(|inner| {
        if let Some(wv) = inner.webview.as_ref() {
            wv.set_visible(false).map_err(|e| e.to_string())?;
        }
        // 仅隐藏 webview 不够: gtk::Fixed overlay 仍占矩形并拦截下方 iframe 的点击 (WSL/Linux)。
        if let Some(fixed) = inner.overlay_fixed.as_ref() {
            fixed.hide();
        }
        Ok(())
    })
}

pub fn show() -> Result<(), String> {
    with_browser(|inner| {
        if let Some(fixed) = inner.overlay_fixed.as_ref() {
            fixed.show_all();
        }
        if let Some(wv) = inner.webview.as_ref() {
            wv.set_visible(true).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}

pub fn close() -> Result<(), String> {
    with_browser(|inner| {
        close_webview(inner);
        Ok(())
    })
}

/// 读取当前页 URL + 标题 + 正文 (innerText, 截断 8000 字符)。
pub fn get_content() -> Result<crate::BrowserPageContent, String> {
    use std::sync::mpsc;
    use std::time::Duration;

    const JS: &str = r#"
(function(){
  try {
    var t = (document.body && document.body.innerText) || '';
    return JSON.stringify({title: document.title || '', text: t.slice(0, 8000)});
  } catch(e) {
    return JSON.stringify({title: '', text: '', error: String(e)});
  }
})()
"#;

    with_browser(|inner| {
        let wv = inner
            .webview
            .as_ref()
            .ok_or_else(|| "浏览器视图不存在".to_string())?;
        let url = wv.url().unwrap_or_default();
        let (tx, rx) = mpsc::sync_channel(1);
        wv.evaluate_script_with_callback(JS, move |result| {
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
        let json_str = rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "读取页面超时".to_string())?;
        crate::parse_browser_page_json(url, &json_str)
    })
}
