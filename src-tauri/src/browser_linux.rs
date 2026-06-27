// Linux/WSL 内嵌浏览器 + 可拖拽收藏浮钮 (gtk::Overlay / gtk::Fixed / gtk::Button)。

use gtk::gdk::{EventMask, ModifierType};
use gtk::glib;
use gtk::prelude::*;
use std::cell::RefCell;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::{PageLoadEvent, Rect, WebView, WebViewBuilder, WebViewBuilderExtUnix};

use crate::browser_fab::{self, FabMoved};
use crate::Bounds;

struct FabDrag {
    press_root_x: f64,
    press_root_y: f64,
    orig_x: f64,
    orig_y: f64,
    moved: bool,
}

struct Inner {
    window_overlay: Option<gtk::Overlay>,
    overlay_fixed: Option<gtk::Fixed>,
    webview: Option<WebView>,
    fab_btn: Option<gtk::Button>,
    fab_drag: Option<FabDrag>,
    overlay_ready: bool,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            window_overlay: None,
            overlay_fixed: None,
            webview: None,
            fab_btn: None,
            fab_drag: None,
            overlay_ready: false,
        }
    }
}

thread_local! {
    static BROWSER: RefCell<Inner> = RefCell::new(Inner::default());
    static LAST_CONTENT: RefCell<Bounds> = RefCell::new(Bounds {
        x: 0.0,
        y: 0.0,
        w: 0.0,
        h: 0.0,
        fab_x: None,
        fab_y: None,
    });
}

fn with_browser<F, R>(f: F) -> R
where
    F: FnOnce(&mut Inner) -> R,
{
    BROWSER.with(|cell| f(&mut cell.borrow_mut()))
}

fn last_content() -> Bounds {
    LAST_CONTENT.with(|c| *c.borrow())
}

fn remember_content(b: &Bounds) {
    browser_fab::sync_content(b);
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

fn place_fab_btn(btn: &gtk::Button, fb: &Bounds) {
    btn.set_margin_start(fb.x as i32);
    btn.set_margin_top(fb.y as i32);
    btn.set_size_request(fb.w as i32, fb.h as i32);
}

fn ensure_fab(app: &AppHandle, inner: &mut Inner) -> Result<(), String> {
    if inner.fab_btn.is_some() {
        return Ok(());
    }
    let btn = gtk::Button::with_label("★ 收藏");
    btn.set_halign(gtk::Align::Start);
    btn.set_valign(gtk::Align::Start);
    btn.style_context().add_class("browser-fab");
    btn.add_events(
        EventMask::BUTTON_PRESS_MASK | EventMask::BUTTON_RELEASE_MASK | EventMask::BUTTON1_MOTION_MASK,
    );

    let app_release = app.clone();
    btn.connect_button_press_event(move |_, event| {
        if event.button() != 1 {
            return glib::Propagation::Proceed;
        }
        with_browser(|inner| {
            let content = last_content();
            let fb = browser_fab::bounds(&content);
            inner.fab_drag = Some(FabDrag {
                press_root_x: event.root().0,
                press_root_y: event.root().1,
                orig_x: fb.x,
                orig_y: fb.y,
                moved: false,
            });
        });
        glib::Propagation::Stop
    });

    btn.connect_motion_notify_event(move |_, event| {
        if event.state().contains(ModifierType::BUTTON1_MASK) {
            with_browser(|inner| {
                if let Some(d) = inner.fab_drag.as_mut() {
                    let dx = event.root().0 - d.press_root_x;
                    let dy = event.root().1 - d.press_root_y;
                    if dx * dx + dy * dy > 16.0 {
                        d.moved = true;
                    }
                    let content = last_content();
                    let fb = browser_fab::clamp_to_content(
                        &content,
                        d.orig_x + dx,
                        d.orig_y + dy,
                    );
                    browser_fab::set_custom_pos(fb.x, fb.y);
                    if let Some(b) = inner.fab_btn.as_ref() {
                        place_fab_btn(b, &fb);
                    }
                }
            });
            return glib::Propagation::Stop;
        }
        glib::Propagation::Proceed
    });

    btn.connect_button_release_event(move |_, event| {
        if event.button() != 1 {
            return glib::Propagation::Proceed;
        }
        with_browser(|inner| {
            if let Some(d) = inner.fab_drag.take() {
                if d.moved {
                    if let Some((x, y)) = browser_fab::custom_pos() {
                        let _ = app_release.emit("browser://fab-moved", FabMoved { x, y });
                    }
                } else {
                    let _ = app_release.emit("browser://favorite", ());
                }
            }
        });
        glib::Propagation::Stop
    });

    inner.fab_btn = Some(btn);
    Ok(())
}

fn sync_fab(inner: &Inner, content: &Bounds) {
    let Some(overlay) = inner.window_overlay.as_ref() else {
        return;
    };
    let Some(btn) = inner.fab_btn.as_ref() else {
        return;
    };
    let fb = browser_fab::bounds(content);
    place_fab_btn(btn, &fb);
    if btn.parent().is_none() {
        overlay.add_overlay(btn);
    }
    btn.show_all();
}

fn set_fab_visible(inner: &Inner, visible: bool) {
    if let Some(btn) = inner.fab_btn.as_ref() {
        if visible {
            btn.show_all();
        } else {
            btn.hide();
        }
    }
}

fn close_webview(inner: &mut Inner) {
    inner.webview = None;
    inner.fab_drag = None;
    set_fab_visible(inner, false);
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
        ensure_fab(app, inner)?;

        close_webview(inner);
        sync_fab(inner, &b);

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
        set_fab_visible(inner, true);
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
        sync_fab(inner, &b);
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
        set_fab_visible(inner, false);
        Ok(())
    })
}

pub fn show() -> Result<(), String> {
    with_browser(|inner| {
        if let Some(wv) = inner.webview.as_ref() {
            wv.set_visible(true).map_err(|e| e.to_string())?;
        }
        set_fab_visible(inner, true);
        Ok(())
    })
}

pub fn close() -> Result<(), String> {
    with_browser(|inner| {
        close_webview(inner);
        Ok(())
    })
}
