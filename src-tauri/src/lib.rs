// 桌面与移动端共用入口。移动端由 `mobile_entry_point` 暴露给 iOS/Android 宿主。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // HTTP: App 内 fetch 经 Rust 侧发出, 绕过 webview CORS (agent 直连任意 LLM 端点)。
        .plugin(tauri_plugin_http::init());

    // 自动更新仅桌面: 移动端经应用商店分发。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
