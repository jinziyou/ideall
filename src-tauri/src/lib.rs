// 内嵌浏览器 (连接模式, 路线 A): 主窗口内嵌一个原生子 webview 显示外站, 工具条 (地址栏/前进后退/
// 刷新/收藏) 由主窗口可信本地前端渲染。子 webview 是浮在 HTML 之上的原生层 (无法被 DOM 盖住), 故其
// 矩形必须与工具条不重叠 (前端按内容区 getBoundingClientRect 同步 bounds); 切走标签则 hide。
// 收藏由主窗口前端直接写本地书签 (URL 来自 on_navigation/on_page_load emit 回前端), 不依赖外站 webview
// 的 IPC (Tauri v2 不向 External webview 注入 IPC)。需 Cargo feature "unstable" (Window::add_child);
// WSL2 需 X11 (Wayland 下 add_child 不工作, app-dev.mjs 注入 GDK_BACKEND=x11)。仅桌面 (desktop)。
#[cfg(desktop)]
use tauri::webview::{PageLoadEvent, WebviewBuilder};
#[cfg(desktop)]
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

#[cfg(desktop)]
const BROWSER_LABEL: &str = "browser_view";

// 主窗口内容区矩形 (CSS 像素, 相对窗口左上)。直接当 Logical 传, 勿乘 devicePixelRatio (Tauri 自动按 scale 换算)。
#[cfg(desktop)]
#[derive(serde::Deserialize)]
struct Bounds {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[cfg(desktop)]
fn parse_http_url(url: &str) -> Result<tauri::Url, String> {
    let u: tauri::Url = url.parse().map_err(|e| format!("非法网址: {e}"))?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err("仅支持 http/https".into());
    }
    Ok(u)
}

/// 打开 (或重建) 内嵌浏览器子 webview, 加载 url, 定位到主窗口内容区 bounds。
#[cfg(desktop)]
#[tauri::command]
fn open_browser_view(app: AppHandle, url: String, b: Bounds) -> Result<(), String> {
    let target = if url.trim().is_empty() {
        "https://www.google.com".to_string()
    } else {
        url
    };
    let parsed = parse_http_url(&target)?;
    let main = app.get_webview_window("main").ok_or("主窗口不存在")?;
    let window = main.as_ref().window();
    // 单例: 已存在则先关。
    if let Some(w) = app.get_webview(BROWSER_LABEL) {
        let _ = w.close();
    }
    let app_nav = app.clone();
    let app_load = app.clone();
    let builder = WebviewBuilder::new(BROWSER_LABEL, WebviewUrl::External(parsed))
        // 用户点页面内链接的 top-level 导航 → 同步 URL 回工具条 (true=放行)。SPA pushState 不触发, 属已知限制。
        .on_navigation(move |target| {
            let _ = app_nav.emit("browser://url", target.to_string());
            true
        })
        // 页面加载完成再同步一次 (更准)。
        .on_page_load(move |_webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = app_load.emit("browser://url", payload.url().to_string());
            }
        });
    window
        .add_child(
            builder,
            LogicalPosition::new(b.x, b.y),
            LogicalSize::new(b.w, b.h),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 同步子 webview 矩形 (内容区随窗口缩放/侧栏折叠变化时调用)。
#[cfg(desktop)]
#[tauri::command]
fn browser_set_bounds(app: AppHandle, b: Bounds) -> Result<(), String> {
    let wv = app.get_webview(BROWSER_LABEL).ok_or("浏览器视图不存在")?;
    wv.set_position(LogicalPosition::new(b.x, b.y))
        .map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(b.w, b.h))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 地址栏导航到新 url。
#[cfg(desktop)]
#[tauri::command]
fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = parse_http_url(&url)?;
    app.get_webview(BROWSER_LABEL)
        .ok_or("浏览器视图不存在")?
        .navigate(parsed)
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
fn browser_eval(app: &AppHandle, js: &str) -> Result<(), String> {
    app.get_webview(BROWSER_LABEL)
        .ok_or("浏览器视图不存在")?
        .eval(js)
        .map_err(|e| e.to_string())
}

// 前进/后退/刷新: Webview 无原生 API, 用 eval (history/location)。
#[cfg(desktop)]
#[tauri::command]
fn browser_back(app: AppHandle) -> Result<(), String> {
    browser_eval(&app, "history.back()")
}
#[cfg(desktop)]
#[tauri::command]
fn browser_forward(app: AppHandle) -> Result<(), String> {
    browser_eval(&app, "history.forward()")
}
#[cfg(desktop)]
#[tauri::command]
fn browser_reload(app: AppHandle) -> Result<(), String> {
    browser_eval(&app, "location.reload()")
}

// 隐藏/显示/关闭子 webview (标签切走 hide, 切回 show, 关标签 close)。
#[cfg(desktop)]
#[tauri::command]
fn browser_hide(app: AppHandle) -> Result<(), String> {
    app.get_webview(BROWSER_LABEL)
        .ok_or("浏览器视图不存在")?
        .hide()
        .map_err(|e| e.to_string())
}
#[cfg(desktop)]
#[tauri::command]
fn browser_show(app: AppHandle) -> Result<(), String> {
    app.get_webview(BROWSER_LABEL)
        .ok_or("浏览器视图不存在")?
        .show()
        .map_err(|e| e.to_string())
}
#[cfg(desktop)]
#[tauri::command]
fn browser_close(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview(BROWSER_LABEL) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// 桌面与移动端共用入口。移动端由 `mobile_entry_point` 暴露给 iOS/Android 宿主。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WSL2 / 无独立 GPU 的 Linux 桌面下, WebKitGTK 的 DMABUF / 加速合成渲染会初始化失败
    // (libEGL / MESA ZINK / dri2 报错), 导致窗口空白。在 webview 创建前(此处, 仍单线程)默认
    // 开启软件渲染, 免去每次手动 `WEBKIT_DISABLE_DMABUF_RENDERER=1 ... pnpm app:dev`。
    // WebProcess 在窗口加载时 fork, 继承本进程内存中的 environ, 故 set_var 对其生效。
    // 仅 Linux 生效 (WebKitGTK); macOS(WKWebView)/Windows(WebView2) 无此 webview 故跳过。
    // 已手动设置则不覆盖; dev 与生产打包均走此入口, 一处搞定。
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        // 注: 内嵌浏览器子 webview (Window::add_child) 仅支持 X11 (Wayland 下不显示)。但在 WSLg 下
        // 强制 GDK_BACKEND=x11 会使 XWayland 不渲染鼠标光标 (整窗看不到鼠标) —— 二者不可兼得, 故此处
        // 不默认强制 x11 (优先保 app 可用)。需在 WSLg 调内嵌浏览器时, 手动 `GDK_BACKEND=x11 pnpm app:dev`
        // 临时开启 (接受光标副作用)。目标平台 Windows(WebView2) 无 Wayland/XWayland, 无此矛盾。
    }

    let context = tauri::generate_context!();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // HTTP: App 内 fetch 经 Rust 侧发出, 绕过 webview CORS (agent 直连任意 LLM 端点)。
        .plugin(tauri_plugin_http::init());

    // 内嵌浏览器命令仅桌面 (Window::add_child = desktop + unstable feature)。
    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        open_browser_view,
        browser_set_bounds,
        browser_navigate,
        browser_back,
        browser_forward,
        browser_reload,
        browser_hide,
        browser_show,
        browser_close
    ]);

    // 自动更新仅桌面: 移动端经应用商店分发。
    // 仅当 tauri.conf.json 配了 `plugins.updater` (endpoints + pubkey) 时才挂 updater 插件 ——
    // 否则其初始化会因缺配置反序列化失败 (invalid type: null) 而 panic, 致桌面生产 App 启动即崩。
    // 配置缺失时静默跳过, 待发布签名就绪 (配好 plugins.updater) 自然启用。
    #[cfg(desktop)]
    let builder = if context.config().plugins.0.contains_key("updater") {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };

    builder
        .run(context)
        .expect("error while running tauri application");
}
