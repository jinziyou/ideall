// Windows release 下不弹额外控制台窗口, 勿删。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ideall_lib::run()
}
