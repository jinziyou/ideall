// 桌面与移动端共用入口。移动端由 `mobile_entry_point` 暴露给 iOS/Android 宿主。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
