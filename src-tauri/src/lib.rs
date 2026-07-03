// 内嵌浏览器 (连接模式, 路线 A): 主窗口内嵌原生子 webview 显示外站, 工具条由可信本地前端渲染。
// Linux/WSL: Tauri add_child 默认 gtk::Box 堆叠 (子 webview 落窗口底部) → browser_linux.rs 用 gtk::Fixed 精确定位。
// 非 Linux: Window::add_child + 前端 getBoundingClientRect 同步 bounds。切走标签 hide; WSLg 内嵌浏览器或需 GDK_BACKEND=x11。
#[cfg(all(desktop, not(target_os = "linux")))]
use tauri::webview::{PageLoadEvent, WebviewBuilder};
#[cfg(desktop)]
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::Manager;
#[cfg(all(desktop, not(target_os = "linux")))]
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

// ACP (Agent Client Protocol) 外部智能体传输 —— 子进程 stdin/stdout 哑管道 (NDJSON 行框定), 仅桌面。
#[cfg(desktop)]
mod acp_transport;
#[cfg(desktop)]
mod oauth_callback;
#[cfg(all(desktop, target_os = "linux"))]
mod browser_linux;
#[cfg(desktop)]
mod window_placement;
#[cfg(desktop)]
mod installed_apps;

#[cfg(all(desktop, not(target_os = "linux")))]
const BROWSER_LABEL: &str = "browser_view";

// 主窗口内容区矩形 (CSS 像素, 相对窗口左上)。直接当 Logical 传, 勿乘 devicePixelRatio (Tauri 自动按 scale 换算)。
#[cfg(desktop)]
#[derive(serde::Deserialize, Clone, Copy, Debug, Default)]
pub(crate) struct Bounds {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// 内嵌浏览器当前页快照 (agent browser.getContent 用)。
#[cfg(desktop)]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserPageContent {
    url: String,
    title: String,
    text: String,
}

#[cfg(all(desktop, not(target_os = "linux")))]
const BROWSER_CONTENT_JS: &str = r#"
(function(){
  try {
    var t = (document.body && document.body.innerText) || '';
    return JSON.stringify({title: document.title || '', text: t.slice(0, 8000)});
  } catch(e) {
    return JSON.stringify({title: '', text: '', error: String(e)});
  }
})()
"#;

#[cfg(desktop)]
pub(crate) fn parse_browser_page_json(
    url: String,
    json_str: &str,
) -> Result<BrowserPageContent, String> {
    let v: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| format!("解析页面内容失败: {e}"))?;
    if let Some(err) = v.get("error").and_then(|x| x.as_str()) {
        if !err.is_empty() {
            return Err(format!("页面脚本错误: {err}"));
        }
    }
    Ok(BrowserPageContent {
        url,
        title: v["title"].as_str().unwrap_or("").to_string(),
        text: v["text"].as_str().unwrap_or("").to_string(),
    })
}

#[cfg(desktop)]
pub(crate) fn parse_http_url(url: &str) -> Result<tauri::Url, String> {
    let u: tauri::Url = url.parse().map_err(|e| format!("非法网址: {e}"))?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err("仅支持 http/https".into());
    }
    Ok(u)
}

// ── 内嵌浏览器 DOM 操控 (agent browser.click / fill / press) ────────────────────────

#[cfg(desktop)]
fn validate_css_selector(sel: &str) -> Result<String, String> {
    let s = sel.trim().to_string();
    if s.is_empty() || s.len() > 500 {
        return Err("invalid-selector".into());
    }
    if s.chars().any(|c| c == '\n' || c == '\r' || c == ';' || c == '\0') {
        return Err("invalid-selector".into());
    }
    Ok(s)
}

#[cfg(desktop)]
fn validate_fill_text(text: &str) -> Result<String, String> {
    if text.len() > 4000 {
        return Err("text-too-long".into());
    }
    Ok(text.to_string())
}

#[cfg(desktop)]
fn validate_press_key(key: &str) -> Result<String, String> {
    const ALLOWED: &[&str] = &[
        "Enter", "Tab", "Escape", "Backspace", "Delete", "Space",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End",
    ];
    let k = key.trim();
    if ALLOWED.contains(&k) {
        return Ok(k.to_string());
    }
    if k.len() == 1 {
        return Ok(k.to_string());
    }
    Err("invalid-key".into())
}

#[cfg(desktop)]
fn parse_browser_act_json(v: serde_json::Value) -> Result<(), String> {
    if v.get("ok").and_then(|x| x.as_bool()) == Some(true) {
        return Ok(());
    }
    Err(v
        .get("error")
        .and_then(|x| x.as_str())
        .unwrap_or("act-failed")
        .to_string())
}

#[cfg(desktop)]
fn js_browser_click(selector: &str) -> Result<String, String> {
    let sel_json = serde_json::to_string(&validate_css_selector(selector)?)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "(function(){{try{{var el=document.querySelector({sel_json});if(!el)return JSON.stringify({{ok:false,error:'not-found'}});el.click();return JSON.stringify({{ok:true}});}}catch(e){{return JSON.stringify({{ok:false,error:String(e)}});}}}})()"
    ))
}

#[cfg(desktop)]
fn js_browser_fill(selector: &str, text: &str) -> Result<String, String> {
    let sel_json = serde_json::to_string(&validate_css_selector(selector)?)
        .map_err(|e| e.to_string())?;
    let val_json = serde_json::to_string(&validate_fill_text(text)?).map_err(|e| e.to_string())?;
    Ok(format!(
        "(function(){{try{{var el=document.querySelector({sel_json});if(!el)return JSON.stringify({{ok:false,error:'not-found'}});el.focus();if('value' in el)el.value={val_json};else el.textContent={val_json};el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));return JSON.stringify({{ok:true}});}}catch(e){{return JSON.stringify({{ok:false,error:String(e)}});}}}})()"
    ))
}

#[cfg(desktop)]
fn js_browser_press(key: &str) -> Result<String, String> {
    let key_json = serde_json::to_string(&validate_press_key(key)?).map_err(|e| e.to_string())?;
    Ok(format!(
        "(function(){{try{{var t=document.activeElement||document.body;t.dispatchEvent(new KeyboardEvent('keydown',{{key:{key_json},bubbles:true}}));t.dispatchEvent(new KeyboardEvent('keyup',{{key:{key_json},bubbles:true}}));return JSON.stringify({{ok:true}});}}catch(e){{return JSON.stringify({{ok:false,error:String(e)}});}}}})()"
    ))
}

#[cfg(desktop)]
fn browser_run_js(app: AppHandle, js: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        return browser_linux::eval_json(&js).and_then(parse_browser_act_json);
    }

    #[cfg(not(target_os = "linux"))]
    {
        use std::sync::mpsc;
        use std::time::Duration;

        let wv = app
            .get_webview(BROWSER_LABEL)
            .ok_or_else(|| "浏览器视图不存在".to_string())?;
        let (tx, rx) = mpsc::sync_channel(1);
        wv.with_webview(move |platform| {
            let _ = platform.evaluate_script_with_callback(&js, move |result| {
                let _ = tx.send(result);
            });
        })
        .map_err(|e| e.to_string())?;
        let json_str = rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "执行超时".to_string())?;
        let v: serde_json::Value =
            serde_json::from_str(&json_str).map_err(|e| format!("解析脚本结果失败: {e}"))?;
        parse_browser_act_json(v)
    }
}

/// 打开 (或重建) 内嵌浏览器子 webview, 加载 url, 定位到主窗口内容区 bounds。
#[cfg(desktop)]
#[tauri::command]
fn open_browser_view(
    app: AppHandle,
    url: String,
    b: Bounds,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return browser_linux::open(&app, url, b);

    #[cfg(not(target_os = "linux"))]
    {
    let target = if url.trim().is_empty() {
        "https://www.google.com".to_string()
    } else {
        url
    };
    let parsed = parse_http_url(&target)?;
    let main = app.get_webview_window("main").ok_or("主窗口不存在")?;
    let window = main.as_ref().window();
    // 单例: 已存在则先关。
    if let Some(w) = app.get_webview(BROWSER_LABEL) {
        let _ = w.close();
    }
    let app_nav = app.clone();
    let app_load = app.clone();
    let builder = WebviewBuilder::new(BROWSER_LABEL, WebviewUrl::External(parsed))
        .on_navigation(move |target| {
            let _ = app_nav.emit("browser://url", target.to_string());
            true
        })
        .on_page_load(move |_webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = app_load.emit("browser://url", payload.url().to_string());
            }
        });
    window
        .add_child(
            builder,
            LogicalPosition::new(b.x, b.y),
            LogicalSize::new(b.w, b.h),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
    }
}

/// 同步子 webview 矩形 (内容区随窗口缩放/侧栏折叠变化时调用)。
#[cfg(desktop)]
#[tauri::command]
fn browser_set_bounds(
    _app: AppHandle,
    b: Bounds,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return browser_linux::set_bounds(b);

    #[cfg(not(target_os = "linux"))]
    {
    let wv = _app.get_webview(BROWSER_LABEL).ok_or("浏览器视图不存在")?;
    wv.set_position(LogicalPosition::new(b.x, b.y))
        .map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(b.w, b.h))
        .map_err(|e| e.to_string())?;
    Ok(())
    }
}

/// 地址栏导航到新 url。
#[cfg(desktop)]
#[tauri::command]
fn browser_navigate(
    _app: AppHandle,
    url: String,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return browser_linux::navigate(&url);

    #[cfg(not(target_os = "linux"))]
    {
    let parsed = parse_http_url(&url)?;
    _app.get_webview(BROWSER_LABEL)
        .ok_or("浏览器视图不存在")?
        .navigate(parsed)
        .map_err(|e| e.to_string())
    }
}

#[cfg(desktop)]
#[tauri::command]
fn browser_back(_app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return browser_linux::back();

    #[cfg(not(target_os = "linux"))]
    {
        _app.get_webview(BROWSER_LABEL)
            .ok_or("浏览器视图不存在")?
            .eval("history.back()")
            .map_err(|e| e.to_string())
    }
}
#[cfg(desktop)]
#[tauri::command]
fn browser_forward(_app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return browser_linux::forward();

    #[cfg(not(target_os = "linux"))]
    {
        _app.get_webview(BROWSER_LABEL)
            .ok_or("浏览器视图不存在")?
            .eval("history.forward()")
            .map_err(|e| e.to_string())
    }
}
#[cfg(desktop)]
#[tauri::command]
fn browser_reload(_app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return browser_linux::reload();

    #[cfg(not(target_os = "linux"))]
    {
        _app.get_webview(BROWSER_LABEL)
            .ok_or("浏览器视图不存在")?
            .eval("location.reload()")
            .map_err(|e| e.to_string())
    }
}

// 隐藏/显示/关闭子 webview (标签切走 hide, 切回 show, 关标签 close)。
#[cfg(desktop)]
#[tauri::command]
fn browser_hide(_app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return browser_linux::hide();

    #[cfg(not(target_os = "linux"))]
    {
        _app.get_webview(BROWSER_LABEL)
            .ok_or("浏览器视图不存在")?
            .hide()
            .map_err(|e| e.to_string())
    }
}
#[cfg(desktop)]
#[tauri::command]
fn browser_show(_app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return browser_linux::show();

    #[cfg(not(target_os = "linux"))]
    {
        _app.get_webview(BROWSER_LABEL)
            .ok_or("浏览器视图不存在")?
            .show()
            .map_err(|e| e.to_string())
    }
}
/// 读取内嵌浏览器当前页 (URL + 标题 + 正文); 仅桌面、浏览器标签已打开时可用。
#[cfg(desktop)]
#[tauri::command]
fn browser_get_content(app: AppHandle) -> Result<BrowserPageContent, String> {
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        return browser_linux::get_content();
    }

    #[cfg(not(target_os = "linux"))]
    {
        use std::sync::mpsc;
        use std::time::Duration;

        let wv = app
            .get_webview(BROWSER_LABEL)
            .ok_or_else(|| "浏览器视图不存在".to_string())?;
        let url = wv.url().map_err(|e| e.to_string())?.to_string();
        let (tx, rx) = mpsc::sync_channel(1);
        wv.with_webview(move |platform| {
            let _ = platform.evaluate_script_with_callback(BROWSER_CONTENT_JS, move |result| {
                let _ = tx.send(result);
            });
        })
        .map_err(|e| e.to_string())?;
        let json_str = rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "读取页面超时".to_string())?;
        parse_browser_page_json(url, &json_str)
    }
}

/// 点击内嵌浏览器页面元素 (CSS 选择器)。
#[cfg(desktop)]
#[tauri::command]
fn browser_click(app: AppHandle, selector: String) -> Result<(), String> {
    browser_run_js(app, js_browser_click(&selector)?)
}

/// 向内嵌浏览器输入框/文本区填写内容 (CSS 选择器 + 文本)。
#[cfg(desktop)]
#[tauri::command]
fn browser_fill(app: AppHandle, selector: String, text: String) -> Result<(), String> {
    browser_run_js(app, js_browser_fill(&selector, &text)?)
}

/// 向内嵌浏览器当前焦点元素发送按键 (Enter / Tab / 单字符等)。
#[cfg(desktop)]
#[tauri::command]
fn browser_press(app: AppHandle, key: String) -> Result<(), String> {
    browser_run_js(app, js_browser_press(&key)?)
}

#[cfg(desktop)]
#[tauri::command]
fn browser_close(_app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return browser_linux::close();

    #[cfg(not(target_os = "linux"))]
    {
        if let Some(w) = _app.get_webview(BROWSER_LABEL) {
            w.close().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

// ── agent 出站联网守卫 (web.search / web.fetch 的 Rust 侧 SSRF 闭合) ────────────────────────────────
// JS 侧 (src/lib/web-search.ts) 只能拦 IP 字面量与已知坏名; 「公网域名 A 记录指向私网/环回/元数据」必须在
// **连接前**解析+校验+钉连。本命令: 自行解析主机→IP, 任一 IP 落非全局段即拒 (fail closed), 再用 resolve_to_addrs
// 把连接钉死到已校验 IP (reqwest 不再二次解析 → 关闭名解析 SSRF 与 DNS-rebind/TOCTOU)。不跟随重定向 (JS 逐跳
// 复检, 每跳重走本命令即重解析+钉连)。桌面与移动端通用 (agent 联网在两端都该可用)。
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

/// IPv4 是否落在非全局可路由段 (环回/私网/link-local/CGNAT/广播/组播/文档/0 段/协议保留)。
fn is_blocked_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || o[0] == 0
        || (o[0] == 100 && (64..=127).contains(&o[1])) // CGNAT 100.64/10
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24 协议保留
}

/// IPv6 是否为 环回/未指定/组播/link-local/ULA, 或内嵌 (mapped/compat) 回坏 IPv4。
fn is_blocked_v6(ip: Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
        return true;
    }
    let seg = ip.segments();
    if (seg[0] & 0xffc0) == 0xfe80 {
        return true; // fe80::/10 link-local
    }
    if (seg[0] & 0xfe00) == 0xfc00 {
        return true; // fc00::/7 ULA
    }
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_blocked_v4(v4); // ::ffff:a.b.c.d
    }
    if seg[..6].iter().all(|&s| s == 0) {
        // IPv4-compatible ::a.b.c.d (已废弃但仍可解析) —— 低 32 位当 v4。
        let v4 = Ipv4Addr::new(
            (seg[6] >> 8) as u8,
            (seg[6] & 0xff) as u8,
            (seg[7] >> 8) as u8,
            (seg[7] & 0xff) as u8,
        );
        return is_blocked_v4(v4);
    }
    false
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_blocked_v4(v4),
        IpAddr::V6(v6) => is_blocked_v6(v6),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentFetchArgs {
    url: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    headers: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    max_bytes: Option<usize>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentFetchResult {
    status: u16,
    final_url: String,
    content_type: Option<String>,
    location: Option<String>,
    body: String,
}

/// agent 出站取数 (单跳, 不跟随重定向)。Err(reason) 与 JS WebError.reason 同名 (blocked-host/timeout/...)。
#[tauri::command]
async fn agent_guarded_fetch(args: AgentFetchArgs) -> Result<AgentFetchResult, String> {
    let parsed = tauri::Url::parse(&args.url).map_err(|_| "invalid-url".to_string())?;
    if parsed.scheme() != "https" {
        return Err("blocked-protocol".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("blocked-host".into());
    }
    let port = parsed.port_or_known_default().unwrap_or(443);
    if port != 443 {
        return Err("blocked-port".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "invalid-url".to_string())?
        .to_string();
    let host_clean = host.trim_start_matches('[').trim_end_matches(']').to_string();

    // 解析 + 全局性校验 (fail closed: 任一解析 IP 落非全局段即拒, 杜绝多 A 记录混入私网)。
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host_clean.as_str(), port))
        .await
        .map_err(|_| "dns-failed".to_string())?
        .collect();
    if addrs.is_empty() {
        return Err("dns-failed".into());
    }
    if addrs.iter().any(|a| is_blocked_ip(a.ip())) {
        return Err("blocked-host".into());
    }

    let timeout = std::time::Duration::from_millis(args.timeout_ms.unwrap_or(10_000));
    let max_bytes = args.max_bytes.unwrap_or(2 * 1024 * 1024);

    // 钉连到已校验 IP (resolve_to_addrs) → reqwest 不再二次解析 (关闭 rebind); 不跟随重定向 (JS 逐跳复检)。
    let client = reqwest::Client::builder()
        .resolve_to_addrs(&host_clean, &addrs)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(timeout)
        .timeout(timeout)
        .build()
        .map_err(|e| format!("client-build-failed: {e}"))?;

    let method = reqwest::Method::from_bytes(args.method.as_deref().unwrap_or("GET").as_bytes())
        .map_err(|_| "bad-method".to_string())?;
    let mut req = client.request(method, parsed.as_str());
    if let Some(hs) = &args.headers {
        for (k, v) in hs {
            req = req.header(k, v);
        }
    }
    if let Some(b) = args.body {
        req = req.body(b);
    }

    let mut resp = req
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "timeout" } else { "fetch-failed" }.to_string())?;

    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let location = resp
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if let Some(len) = resp.content_length() {
        if len as usize > max_bytes {
            return Err("content-too-large".into());
        }
    }

    // 流式读 + 字节上限 (reqwest 已解压 → 计的是解压后字节, 也挡解压炸弹)。整体 timeout 覆盖 body 读。
    let mut buf: Vec<u8> = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if buf.len() + chunk.len() > max_bytes {
                    return Err("content-too-large".into());
                }
                buf.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => {
                return Err(if e.is_timeout() { "timeout" } else { "fetch-failed" }.to_string());
            }
        }
    }

    Ok(AgentFetchResult {
        status,
        final_url,
        content_type,
        location,
        body: String::from_utf8_lossy(&buf).to_string(),
    })
}

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
        // 注: 内嵌浏览器子 webview (Window::add_child) 仅支持 X11 (Wayland 下不显示)。但在 WSLg 下
        // 强制 GDK_BACKEND=x11 会使 XWayland 不渲染鼠标光标 (整窗看不到鼠标) —— 二者不可兼得, 故此处
        // 不默认强制 x11 (优先保 app 可用)。需在 WSLg 调内嵌浏览器时, 手动 `GDK_BACKEND=x11 pnpm app:dev`
        // 临时开启 (接受光标副作用)。目标平台 Windows(WebView2) 无 Wayland/XWayland, 无此矛盾。
    }

    let context = tauri::generate_context!();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // HTTP: App 内 fetch 经 Rust 侧发出, 绕过 webview CORS (agent 直连任意 LLM 端点)。
        .plugin(tauri_plugin_http::init())
        // Shell: 本地终端执行系统命令 (仅桌面; 权限由 capability 限定)。
        .plugin(tauri_plugin_shell::init());

    // 多显示器: 未在 tauri.conf 指定 x/y 时, 等窗口尺寸就绪后居中到主屏 (见 window_placement.rs)。
    #[cfg(desktop)]
    let builder = builder.setup(|app| {
        let conf = app
            .config()
            .app
            .windows
            .iter()
            .find(|w| w.label == "main")
            .or_else(|| app.config().app.windows.first())
            .cloned();
        if conf.as_ref().is_some_and(|w| w.x.is_none() && w.y.is_none()) {
            if let Some(window) = app.get_webview_window("main") {
                window_placement::schedule_initial_placement(&window, conf.unwrap());
            }
        }
        Ok(())
    });

    // agent 出站守卫命令两端通用; 内嵌浏览器命令仅桌面 (Window::add_child = desktop + unstable feature)。
    // invoke_handler 只能设一次, 故按平台分别注册全集 / 仅 agent_guarded_fetch。
    #[cfg(desktop)]
    let builder = builder
        .manage(acp_transport::init_state())
        .manage(acp_transport::init_server_state())
        .manage(oauth_callback::init_oauth_state())
        .invoke_handler(tauri::generate_handler![
            agent_guarded_fetch,
            open_browser_view,
            browser_set_bounds,
            browser_navigate,
            browser_back,
            browser_forward,
            browser_reload,
            browser_hide,
            browser_show,
            browser_close,
            browser_get_content,
            browser_click,
            browser_fill,
            browser_press,
            acp_transport::acp_spawn,
            acp_transport::acp_send,
            acp_transport::acp_close,
            acp_transport::acp_listen_start,
            acp_transport::acp_listen_stop,
            acp_transport::acp_server_send,
            acp_transport::acp_server_close,
            acp_transport::acp_which,
            acp_transport::acp_script_path,
            acp_transport::acp_run_once,
            oauth_callback::oauth_callback_start,
            oauth_callback::oauth_callback_stop,
            installed_apps::list_installed_apps,
            installed_apps::launch_installed_app,
            installed_apps::read_app_icon_data_url
        ]);
    #[cfg(not(desktop))]
    let builder = builder.invoke_handler(tauri::generate_handler![agent_guarded_fetch]);

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

// agent 出站守卫的 IP 全局性判定单测 (离线, 无网络)。镜像 JS 侧 web-search.ts 的拦截集 —— 两侧任一漂移即此处/JS 测失败。
#[cfg(test)]
mod tests {
    use super::*;

    fn blocked(s: &str) -> bool {
        is_blocked_ip(s.parse::<IpAddr>().expect("ip"))
    }

    #[test]
    fn blocks_loopback_private_linklocal_metadata_cgnat() {
        for s in [
            "127.0.0.1",
            "127.1.2.3",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254", // 云元数据
            "169.254.0.1",
            "0.0.0.0",
            "100.64.0.1",   // CGNAT
            "255.255.255.255",
            "::1",
            "::",
            "fe80::1",          // link-local
            "fc00::1",          // ULA
            "fd12:3456::1",     // ULA
            "::ffff:127.0.0.1", // IPv4-mapped → 环回
            "::ffff:169.254.169.254",
            "::ffff:10.0.0.1",
            "::127.0.0.1", // IPv4-compatible
        ] {
            assert!(blocked(s), "应拦 {s}");
        }
    }

    #[test]
    fn allows_public() {
        for s in ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1::1"] {
            assert!(!blocked(s), "应放行公网 {s}");
        }
    }

    #[test]
    fn blocks_172_only_in_private_band() {
        assert!(!blocked("172.15.0.1"), "172.15 不在私网段");
        assert!(blocked("172.16.0.1"));
        assert!(blocked("172.31.0.1"));
        assert!(!blocked("172.32.0.1"), "172.32 不在私网段");
    }
}
