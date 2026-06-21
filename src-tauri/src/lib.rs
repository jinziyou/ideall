// 桌面与移动端共用入口。移动端由 `mobile_entry_point` 暴露给 iOS/Android 宿主。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
