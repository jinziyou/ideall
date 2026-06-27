// 内嵌浏览器「收藏」浮钮 —— 几何、拖拽位置状态与 (非 Linux) data: 子 webview 页。
// 原生子 webview 在 HTML 之上; 浮钮用原生层, 支持拖拽 (Linux gtk / 其它平台 fab 子 webview)。

use std::cell::RefCell;

use crate::Bounds;

pub const FAB_W: f64 = 88.0;
pub const FAB_H: f64 = 44.0;
pub const FAB_MARGIN: f64 = 16.0;

#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct FabMoved {
    pub x: f64,
    pub y: f64,
}

thread_local! {
    static STATE: RefCell<FabState> = RefCell::new(FabState::default());
}

#[derive(Default)]
struct FabState {
    content: Bounds,
    custom: Option<(f64, f64)>,
}

pub fn sync_content(content: &Bounds) {
    STATE.with(|s| {
        let mut st = s.borrow_mut();
        st.content = *content;
        if let (Some(fx), Some(fy)) = (content.fab_x, content.fab_y) {
            st.custom = Some((fx, fy));
        }
    });
}

pub fn custom_pos() -> Option<(f64, f64)> {
    STATE.with(|s| s.borrow().custom)
}

pub fn set_custom_pos(x: f64, y: f64) -> FabMoved {
    let fb = STATE.with(|s| {
        let mut st = s.borrow_mut();
        let fb = clamp_to_content(&st.content, x, y);
        st.custom = Some((fb.x, fb.y));
        fb
    });
    FabMoved { x: fb.x, y: fb.y }
}

pub fn apply_delta(dx: f64, dy: f64) -> Option<FabMoved> {
    STATE.with(|s| {
        let mut st = s.borrow_mut();
        let cur = resolve(&st.content, st.custom);
        let fb = clamp_to_content(&st.content, cur.x + dx, cur.y + dy);
        st.custom = Some((fb.x, fb.y));
        Some(FabMoved { x: fb.x, y: fb.y })
    })
}

fn default_pos(content: &Bounds) -> (f64, f64) {
    (
        content.x + (content.w - FAB_W - FAB_MARGIN).max(0.0),
        content.y + (content.h - FAB_H - FAB_MARGIN).max(0.0),
    )
}

pub fn clamp_to_content(content: &Bounds, x: f64, y: f64) -> Bounds {
    let min_x = content.x;
    let min_y = content.y;
    let max_x = (content.x + content.w - FAB_W).max(min_x);
    let max_y = (content.y + content.h - FAB_H).max(min_y);
    Bounds {
        x: x.clamp(min_x, max_x),
        y: y.clamp(min_y, max_y),
        w: FAB_W,
        h: FAB_H,
        fab_x: None,
        fab_y: None,
    }
}

fn resolve(content: &Bounds, custom: Option<(f64, f64)>) -> Bounds {
    let (x, y) = custom
        .or_else(|| {
            content
                .fab_x
                .zip(content.fab_y)
                .map(|(x, y)| (x, y))
        })
        .unwrap_or_else(|| default_pos(content));
    clamp_to_content(content, x, y)
}

/** 由内容区 + 持久化/拖拽位置算收藏钮窗口坐标。 */
pub fn bounds(content: &Bounds) -> Bounds {
    STATE.with(|s| {
        let st = s.borrow();
        resolve(content, st.custom)
    })
}

#[cfg(all(desktop, not(target_os = "linux")))]
pub fn data_url() -> Result<tauri::Url, String> {
    let html = concat!(
        "<html><head><meta charset=utf-8><style>",
        "html,body{margin:0;height:100%;background:transparent;overflow:hidden;user-select:none}",
        "button{cursor:grab;display:flex;align-items:center;gap:6px;height:44px;width:100%;",
        "padding:0 16px;border-radius:999px;border:1px solid rgba(0,0,0,.12);",
        "background:rgba(255,255,255,.95);font:500 14px system-ui,sans-serif;",
        "box-shadow:0 4px 14px rgba(0,0,0,.12);color:#111;touch-action:none}",
        "button:active{cursor:grabbing}",
        "</style></head><body>",
        "<button type=button id=fab>&#9733; 收藏</button>",
        "<script>",
        "const b=document.getElementById('fab');let drag=false;",
        "function go(u){location.replace(u)}",
        "b.addEventListener('mousedown',e=>{",
        "drag=false;e.preventDefault();",
        "const mv=(ev)=>{",
        "if(Math.abs(ev.movementX)+Math.abs(ev.movementY)>0){drag=true;",
        "go('ideall://browser/fab-delta?dx='+ev.movementX+'&dy='+ev.movementY)}",
        "};",
        "const up=()=>{window.removeEventListener('mousemove',mv);",
        "if(drag)go('ideall://browser/fab-commit');else go('ideall://browser/favorite');};",
        "window.addEventListener('mousemove',mv);window.addEventListener('mouseup',up,{once:true});",
        "});",
        "</script></body></html>"
    );
    let mut enc = String::from("data:text/html;charset=utf-8,");
    for byte in html.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                enc.push(byte as char);
            }
            _ => enc.push_str(&format!("%{byte:02X}")),
        }
    }
    enc.parse().map_err(|e| format!("fab data url: {e}"))
}

#[cfg(all(desktop, not(target_os = "linux")))]
pub fn is_favorite_nav(url: &str) -> bool {
    url.starts_with("ideall://browser/favorite")
}

#[cfg(all(desktop, not(target_os = "linux")))]
pub fn is_fab_commit(url: &str) -> bool {
    url.starts_with("ideall://browser/fab-commit")
}

#[cfg(all(desktop, not(target_os = "linux")))]
pub fn parse_fab_delta(url: &str) -> Option<(f64, f64)> {
    if !url.starts_with("ideall://browser/fab-delta") {
        return None;
    }
    let q = url.split('?').nth(1)?;
    let mut dx = 0.0;
    let mut dy = 0.0;
    for part in q.split('&') {
        if let Some(v) = part.strip_prefix("dx=") {
            dx = v.parse().ok()?;
        } else if let Some(v) = part.strip_prefix("dy=") {
            dy = v.parse().ok()?;
        }
    }
    Some((dx, dy))
}
