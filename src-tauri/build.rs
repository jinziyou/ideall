fn main() {
    // 声明本应用自定义命令, 让 tauri-build 为其生成 ACL permission (allow-open-browser /
    // allow-save-bookmark), 供 capabilities/*.json 引用。build.rs 是独立编译单元, 看不到
    // lib.rs 里宏定义的命令, 故必须在此显式列出 (否则 capability 引用会报 "permission not found")。
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                // agent 出站守卫 (两端通用); 其余为桌面内嵌浏览器命令。
                "agent_guarded_fetch",
                "open_browser_view",
                "browser_set_bounds",
                "browser_navigate",
                "browser_back",
                "browser_forward",
                "browser_reload",
                "browser_hide",
                "browser_show",
                "browser_close",
            ]),
        ),
    )
    .expect("failed to run tauri-build")
}
