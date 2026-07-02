// OAuth 桌面 loopback 回调 server —— 起 127.0.0.1:7843 一次性 HTTP 监听, 接 GET /callback?code=&state=
// → emit 给主窗口 "oauth://callback" (免手动粘贴) → 回一页 HTML 并自停; 5 分钟超时自停。
// 仅环回 (绝不绑 0.0.0.0); 仅桌面 (#[cfg(desktop)]); redirect_uri / 授权 URL 由前端 OAuth 流程控制 (非模型可控)。
// 安全/健壮: emit 只发主窗口 (code 是 bearer 等价机密, 不广播到 browser-view 外站 webview);
//   读到完整请求行才解析、仅在带 code 时才停 (防本地进程提前 break 致真回调撞闭端口);
//   每连接 5s 读超时 (防本地进程拖死 accept); AppState 持任务句柄, 重新授权先 abort 旧监听 (不撞端口)。

use std::time::Duration;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, EventTarget, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Clone, serde::Serialize)]
struct OAuthCallbackEvent {
    code: Option<String>,
    state: Option<String>,
}

#[derive(Default)]
pub(crate) struct OAuthState {
    task: std::sync::Mutex<Option<JoinHandle<()>>>,
}

pub(crate) fn init_oauth_state() -> OAuthState {
    OAuthState::default()
}

/// 起一次性 OAuth 回调监听 (127.0.0.1:port); 收到带 code 的 /callback 即 emit 主窗口并自停。返回实际端口。
#[tauri::command]
pub(crate) async fn oauth_callback_start(
    app: AppHandle,
    state: State<'_, OAuthState>,
    port: Option<u16>,
) -> Result<u16, String> {
    // 替换上次未结束的监听 (放弃后重新授权不撞端口)。
    if let Some(h) = state.task.lock().unwrap().take() {
        h.abort();
    }

    // 仅环回: 绝不绑 0.0.0.0, 避免把回调端口暴露到局域网。
    let listener = TcpListener::bind(("127.0.0.1", port.unwrap_or(0)))
        .await
        .map_err(|e| format!("bind-failed: {e}"))?;
    let bound = listener.local_addr().map_err(|e| e.to_string())?.port();

    let handle = tauri::async_runtime::spawn(async move {
        // 5 分钟整体超时自停 (用户取消授权时不泄漏监听 / 任务)。
        let _ = tokio::time::timeout(Duration::from_secs(300), async {
            loop {
                let (mut stream, _) = match listener.accept().await {
                    Ok(v) => v,
                    Err(_) => break,
                };
                // 带 code 的 /callback 才算成功 → emit 主窗口并停; 其它 (含无 code 的 error=) 继续等真回调。
                if let Some((code, state)) = handle_callback_conn(&mut stream).await {
                    let _ = app.emit_to(
                        EventTarget::webview_window("main"),
                        "oauth://callback",
                        OAuthCallbackEvent { code, state },
                    );
                    break;
                }
            }
        })
        .await;
    });

    *state.task.lock().unwrap() = Some(handle);
    Ok(bound)
}

/// 停止当前 OAuth 回调监听 (用户取消授权时立即释放端口)。
#[tauri::command]
pub(crate) fn oauth_callback_stop(state: State<'_, OAuthState>) {
    if let Some(h) = state.task.lock().unwrap().take() {
        h.abort();
    }
}

/// 处理一个回调连接: 读首行 → 若是带 code 的 /callback 回 200 并返回 (code,state); 否则回 200/404 返回 None (继续等)。
/// 抽出独立于 AppHandle 的纯 IO 逻辑, 便于用真 socket 集成测 (不需浏览器 / 真 OAuth server)。
async fn handle_callback_conn<S: AsyncReadExt + AsyncWriteExt + Unpin>(
    stream: &mut S,
) -> Option<(Option<String>, Option<String>)> {
    // 每连接 5s 读超时 (本地进程拖慢不会卡死后续真回调)。
    let line = match tokio::time::timeout(Duration::from_secs(5), read_request_line(stream)).await {
        Ok(Ok(l)) => l,
        _ => {
            let _ = write_404(stream).await;
            return None;
        }
    };
    let target = line.split_whitespace().nth(1).unwrap_or("");
    if target.starts_with("/callback") {
        let query = target.split_once('?').map(|x| x.1).unwrap_or("");
        let code = query_param(query, "code");
        let state = query_param(query, "state");
        let _ = write_ok(stream).await;
        // 仅带 code 才视为成功; 无 code (如 error=) 回页后返回 None 继续等真回调。
        return if code.is_some() {
            Some((code, state))
        } else {
            None
        };
    }
    let _ = write_404(stream).await;
    None
}

/// 读到第一条请求行 (\n 终止; 累积多 read 防 TCP 分片); 8192 上限防滥用。
async fn read_request_line<S: AsyncReadExt + Unpin>(stream: &mut S) -> std::io::Result<String> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 1024];
    loop {
        if let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            return Ok(String::from_utf8_lossy(&buf[..pos])
                .trim_end_matches('\r')
                .to_string());
        }
        if buf.len() > 8192 {
            return Ok(String::from_utf8_lossy(&buf).into_owned());
        }
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            return Ok(String::from_utf8_lossy(&buf).into_owned());
        }
        buf.extend_from_slice(&tmp[..n]);
    }
}

async fn write_ok<S: AsyncWriteExt + Unpin>(stream: &mut S) -> std::io::Result<()> {
    let body = "<!doctype html><html><body style=\"font-family:sans-serif;padding:2rem\">授权成功，可关闭本页返回 ideall。</body></html>";
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(resp.as_bytes()).await?;
    stream.flush().await
}

async fn write_404<S: AsyncWriteExt + Unpin>(stream: &mut S) -> std::io::Result<()> {
    stream
        .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        .await
}

/// 从 query 串取参数并 percent-decode。
fn query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        if it.next() == Some(key) {
            return Some(percent_decode(it.next().unwrap_or("")));
        }
    }
    None
}

/// 最小 percent-decode (%XX 与 +)。
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                    out.push((h << 4) | l);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{handle_callback_conn, percent_decode, query_param};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    // 真 socket 跑一条连接: 环回监听 → 客户端发 req → handle_callback_conn 处理 → 返回 (解析结果, 原始回包)。
    // connect 先于 accept 靠内核 backlog 完成; req/resp 都很小, 单任务顺序收发不会阻塞。drop(srv) 关连接触发客户端 EOF。
    async fn one_conn(req: &[u8]) -> (Option<(Option<String>, Option<String>)>, String) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(addr).await.unwrap();
        client.write_all(req).await.unwrap();
        let (mut srv, _) = listener.accept().await.unwrap();
        let parsed = handle_callback_conn(&mut srv).await;
        drop(srv); // Connection: close → 关 server 端触发客户端读到 EOF
        let mut resp = Vec::new();
        client.read_to_end(&mut resp).await.unwrap();
        (parsed, String::from_utf8_lossy(&resp).into_owned())
    }

    #[test]
    fn callback_with_code_returns_200_and_parsed_pair() {
        tauri::async_runtime::block_on(async {
            let (parsed, resp) =
                one_conn(b"GET /callback?code=abc&state=s1 HTTP/1.1\r\nHost: x\r\n\r\n").await;
            assert_eq!(parsed, Some((Some("abc".into()), Some("s1".into()))));
            assert!(resp.starts_with("HTTP/1.1 200 OK"), "resp={resp}");
            assert!(resp.contains("授权成功"));
        });
    }

    #[test]
    fn callback_without_code_keeps_waiting_but_still_200() {
        tauri::async_runtime::block_on(async {
            // 无 code (如 error=access_denied) → 回 200 但返回 None, 继续等真回调。
            let (parsed, resp) =
                one_conn(b"GET /callback?error=access_denied HTTP/1.1\r\n\r\n").await;
            assert_eq!(parsed, None);
            assert!(resp.starts_with("HTTP/1.1 200 OK"), "resp={resp}");
        });
    }

    #[test]
    fn non_callback_path_returns_404_and_none() {
        tauri::async_runtime::block_on(async {
            let (parsed, resp) = one_conn(b"GET /favicon.ico HTTP/1.1\r\n\r\n").await;
            assert_eq!(parsed, None);
            assert!(resp.starts_with("HTTP/1.1 404"), "resp={resp}");
        });
    }

    #[test]
    fn percent_decode_handles_escapes_and_plus() {
        assert_eq!(percent_decode("hello"), "hello");
        assert_eq!(percent_decode("a+b"), "a b");
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("%2Fpath%3Fx%3D1"), "/path?x=1");
        assert_eq!(percent_decode("%ZZ"), "%ZZ"); // 非法 hex → 原样保留 %
        assert_eq!(percent_decode("end%2"), "end%2"); // 截断转义 → 原样
    }

    #[test]
    fn query_param_extracts_and_decodes() {
        let q = "code=ab%20c&state=xy%2Fz&empty=";
        assert_eq!(query_param(q, "code").as_deref(), Some("ab c"));
        assert_eq!(query_param(q, "state").as_deref(), Some("xy/z"));
        assert_eq!(query_param(q, "empty").as_deref(), Some(""));
        assert_eq!(query_param(q, "missing"), None);
        // 前缀相同的键不误匹配。
        assert_eq!(query_param("codex=1&code=2", "code").as_deref(), Some("2"));
    }
}
