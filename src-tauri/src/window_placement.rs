// 主窗口启动位置 (桌面): 识别屏幕 → 判定主屏 → 在主屏 work area 正中显示。
// WSLg 有时 available_monitors 只回报跨屏虚拟桌面, 但 primary_monitor 仍是单块物理屏 → 优先用后者。
// 全屏/最大化后关闭时 WM 会记住错误坐标 → 启动/关闭时先 normalize 再居中。

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
#[cfg(target_os = "linux")]
use std::time::Duration;

use tauri::utils::config::WindowConfig;
use tauri::{
    LogicalSize, Monitor, PhysicalPosition, PhysicalRect, PhysicalSize, WebviewWindow,
};

const CORNER_TOLERANCE_PX: i32 = 48;
const MAX_PLACE_ATTEMPTS: u8 = 8;
/// 单块 work area 宽度超过此值时, 视为 WSLg 合并多屏的虚拟桌面 (典型三横屏 ~4800–5200px)。
const SPANNING_DESKTOP_MIN_WIDTH: u32 = 3200;

/// WSL 伪最大化: WM 的 maximize 无法可靠铺满单屏, 改用手动对齐主屏 work area。
static WSL_PSEUDO_MAX: AtomicBool = AtomicBool::new(false);

/// 铺满主屏可用区域 (WSL 最大化用)。
pub fn apply_primary_work_area(window: &WebviewWindow) -> Result<(), String> {
    if !wsl_managed_maximize() {
        return Ok(());
    }
    // 须在改尺寸/坐标前置位, 否则 Resized 回调里的 try_place_window 会把窗口拉回居中。
    WSL_PSEUDO_MAX.store(true, Ordering::Relaxed);
    let screens = enumerate_screens(window)?;
    let primary = pick_primary_screen(window, &screens)?;
    if window.is_fullscreen().unwrap_or(false) {
        window.set_fullscreen(false).map_err(|e| e.to_string())?;
    }
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())?;
    }
    let work = primary.work_area();
    let scale = window
        .scale_factor()
        .unwrap_or_else(|_| primary.scale_factor());
    let logical_w = work.size.width as f64 / scale;
    let logical_h = work.size.height as f64 / scale;
    window
        .set_size(LogicalSize::new(logical_w, logical_h))
        .map_err(|e| e.to_string())?;
    settle_window_size_for_wsl(window, &work.size)?;
    apply_window_position(window, work.position)?;
    notify_webview_resize(window);
    if let Ok(outer) = window.outer_size() {
        eprintln!(
            "[ideall] 铺满主屏 work area: {}×{} logical (scale={scale}, physical {}×{}) @ ({}, {}), 实际 {}×{}",
            logical_w.round(),
            logical_h.round(),
            work.size.width,
            work.size.height,
            work.position.x,
            work.position.y,
            outer.width,
            outer.height
        );
    }
    Ok(())
}

/// GTK/WSL 手工改窗尺寸后, webview 内 CSS 视口 (dvh/innerHeight) 可能不刷新 → 派发 resize。
fn notify_webview_resize(window: &WebviewWindow) {
    let script = r#"window.dispatchEvent(new Event("resize"));"#;
    if let Err(e) = window.eval(script) {
        eprintln!("[ideall] webview resize notify failed: {e}");
    }
}

/// 窗控「最大化/还原」: WSL 走伪最大化; 其余平台用系统 toggleMaximize。
pub fn toggle_primary_maximize(window: &WebviewWindow, _conf: &WindowConfig) -> Result<bool, String> {
    if wsl_managed_maximize() {
        if WSL_PSEUDO_MAX.load(Ordering::Relaxed) {
            WSL_PSEUDO_MAX.store(false, Ordering::Relaxed);
            let _ = normalize_on_close(window);
            place_main_window(window, _conf)?;
            notify_webview_resize(window);
            return Ok(false);
        }
        apply_primary_work_area(window)?;
        return Ok(true);
    }
    let next = !window.is_maximized().unwrap_or(false);
    if next {
        window.maximize().map_err(|e| e.to_string())?;
    } else {
        window.unmaximize().map_err(|e| e.to_string())?;
    }
    Ok(next)
}

/// 窗控图标状态: WSL 伪最大化时也为 true。
pub fn is_primary_maximized(window: &WebviewWindow) -> bool {
    if wsl_managed_maximize() {
        return WSL_PSEUDO_MAX.load(Ordering::Relaxed);
    }
    window.is_maximized().unwrap_or(false)
}

/// 识别屏幕 → 判定主屏 → 在主屏正中放置; 返回是否已对齐且完全落在主屏内。
pub fn place_main_window(window: &WebviewWindow, conf: &WindowConfig) -> Result<bool, String> {
    let screens = enumerate_screens(window)?;
    log_all_screens(&screens);
    let primary = pick_primary_screen(window, &screens)?;
    let size = placement_size(window, conf)?;
    if size.width < 200 || size.height < 200 {
        eprintln!("[ideall] 窗口尚未就绪 ({}×{}), 跳过定位", size.width, size.height);
        return Ok(false);
    }
    normalize_window_state(window, conf, &primary)?;
    // set_size 后重新取实际尺寸 (WSL/HiDPI 下与预估可能不同)。
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let pos = center_in_work_area(&primary, size);
    log_placement_target(&primary, size, pos);
    apply_window_position(window, pos)?;
    Ok(is_well_placed(window, &primary, &screens, size))
}

pub fn schedule_initial_placement(window: &WebviewWindow, conf: WindowConfig) {
    let target = window.clone();
    let attempts = Arc::new(AtomicU8::new(0));
    let event_conf = conf.clone();

    // 等窗口尺寸就绪后再定位 (启动时 outer_size 常为 0)。
    window.on_window_event({
        let target = target.clone();
        let event_conf = event_conf.clone();
        let attempts = attempts.clone();
        move |event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                if let Ok(screens) = enumerate_screens(&target) {
                    if let Ok(primary) = pick_primary_screen(&target, &screens) {
                        let _ = normalize_on_close(&target);
                        let _ = normalize_window_state(&target, &event_conf, &primary);
                        if let Ok(size) = target.outer_size() {
                            let pos = center_in_work_area(&primary, size);
                            let _ = apply_window_position(&target, pos);
                        }
                    }
                } else {
                    let _ = normalize_on_close(&target);
                }
            }
            tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::Focused(true)
            | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                if window_is_user_expanded(&target) && !WSL_PSEUDO_MAX.load(Ordering::Relaxed) {
                    try_fix_expanded_on_primary(&target, Some(attempts.as_ref()));
                } else if !WSL_PSEUDO_MAX.load(Ordering::Relaxed) {
                    try_place_window(&target, &event_conf, Some(attempts.as_ref()));
                }
            }
            // Moved 不触发重定位, 避免拖动窗口后被拉回。
            _ => {}
        }
    });

    // WSLg: WM 常在启动后较晚才恢复上次全屏/坐标, 需延迟覆盖。
    #[cfg(target_os = "linux")]
    {
        let attempts = attempts.clone();
        std::thread::spawn(move || {
            for delay_ms in [80_u64, 200, 500, 1000, 2000, 3500, 5000, 8000] {
                if attempts.load(Ordering::Relaxed) >= MAX_PLACE_ATTEMPTS {
                    break;
                }
                std::thread::sleep(Duration::from_millis(delay_ms));
                let w = target.clone();
                let c = conf.clone();
                let a = attempts.clone();
                let w2 = w.clone();
                let _ = w.run_on_main_thread(move || {
                    try_place_window(&w2, &c, Some(a.as_ref()));
                });
            }
        });
    }
}

fn window_is_user_expanded(window: &WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false)
}

/// 窗口已手动铺满主屏 work area (WSL 伪最大化), 勿再按 conf 缩回 1200×800。
fn fills_primary_work_area(window: &WebviewWindow, primary: &Monitor) -> bool {
    let Ok(size) = window.outer_size() else {
        return false;
    };
    let Ok(pos) = read_window_position(window) else {
        return false;
    };
    let work = primary.work_area();
    const TOL: u32 = 48;
    size.width + TOL >= work.size.width
        && size.height + TOL >= work.size.height
        && pos.x <= work.position.x + TOL as i32
        && pos.y <= work.position.y + TOL as i32
        && window_rect_fits_in_work_area(pos, size, primary)
}

fn try_fix_expanded_on_primary(window: &WebviewWindow, attempts: Option<&AtomicU8>) {
    if !wsl_managed_maximize() {
        return;
    }
    if !window_is_user_expanded(window) {
        return;
    }
    let Ok(screens) = enumerate_screens(window) else {
        return;
    };
    let Ok(primary) = pick_primary_screen(window, &screens) else {
        return;
    };
    let Ok(pos) = read_window_position(window) else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };

    let bad = size.width >= SPANNING_DESKTOP_MIN_WIDTH
        || straddles_screens(pos, size, &screens)
        || !window_rect_fits_in_work_area(pos, size, &primary)
        || is_stuck_in_corner(pos, size, &primary);

    if !bad {
        return;
    }

    eprintln!("[ideall] 最大化/全屏跨屏或越界 → 铺满主屏 work area (WSL 伪最大化)");
    let _ = normalize_on_close(window);
    let _ = apply_primary_work_area(window);

    if let Some(a) = attempts {
        a.store(MAX_PLACE_ATTEMPTS, Ordering::Relaxed);
    }
}

fn try_place_window(
    window: &WebviewWindow,
    conf: &WindowConfig,
    attempts: Option<&AtomicU8>,
) {
    if attempts.is_some_and(|a| a.load(Ordering::Relaxed) >= MAX_PLACE_ATTEMPTS) {
        return;
    }
    if WSL_PSEUDO_MAX.load(Ordering::Relaxed) {
        return;
    }
    // 原生 WM 最大化/全屏: 勿干预 (Windows 双屏下误触 apply_primary_work_area 会导致
    // is_maximized=false 但视觉已铺满 → 再点 maximize 跨屏溢出)。
    if window_is_user_expanded(window) {
        if wsl_managed_maximize() {
            try_fix_expanded_on_primary(window, attempts);
        }
        return;
    }
    let Ok(screens) = enumerate_screens(window) else {
        return;
    };
    let Ok(primary) = pick_primary_screen(window, &screens) else {
        return;
    };
    if fills_primary_work_area(window, &primary) {
        if let Some(a) = attempts {
            a.store(MAX_PLACE_ATTEMPTS, Ordering::Relaxed);
        }
        return;
    }
    let needs_fix = needs_reposition(window, &primary, &screens).unwrap_or(true);
    if !needs_fix {
        if let Some(a) = attempts {
            a.store(MAX_PLACE_ATTEMPTS, Ordering::Relaxed);
        }
        return;
    }
    let placed = place_main_window(window, conf).unwrap_or(false);
    if let Some(a) = attempts {
        if placed {
            a.store(MAX_PLACE_ATTEMPTS, Ordering::Relaxed);
        } else {
            a.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// 关闭前退出全屏/最大化, 避免 WM 把错误右下角坐标写入会话。
fn normalize_on_close(window: &WebviewWindow) -> Result<(), String> {
    WSL_PSEUDO_MAX.store(false, Ordering::Relaxed);
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
    let scale = window.scale_factor().unwrap_or(monitor.scale_factor());
    let max_w = work.size.width as f64 / scale;
    let max_h = work.size.height as f64 / scale;
    window
        .set_size(LogicalSize::new(
            conf.width.min(max_w),
            conf.height.min(max_h),
        ))
        .map_err(|e| e.to_string())
}

/// GTK 在窗口未映射时常返回 (0,0) 或 i16 哨兵值 (-32768), 不可信。
fn gtk_position_valid(x: i32, y: i32) -> bool {
    x > -10_000 && y > -10_000 && !(x == 0 && y == 0)
}

fn physical_position_valid(pos: PhysicalPosition<i32>) -> bool {
    gtk_position_valid(pos.x, pos.y)
}

#[cfg(target_os = "linux")]
fn running_under_wsl() -> bool {
    std::fs::read_to_string("/proc/version")
        .map(|v| {
            let lower = v.to_lowercase();
            lower.contains("microsoft") || lower.contains("wsl")
        })
        .unwrap_or(false)
}

/// 仅 WSL 需本模块接管最大化; Windows/macOS/原生 Linux 信任 WM 原生 maximize。
fn wsl_managed_maximize() -> bool {
    #[cfg(target_os = "linux")]
    {
        running_under_wsl()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// WSLg X11 WM 对 gtk move_ 有固定偏移 (实测 move 802,541 → 实际 764,482)。
/// 可通过 IDEALL_PLACEMENT_OFFSET=x,y 覆盖, 设为 0,0 关闭。
#[cfg(target_os = "linux")]
fn gtk_placement_offset() -> (i32, i32) {
    if let Ok(v) = std::env::var("IDEALL_PLACEMENT_OFFSET") {
        let mut parts = v.split(',');
        if let (Some(xs), Some(ys)) = (parts.next(), parts.next()) {
            if let (Ok(x), Ok(y)) = (xs.trim().parse::<i32>(), ys.trim().parse::<i32>()) {
                return (x, y);
            }
        }
    }
    if running_under_wsl() {
        (38, 59)
    } else {
        (0, 0)
    }
}

/// WSLg 下 set_size 异步生效; 尺寸未收敛就 move_ 会导致 WM 拒绝贴边 (尤其最大化到 0,0)。
#[cfg(target_os = "linux")]
fn settle_window_size_for_wsl(
    window: &WebviewWindow,
    target: &PhysicalSize<u32>,
) -> Result<(), String> {
    if !running_under_wsl() {
        return Ok(());
    }
    for _ in 0..8 {
        while gtk::events_pending() {
            gtk::main_iteration();
        }
        if let Ok(outer) = window.outer_size() {
            if outer.width <= target.width + 2 && outer.height <= target.height + 2 {
                return Ok(());
            }
        }
        std::thread::sleep(Duration::from_millis(16));
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn settle_window_size_for_wsl(
    _window: &WebviewWindow,
    _target: &PhysicalSize<u32>,
) -> Result<(), String> {
    Ok(())
}

/// 设置窗口位置。WSLg Wayland 忽略坐标; X11 下走 gtk move_ (不做读回补偿 —— 立即读回常为旧坐标)。
fn apply_window_position(
    window: &WebviewWindow,
    pos: PhysicalPosition<i32>,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let scale = window.scale_factor().unwrap_or(1.0);
        let lx = (pos.x as f64 / scale).round() as i32;
        let ly = (pos.y as f64 / scale).round() as i32;
        use gtk::prelude::GtkWindowExt;
        if let Ok(gtk_win) = window.gtk_window() {
            let (ox, oy) = gtk_placement_offset();
            let mx = lx + ox;
            let my = ly + oy;
            gtk_win.move_(mx, my);
            gtk_win.present();
            eprintln!(
                "[ideall] gtk move_({mx}, {my}) [目标 ({lx}, {ly}), 偏移 ({ox}, {oy}), 物理 ({}, {}), scale={scale}]",
                pos.x, pos.y
            );
            return Ok(());
        }
    }

    window
        .set_position(PhysicalPosition::new(pos.x, pos.y))
        .map_err(|e| e.to_string())
}

fn read_window_position(window: &WebviewWindow) -> Result<PhysicalPosition<i32>, String> {
    if let Ok(pos) = window.outer_position() {
        if physical_position_valid(pos) {
            return Ok(pos);
        }
    }
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::GtkWindowExt;
        if let Ok(gtk_win) = window.gtk_window() {
            let (x, y) = gtk_win.position();
            if gtk_position_valid(x, y) {
                let scale = window.scale_factor().unwrap_or(1.0);
                return Ok(PhysicalPosition::new(
                    (x as f64 * scale).round() as i32,
                    (y as f64 * scale).round() as i32,
                ));
            }
        }
    }
    window.outer_position().map_err(|e| e.to_string())
}

// ── 1. 识别屏幕 ──────────────────────────────────────────────────────────────

fn enumerate_screens(window: &WebviewWindow) -> Result<Vec<Monitor>, String> {
    let all = window
        .available_monitors()
        .map_err(|e| e.to_string())?;
    let physical: Vec<Monitor> = all
        .iter()
        .filter(|m| !is_likely_spanning_desktop(m))
        .cloned()
        .collect();

    if !physical.is_empty() {
        return Ok(physical);
    }

    // WSLg 常见: available 只有一块跨屏虚拟桌面, 但 primary_monitor 仍是单块物理屏 (如屏 3)。
    if let Ok(Some(primary)) = window.primary_monitor() {
        if !is_likely_spanning_desktop(&primary) {
            return Ok(vec![primary]);
        }
    }

    Ok(all)
}

// ── 2. 判定主屏幕 ────────────────────────────────────────────────────────────

fn pick_primary_screen(window: &WebviewWindow, screens: &[Monitor]) -> Result<Monitor, String> {
    if screens.is_empty() {
        return Err("no monitor".to_string());
    }

    if let Ok(Some(os_primary)) = window.primary_monitor() {
        if !is_likely_spanning_desktop(&os_primary) {
            // 直接用 OS 主屏几何, 不强制匹配枚举列表 (X11/Wayland 尺度可能不同)。
            log_screen_choice(screens.len(), &os_primary, "os-primary");
            return Ok(os_primary);
        }
        eprintln!("[ideall] primary_monitor 为跨屏虚拟桌面, 改用物理屏匹配");
        if let Some(m) = screen_largest_overlap(&os_primary, screens) {
            log_screen_choice(screens.len(), &m, "overlap");
            return Ok(m);
        }
    } else {
        eprintln!(
            "[ideall] primary_monitor 不可用 ({:?}), 改用最大物理屏",
            window.primary_monitor().err()
        );
    }

    if screens.len() == 1 {
        log_screen_choice(1, &screens[0], "only-screen");
        return Ok(screens[0].clone());
    }
    let chosen = largest_work_area_monitor(screens).unwrap_or_else(|| screens[0].clone());
    log_screen_choice(screens.len(), &chosen, "largest-fallback");
    Ok(chosen)
}

fn screen_largest_overlap(primary: &Monitor, screens: &[Monitor]) -> Option<Monitor> {
    let pr = primary.work_area();
    screens
        .iter()
        .max_by_key(|m| intersection_area(pr, m.work_area()))
        .filter(|m| intersection_area(pr, m.work_area()) > 0)
        .cloned()
}

fn intersection_area(a: &PhysicalRect<i32, u32>, b: &PhysicalRect<i32, u32>) -> u64 {
    let x1 = a.position.x.max(b.position.x);
    let y1 = a.position.y.max(b.position.y);
    let x2 = (a.position.x + a.size.width as i32).min(b.position.x + b.size.width as i32);
    let y2 = (a.position.y + a.size.height as i32).min(b.position.y + b.size.height as i32);
    let w = (x2 - x1).max(0) as u64;
    let h = (y2 - y1).max(0) as u64;
    w * h
}

fn log_all_screens(screens: &[Monitor]) {
    for (i, m) in screens.iter().enumerate() {
        let w = m.work_area();
        eprintln!(
            "[ideall] 屏 {i}: {}×{} @ ({}, {}), scale={}",
            w.size.width, w.size.height, w.position.x, w.position.y, m.scale_factor()
        );
    }
}

fn log_screen_choice(count: usize, m: &Monitor, reason: &str) {
    let w = m.work_area();
    eprintln!(
        "[ideall] 共 {count} 块屏 → 主屏 ({reason}): {}×{} @ ({}, {})",
        w.size.width, w.size.height, w.position.x, w.position.y
    );
}

fn log_placement_target(primary: &Monitor, size: PhysicalSize<u32>, pos: PhysicalPosition<i32>) {
    let w = primary.work_area();
    eprintln!(
        "[ideall] 目标位置: ({}, {}), 窗口 {}×{}, 主屏 {}×{} @ ({}, {})",
        pos.x, pos.y, size.width, size.height, w.size.width, w.size.height, w.position.x, w.position.y
    );
}

/// 窗口尚未布局完成时用配置尺寸 × scale 估算物理尺寸。
fn placement_size(window: &WebviewWindow, conf: &WindowConfig) -> Result<PhysicalSize<u32>, String> {
    let outer = window.outer_size().map_err(|e| e.to_string())?;
    if outer.width >= 200 && outer.height >= 200 {
        return Ok(outer);
    }
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    Ok(PhysicalSize::new(
        (conf.width * scale).round().max(200.0) as u32,
        (conf.height * scale).round().max(200.0) as u32,
    ))
}

// ── 3. 在主屏正中显示 ──────────────────────────────────────────────────────────

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

fn center_in_work_area(monitor: &Monitor, size: PhysicalSize<u32>) -> PhysicalPosition<i32> {
    let work = monitor.work_area();
    let x = work.position.x + (work.size.width as i32 - size.width as i32) / 2;
    let y = work.position.y + (work.size.height as i32 - size.height as i32) / 2;
    clamp_to_work_area(work, size, PhysicalPosition::new(x, y))
}

fn clamp_to_work_area(
    work: &PhysicalRect<i32, u32>,
    size: PhysicalSize<u32>,
    pos: PhysicalPosition<i32>,
) -> PhysicalPosition<i32> {
    let max_x = work.position.x + work.size.width as i32 - size.width as i32;
    let max_y = work.position.y + work.size.height as i32 - size.height as i32;
    PhysicalPosition::new(
        pos.x.clamp(work.position.x, max_x.max(work.position.x)),
        pos.y.clamp(work.position.y, max_y.max(work.position.y)),
    )
}

// ── 放置校验 ──────────────────────────────────────────────────────────────────

fn is_well_placed(
    window: &WebviewWindow,
    primary: &Monitor,
    screens: &[Monitor],
    _size: PhysicalSize<u32>,
) -> bool {
    let Ok(pos) = read_window_position(window) else {
        return false;
    };
    if !physical_position_valid(pos) {
        return false;
    };
    let Ok(actual_size) = window.outer_size() else {
        return false;
    };
    eprintln!(
        "[ideall] 实际位置: ({}, {}), 实际尺寸 {}×{}",
        pos.x, pos.y, actual_size.width, actual_size.height
    );
    if !window_rect_fits_in_work_area(pos, actual_size, primary) {
        return false;
    }
    if screens.len() > 1 && straddles_screens(pos, actual_size, screens) {
        return false;
    }
    if is_stuck_in_corner(pos, actual_size, primary) {
        return false;
    }
    // 完全落在主屏内即视为成功, 不再苛求像素级居中 (WSL/X11 WM 常有固定偏移)。
    true
}

fn needs_reposition(
    window: &WebviewWindow,
    primary: &Monitor,
    screens: &[Monitor],
) -> Result<bool, String> {
    let pos = read_window_position(window)?;
    if !physical_position_valid(pos) {
        return Ok(true);
    }
    let size = window.outer_size().map_err(|e| e.to_string())?;
    if is_stuck_in_corner(pos, size, primary) {
        return Ok(true);
    }
    if screens.len() > 1 && straddles_screens(pos, size, screens) {
        return Ok(true);
    }
    if !window_rect_fits_in_work_area(pos, size, primary) {
        return Ok(true);
    }
    Ok(false)
}

fn is_stuck_in_corner(
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor: &Monitor,
) -> bool {
    let work = monitor.work_area();
    let max_x = work.position.x + work.size.width as i32 - size.width as i32;
    let max_y = work.position.y + work.size.height as i32 - size.height as i32;
    pos.x >= max_x - CORNER_TOLERANCE_PX && pos.y >= max_y - CORNER_TOLERANCE_PX
}

fn is_likely_spanning_desktop(monitor: &Monitor) -> bool {
    monitor.work_area().size.width >= SPANNING_DESKTOP_MIN_WIDTH
}

fn window_rect_fits_in_work_area(
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor: &Monitor,
) -> bool {
    let work = monitor.work_area();
    pos.x >= work.position.x
        && pos.y >= work.position.y
        && pos.x + size.width as i32 <= work.position.x + work.size.width as i32
        && pos.y + size.height as i32 <= work.position.y + work.size.height as i32
}

fn rects_overlap(
    a: (i32, i32, u32, u32),
    b: (i32, i32, u32, u32),
) -> bool {
    let (ax, ay, aw, ah) = a;
    let (bx, by, bw, bh) = b;
    ax < bx + bw as i32
        && ax + aw as i32 > bx
        && ay < by + bh as i32
        && ay + ah as i32 > by
}

fn straddles_screens(
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    screens: &[Monitor],
) -> bool {
    let areas: Vec<PhysicalRect<i32, u32>> =
        screens.iter().map(|m| *m.work_area()).collect();
    straddles_work_areas(pos, size, &areas)
}

fn straddles_work_areas(
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    areas: &[PhysicalRect<i32, u32>],
) -> bool {
    areas
        .iter()
        .filter(|work| {
            rects_overlap(
                (pos.x, pos.y, size.width, size.height),
                (
                    work.position.x,
                    work.position.y,
                    work.size.width,
                    work.size.height,
                ),
            )
        })
        .count()
        > 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spanning_width_detected() {
        let work = PhysicalRect {
            position: PhysicalPosition::new(0, 0),
            size: PhysicalSize::new(5040, 1080),
        };
        assert!(work.size.width >= SPANNING_DESKTOP_MIN_WIDTH);
    }

    #[test]
    fn center_in_primary_work_area() {
        let primary = area(0, 1080, 2560, 1440);
        let size = PhysicalSize::new(1200, 800);
        let pos = center_in_work_area_from_rect(&primary, size);
        assert_eq!(pos.x, 680);
        assert_eq!(pos.y, 1400);
        assert!(pos.x + size.width as i32 <= primary.position.x + primary.size.width as i32);
    }

    #[test]
    fn straddles_two_of_three_screens() {
        let screens = [
            area(0, 0, 1080, 1920),
            area(1080, 0, 1920, 1080),
            area(0, 1080, 2560, 1440),
        ];
        // 虚拟桌面居中后横跨屏 2 与屏 3 的纵向缝 (y=1080)。
        let pos = PhysicalPosition::new(1200, 900);
        let size = PhysicalSize::new(1200, 800);
        assert!(straddles_work_areas(pos, size, &screens));
        let pos2 = PhysicalPosition::new(1100, 1400);
        assert!(!straddles_work_areas(pos2, size, &screens));
    }

    fn center_in_work_area_from_rect(
        work: &PhysicalRect<i32, u32>,
        size: PhysicalSize<u32>,
    ) -> PhysicalPosition<i32> {
        let x = work.position.x + (work.size.width as i32 - size.width as i32) / 2;
        let y = work.position.y + (work.size.height as i32 - size.height as i32) / 2;
        clamp_to_work_area(work, size, PhysicalPosition::new(x, y))
    }

    fn area(x: i32, y: i32, w: u32, h: u32) -> PhysicalRect<i32, u32> {
        PhysicalRect {
            position: PhysicalPosition::new(x, y),
            size: PhysicalSize::new(w, h),
        }
    }
}
