// 主窗口启动位置 (桌面): 三屏/WSL 下于主屏 work area 居中。
// 全屏/最大化后关闭时 WM 会记住错误坐标 → 启动/关闭时先 normalize 再居中。

use std::time::Duration;

use tauri::utils::config::WindowConfig;
use tauri::{
    LogicalSize, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow,
};

const CENTER_TOLERANCE_PX: i32 = 32;
const CORNER_TOLERANCE_PX: i32 = 48;
const MAX_PLACE_ATTEMPTS: u8 = 16;

/// 按目标屏 work area 缩小 (若需) 并居中; 返回是否已对齐中心。
pub fn place_main_window(window: &WebviewWindow, conf: &WindowConfig) -> Result<bool, String> {
    let monitor = target_monitor(window)?;
    normalize_window_state(window, conf, &monitor)?;
    let size = center_size(conf, &monitor);
    let pos = center_in_work_area(&monitor, size);
    window
        .set_position(PhysicalPosition::new(pos.x, pos.y))
        .map_err(|e| e.to_string())?;
    Ok(is_well_centered(window, &monitor, size))
}

pub fn schedule_initial_placement(window: &WebviewWindow, conf: WindowConfig) {
    let target = window.clone();
    let attempts = std::cell::Cell::new(0u8);
    let event_conf = conf.clone();

    window.on_window_event({
        let target = target.clone();
        let event_conf = event_conf.clone();
        move |event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                if let Ok(monitor) = target_monitor(&target) {
                    let _ = normalize_on_close(&target);
                    let _ = normalize_window_state(&target, &event_conf, &monitor);
                    let size = center_size(&event_conf, &monitor);
                    let pos = center_in_work_area(&monitor, size);
                    let _ = target.set_position(PhysicalPosition::new(pos.x, pos.y));
                } else {
                    let _ = normalize_on_close(&target);
                }
            }
            tauri::WindowEvent::Resized(size) => {
                if target_monitor(&target)
                    .ok()
                    .is_some_and(|m| resize_ready(size, &event_conf, &m))
                {
                    try_place_window(&target, &event_conf, Some(&attempts));
                }
            }
            tauri::WindowEvent::Focused(true) | tauri::WindowEvent::Moved(_) => {
                try_place_window(&target, &event_conf, Some(&attempts));
            }
            _ => {}
        }
    });

    // WSLg: WM 常在启动后较晚才恢复上次全屏/坐标, 需延迟覆盖。
    #[cfg(target_os = "linux")]
    {
        std::thread::spawn(move || {
            for delay_ms in [80_u64, 200, 500, 1000, 2000, 3500] {
                std::thread::sleep(Duration::from_millis(delay_ms));
                let w = target.clone();
                let c = conf.clone();
                let w2 = w.clone();
                let _ = w.run_on_main_thread(move || {
                    try_place_window(&w2, &c, None);
                });
            }
        });
    }
}

fn try_place_window(
    window: &WebviewWindow,
    conf: &WindowConfig,
    attempts: Option<&std::cell::Cell<u8>>,
) {
    if attempts.is_some_and(|a| a.get() >= MAX_PLACE_ATTEMPTS) {
        return;
    }
    if let Ok(monitor) = target_monitor(window) {
        let stuck = is_stuck_in_corner(window, &monitor).unwrap_or(true);
        let centered = place_main_window(window, conf).unwrap_or(false);
        if let Some(a) = attempts {
            if centered && !stuck {
                a.set(MAX_PLACE_ATTEMPTS);
            } else {
                a.set(a.get().saturating_add(1));
            }
        }
    }
}

/// 关闭前退出全屏/最大化, 避免 WM 把错误右下角坐标写入会话。
fn normalize_on_close(window: &WebviewWindow) -> Result<(), String> {
    if window.is_fullscreen().unwrap_or(false) {
        window
            .set_fullscreen(false)
            .map_err(|e| e.to_string())?;
    }
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn normalize_window_state(
    window: &WebviewWindow,
    conf: &WindowConfig,
    monitor: &Monitor,
) -> Result<(), String> {
    normalize_on_close(window)?;
    let work = monitor.work_area();
    let scale = monitor.scale_factor();
    let max_w = work.size.width as f64 / scale;
    let max_h = work.size.height as f64 / scale;
    window
        .set_size(LogicalSize::new(
            conf.width.min(max_w),
            conf.height.min(max_h),
        ))
        .map_err(|e| e.to_string())
}

fn target_monitor(window: &WebviewWindow) -> Result<Monitor, String> {
    let monitors = window
        .available_monitors()
        .map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("no monitor".to_string());
    }
    if monitors.len() == 1 {
        return Ok(monitors[0].clone());
    }

    let largest = largest_work_area_monitor(&monitors)
        .ok_or_else(|| "no monitor".to_string())?;
    let largest_area = work_area_pixels(&largest);

    if let Ok(Some(primary)) = window.primary_monitor() {
        let primary_area = work_area_pixels(&primary);
        if primary_area >= largest_area * 9 / 10 {
            return Ok(primary);
        }
    }

    Ok(largest)
}

fn work_area_pixels(m: &Monitor) -> u64 {
    let w = m.work_area();
    w.size.width as u64 * w.size.height as u64
}

fn largest_work_area_monitor(monitors: &[Monitor]) -> Option<Monitor> {
    monitors
        .iter()
        .max_by_key(|m| work_area_pixels(m))
        .cloned()
}

fn resize_ready(size: &PhysicalSize<u32>, conf: &WindowConfig, monitor: &Monitor) -> bool {
    let scale = monitor.scale_factor();
    let min_w = ((conf.width * scale * 0.4).round() as u32)
        .clamp(360, monitor.work_area().size.width);
    let min_h = ((conf.height * scale * 0.4).round() as u32)
        .clamp(300, monitor.work_area().size.height);
    size.width >= min_w && size.height >= min_h
}

/// 居中始终按配置尺寸 (非全屏 outer), 避免用全屏尺寸算中心后缩回仍留右下角。
fn center_size(conf: &WindowConfig, monitor: &Monitor) -> PhysicalSize<u32> {
    let work = monitor.work_area();
    let scale = monitor.scale_factor();
    let w = (conf.width.min(work.size.width as f64 / scale) * scale).round() as u32;
    let h = (conf.height.min(work.size.height as f64 / scale) * scale).round() as u32;
    PhysicalSize::new(w.clamp(1, work.size.width), h.clamp(1, work.size.height))
}

fn center_in_work_area(monitor: &Monitor, size: PhysicalSize<u32>) -> PhysicalPosition<i32> {
    let work = monitor.work_area();
    let mut x = work.position.x + (work.size.width as i32 - size.width as i32) / 2;
    let mut y = work.position.y + (work.size.height as i32 - size.height as i32) / 2;
    let max_x = work.position.x + work.size.width as i32 - size.width as i32;
    let max_y = work.position.y + work.size.height as i32 - size.height as i32;
    x = x.clamp(work.position.x, max_x.max(work.position.x));
    y = y.clamp(work.position.y, max_y.max(work.position.y));
    PhysicalPosition::new(x, y)
}

fn is_well_centered(
    window: &WebviewWindow,
    monitor: &Monitor,
    size: PhysicalSize<u32>,
) -> bool {
    let Ok(pos) = window.outer_position() else {
        return false;
    };
    let target = center_in_work_area(monitor, size);
    (pos.x - target.x).abs() <= CENTER_TOLERANCE_PX
        && (pos.y - target.y).abs() <= CENTER_TOLERANCE_PX
}

/// 是否贴在目标屏右下角 (WM 全屏后常见的脏坐标)。
fn is_stuck_in_corner(window: &WebviewWindow, monitor: &Monitor) -> Result<bool, String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let work = monitor.work_area();
    let max_x = work.position.x + work.size.width as i32 - size.width as i32;
    let max_y = work.position.y + work.size.height as i32 - size.height as i32;
    Ok(pos.x >= max_x - CORNER_TOLERANCE_PX && pos.y >= max_y - CORNER_TOLERANCE_PX)
}
