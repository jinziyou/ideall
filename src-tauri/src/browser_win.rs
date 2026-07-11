// Windows: 子 WebView2 HWND 常盖住顶栏/工具条/右侧壳层 (CSS z-index 无效)。
// SetWindowRgn 对 WebView2 内部 HWND 往往无效 → WM_NCHITTEST 返回 HTTRANSPARENT 让
// 「内容矩形外」的点击穿透到主 webview (与 Linux input_shape 同思路)。
#[cfg(windows)]
use std::sync::Mutex;

#[cfg(windows)]
pub const TOP_CHROME_LOGICAL: f64 = 44.0;

#[cfg(windows)]
const HIT_SUBCLASS_ID: usize = 0x1DEA_1001;

#[cfg(windows)]
#[derive(Clone, Copy, Debug)]
pub struct PhysicalBounds {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[cfg(windows)]
impl PhysicalBounds {
    pub fn from_logical(x: f64, y: f64, w: f64, h: f64, scale: f64) -> Self {
        Self {
            x: (x * scale).round() as i32,
            y: (y * scale).round() as i32,
            w: (w * scale).round() as i32,
            h: (h * scale).round() as i32,
        }
    }

    pub fn contains_screen_point(self, px: i32, py: i32) -> bool {
        px >= self.x && py >= self.y && px < self.x + self.w && py < self.y + self.h
    }
}

/// 当前允许接收鼠标的屏幕矩形 (仅内容区); subclass 回调读此值。
#[cfg(windows)]
static HIT_PASS_RECT: Mutex<Option<PhysicalBounds>> = Mutex::new(None);

#[cfg(windows)]
struct EnumInstallArgs {
    out: Vec<isize>,
}

#[cfg(windows)]
unsafe extern "system" fn hit_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _uidsubclass: usize,
    _dwrefdata: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{HTTRANSPARENT, WM_NCDESTROY, WM_NCHITTEST};

    if msg == WM_NCHITTEST {
        // GET_X/Y_LPARAM: 低/高 16 位有符号扩展 (多显示器负坐标)。
        let px = (lparam.0 & 0xffff) as i16 as i32;
        let py = ((lparam.0 >> 16) & 0xffff) as i16 as i32;
        let inside = HIT_PASS_RECT
            .lock()
            .ok()
            .and_then(|g| *g)
            .map(|r| r.contains_screen_point(px, py))
            .unwrap_or(false);
        if !inside {
            return LRESULT(HTTRANSPARENT as _);
        }
    }

    if msg == WM_NCDESTROY {
        let _ = RemoveWindowSubclass(hwnd, Some(hit_subclass_proc), HIT_SUBCLASS_ID);
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}

#[cfg(windows)]
fn install_hit_pass_hwnd(hwnd_raw: isize, out: &mut Vec<isize>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::SetWindowSubclass;
    use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

    if hwnd_raw == 0 {
        return;
    }
    let hwnd = HWND(hwnd_raw as _);
    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(hit_subclass_proc), HIT_SUBCLASS_ID, 0);
    }
    out.push(hwnd_raw);

    let mut args = EnumInstallArgs { out: Vec::new() };
    unsafe {
        let _ = EnumChildWindows(
            Some(hwnd),
            Some(enum_install_child),
            windows::Win32::Foundation::LPARAM(&mut args as *mut _ as isize),
        );
    }
    out.append(&mut args.out);
}

#[cfg(windows)]
unsafe extern "system" fn enum_install_child(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::core::BOOL {
    use windows::Win32::Foundation::TRUE;
    let args = &mut *(lparam.0 as *mut EnumInstallArgs);
    install_hit_pass_hwnd(hwnd.0 as isize, &mut args.out);
    TRUE
}

#[cfg(windows)]
pub fn client_origin_screen(hwnd_raw: isize) -> Option<(i32, i32)> {
    use windows::Win32::Foundation::{HWND, POINT};
    use windows::Win32::Graphics::Gdi::ClientToScreen;

    if hwnd_raw == 0 {
        return None;
    }
    let mut pt = POINT { x: 0, y: 0 };
    unsafe {
        let _ = ClientToScreen(HWND(hwnd_raw as _), &mut pt);
    }
    Some((pt.x, pt.y))
}

/// 安装命中穿透: 仅 `hit_rect` (屏幕坐标) 内接收鼠标, 其余穿透到主 webview。
#[cfg(windows)]
pub fn install_hit_pass_tree(hwnd_raw: isize, hit_rect: PhysicalBounds) -> Vec<isize> {
    if let Ok(mut g) = HIT_PASS_RECT.lock() {
        *g = Some(hit_rect);
    }
    let mut out = Vec::new();
    install_hit_pass_hwnd(hwnd_raw, &mut out);
    out
}

#[cfg(windows)]
pub fn remove_hit_pass_tree(hwnds: &[isize]) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::RemoveWindowSubclass;

    if let Ok(mut g) = HIT_PASS_RECT.lock() {
        *g = None;
    }
    for &raw in hwnds {
        if raw == 0 {
            continue;
        }
        unsafe {
            let _ = RemoveWindowSubclass(HWND(raw as _), Some(hit_subclass_proc), HIT_SUBCLASS_ID);
        }
    }
}

#[cfg(windows)]
pub fn force_hwnd_bounds(hwnd_raw: isize, pb: PhysicalBounds) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};

    if hwnd_raw == 0 {
        return Err("hwnd is null".into());
    }
    let hwnd = HWND(hwnd_raw as _);
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            pb.x,
            pb.y,
            pb.w,
            pb.h,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .map_err(|e| format!("SetWindowPos: {e}"))?;
    }
    Ok(())
}

#[cfg(windows)]
pub fn hwnd_screen_rect(hwnd_raw: isize) -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    if hwnd_raw == 0 {
        return None;
    }
    let mut wr = RECT::default();
    unsafe {
        GetWindowRect(HWND(hwnd_raw as _), &mut wr).ok()?;
    }
    Some((wr.left, wr.top, wr.right, wr.bottom))
}

#[cfg(windows)]
pub fn raise_hwnd(hwnd_raw: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    if hwnd_raw == 0 {
        return;
    }
    unsafe {
        let _ = SetWindowPos(
            HWND(hwnd_raw as _),
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}
