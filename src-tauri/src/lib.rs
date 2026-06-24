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
    }

    let context = tauri::generate_context!();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // HTTP: App 内 fetch 经 Rust 侧发出, 绕过 webview CORS (agent 直连任意 LLM 端点)。
        .plugin(tauri_plugin_http::init());

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
