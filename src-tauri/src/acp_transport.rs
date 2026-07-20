// ACP (Agent Client Protocol) 外部智能体传输 —— Rust 侧「哑管道」, 仅桌面。
//
// 设计 (方案 C, 见 src/plugins/agent/lib/acp-expose.ts + acp-agent.ts): Rust 只做两件与协议无关的事 ——
//   1. spawn 一个外部 ACP 智能体子进程 (program/args/cwd 来自用户设置, **绝不**由模型/网页内容控制);
//   2. 在子进程 stdin/stdout 上做 NDJSON 行框定 (每条 JSON-RPC 消息一行, 按 '\n' 切分)。
// **绝不解析 JSON-RPC、绝不理解 ACP 语义** —— 协议逻辑全在 webview 侧
// (acp-client.ts / acp-agent.ts / acp-expose.ts)。ideall 作为 agent 暴露时仍走既有工具安全闸；
// 反向启动的外部 CLI 是当前 OS 用户权限下的进程，ACP permission 只是合作协议而非 OS 沙箱。
//
// 与 embed 的 MessagePortTransport / LoopbackTransport (MCP-over-postMessage, 进程内/iframe) 完全正交, 共存不互扰。
// 仅桌面: 移动端 (iOS/Android) 沙箱不允许 spawn 子进程, 故本模块在 lib.rs 以 #[cfg(desktop)] 挂载、命令也只在桌面注册。
//
// 攻击面: 本模块唯一新增的攻击面是「spawn 子进程」。收口 —— program/args 来自用户在设置里显式配置 (非模型可控,
// 与 web.fetch 的 URL 由模型选不同, 故此处不需 SSRF 式守卫); 不引 tauri-plugin-shell (其 shell-exec 面太宽);
// capability (capabilities/acp.json) 限定主窗口 + 仅桌面三平台。

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpListener;
use tokio::process::{Child, ChildStdin, Command};

/// 一条 ACP 会话: 持子进程句柄 (供 acp_close 显式 kill; kill_on_drop 兜底收尸) 与 stdin (供 acp_send 写入)。
pub(crate) struct AcpSession {
    child: Child,
    stdin: ChildStdin,
}

/// 会话表 (id → 会话)。tokio 异步锁: acp_send 须在持锁状态下跨 await 写 stdin。
pub(crate) type AcpSessions = tokio::sync::Mutex<HashMap<String, AcpSession>>;

/// 建初始空会话表 (lib.rs 经 .manage() 注入)。
pub(crate) fn init_state() -> AcpSessions {
    tokio::sync::Mutex::new(HashMap::new())
}

/// reader 逐行产出的事件 (与 Tauri 解耦, 便于单测)。
#[derive(Debug, Clone, PartialEq)]
enum AcpEvent {
    /// 子进程 stdout 的一整行 (一条 ACP 消息, 未解析)。
    Message(String),
    /// stdout EOF / 读错 → 会话结束。退出码暂不捕获 (MVP), 留 None (子进程句柄在会话表内, reader 不持有故无法 wait)。
    Closed(Option<i32>),
}

const MAX_NDJSON_LINE_BYTES: usize = 4 * 1024 * 1024;

fn valid_outbound_line(line: &str) -> bool {
    line.len() <= MAX_NDJSON_LINE_BYTES && !line.bytes().any(|byte| matches!(byte, b'\r' | b'\n'))
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AcpMessagePayload {
    id: String,
    line: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AcpClosedPayload {
    id: String,
    code: Option<i32>,
}

/// 行框定核心: 从 reader 逐行读, 每行 emit Message; EOF/读错 emit 一次 Closed 后返回。
/// 纯逻辑 (不碰 Tauri / 会话表), emit 由调用方注入 —— 故可用内存 reader / 真子进程单测 (见 mod tests)。
async fn pump_lines<R, F>(mut reader: R, mut emit: F)
where
    R: AsyncBufRead + Unpin,
    F: FnMut(AcpEvent),
{
    let mut line = Vec::new();
    loop {
        let available = match reader.fill_buf().await {
            Ok(available) => available,
            Err(_) => {
                emit(AcpEvent::Closed(None));
                return;
            }
        };
        if available.is_empty() {
            if !line.is_empty() {
                let message = std::mem::take(&mut line);
                match String::from_utf8(message) {
                    Ok(message) => emit(AcpEvent::Message(message)),
                    Err(_) => {
                        emit(AcpEvent::Closed(None));
                        return;
                    }
                }
            }
            emit(AcpEvent::Closed(None));
            return;
        }

        let newline = available.iter().position(|byte| *byte == b'\n');
        let data_bytes = newline.unwrap_or(available.len());
        if line.len().saturating_add(data_bytes) > MAX_NDJSON_LINE_BYTES {
            emit(AcpEvent::Closed(None));
            return;
        }
        line.extend_from_slice(&available[..data_bytes]);
        reader.consume(data_bytes + usize::from(newline.is_some()));

        if newline.is_some() {
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let message = std::mem::take(&mut line);
            match String::from_utf8(message) {
                Ok(message) => emit(AcpEvent::Message(message)),
                Err(_) => {
                    emit(AcpEvent::Closed(None));
                    return;
                }
            }
        }
    }
}

pub(crate) async fn spawn_resolved(
    app: AppHandle,
    sessions: &AcpSessions,
    id: String,
    resolved: PathBuf,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    sanitize_environment: bool,
) -> Result<(), String> {
    let mut cmd = Command::new(&resolved);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true); // 会话 drop (acp_close / EOF 清理 / 应用退出) 即杀+收尸, 不留僵尸。
    if sanitize_environment {
        cmd.env_clear();
        for key in [
            "PATH",
            "HOME",
            "USERPROFILE",
            "SYSTEMROOT",
            "WINDIR",
            "TEMP",
            "TMP",
            "LANG",
            "LC_ALL",
        ] {
            if let Some(value) = std::env::var_os(key) {
                cmd.env(key, value);
            }
        }
    } else {
        cmd.env("PATH", augmented_path());
    }
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    // 持锁期内完成「查重→spawn→插入」, 避免同 id 并发竞态。spawn 是异步且很快, 跨 await 持 tokio 锁可接受。
    let mut map = sessions.lock().await;
    if map.contains_key(&id) {
        return Err("session-exists".into()); // id 由调用方 (JS) 保证唯一; 复用同 id 须先 acp_close。
    }
    let mut child = cmd.spawn().map_err(|e| format!("spawn-failed: {e}"))?;
    let stdout = child.stdout.take().ok_or("no-stdout")?;
    let stdin = child.stdin.take().ok_or("no-stdin")?;
    map.insert(id.clone(), AcpSession { child, stdin });
    drop(map); // 早释放: reader 任务在 EOF 时要重新上锁清理。

    let app_emit = app.clone();
    let app_cleanup = app;
    let id_emit = id.clone();
    let id_cleanup = id;
    tauri::async_runtime::spawn(async move {
        pump_lines(BufReader::new(stdout), |ev| match ev {
            AcpEvent::Message(line) => {
                let _ = app_emit.emit(
                    "acp://message",
                    AcpMessagePayload {
                        id: id_emit.clone(),
                        line,
                    },
                );
            }
            AcpEvent::Closed(code) => {
                let _ = app_emit.emit(
                    "acp://closed",
                    AcpClosedPayload {
                        id: id_emit.clone(),
                        code,
                    },
                );
            }
        })
        .await;
        // EOF: 从会话表移除 (drop AcpSession → kill_on_drop 收尸)。若 acp_close 已先移除, 此处无害 (返回 None)。
        let _ = app_cleanup
            .state::<AcpSessions>()
            .lock()
            .await
            .remove(&id_cleanup);
    });

    Ok(())
}

/// 用户显式配置的 ACP/MCP 命令走 PATH 解析；签名扩展调用绝对路径入口并清理环境。
#[tauri::command]
pub(crate) async fn acp_spawn(
    app: AppHandle,
    sessions: State<'_, AcpSessions>,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    if program.trim().is_empty() {
        return Err("empty-program".into());
    }
    let resolved = which(&program).ok_or_else(|| format!("program-not-found: {program}"))?;
    let cwd = cwd.filter(|value| !value.is_empty()).map(PathBuf::from);
    spawn_resolved(
        app,
        &sessions,
        id,
        PathBuf::from(resolved),
        args,
        cwd,
        false,
    )
    .await
}

/// 向会话子进程 stdin 写一行 (调用方传一条完整 JSON-RPC 消息, 本函数补 '\n' 行框定)。
#[tauri::command]
pub(crate) async fn acp_send(
    sessions: State<'_, AcpSessions>,
    id: String,
    line: String,
) -> Result<(), String> {
    if !valid_outbound_line(&line) {
        return Err("invalid-message".into());
    }
    let mut map = sessions.lock().await;
    let s = map.get_mut(&id).ok_or("no-session")?;
    s.stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("write-failed: {e}"))?;
    s.stdin
        .write_all(b"\n")
        .await
        .map_err(|e| format!("write-failed: {e}"))?;
    s.stdin
        .flush()
        .await
        .map_err(|e| format!("flush-failed: {e}"))?;
    Ok(())
}

/// 关闭会话: 移除并显式 kill 子进程 (kill_on_drop 亦兜底)。reader 随后 stdout EOF, 自然收束。
#[tauri::command]
pub(crate) async fn acp_close(sessions: State<'_, AcpSessions>, id: String) -> Result<(), String> {
    if let Some(mut s) = sessions.lock().await.remove(&id) {
        let _ = s.child.start_kill();
    }
    Ok(())
}

// ── 入站服务端 (暴露方向): 监听 127.0.0.1 accept 外部客户端 (编辑器) 连接, 桥成事件 ────────────────────
// 复用 pump_lines 行框定。**仅环回 (绝不 0.0.0.0)**, 由用户在设置里显式开启。每连接一个 connId:
// acp://server/open{connId} → JS 侧 attach ideall ACP 智能体 (exposeIdeallAcpAgent);
// acp://server/message{connId,line} 双向; acp://server/closed{connId} 收束。仅桌面。

static CONN_SEQ: AtomicU64 = AtomicU64::new(0);

/// 入站服务端状态: 已接受连接的写半 (供 acp_server_send) + accept 任务句柄 (供 stop 中止)。
pub(crate) struct ServerState {
    conns: tokio::sync::Mutex<HashMap<String, OwnedWriteHalf>>,
    accept_task: tokio::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

/// 建初始空服务端状态 (lib.rs 经 .manage() 注入)。
pub(crate) fn init_server_state() -> ServerState {
    ServerState {
        conns: tokio::sync::Mutex::new(HashMap::new()),
        accept_task: tokio::sync::Mutex::new(None),
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerConnEvent {
    conn_id: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerMessageEvent {
    conn_id: String,
    line: String,
}

/// 开始监听 127.0.0.1:port (port=0 → 由 OS 分配); 返回实际端口。单例: 已监听则先停。
#[tauri::command]
pub(crate) async fn acp_listen_start(
    app: AppHandle,
    server: State<'_, ServerState>,
    port: Option<u16>,
) -> Result<u16, String> {
    {
        let mut t = server.accept_task.lock().await;
        if let Some(h) = t.take() {
            h.abort();
        }
    }
    server.conns.lock().await.clear();

    // 仅环回: 绝不绑 0.0.0.0, 避免把本机智能体暴露到局域网。
    let listener = TcpListener::bind(("127.0.0.1", port.unwrap_or(0)))
        .await
        .map_err(|e| format!("bind-failed: {e}"))?;
    let bound = listener.local_addr().map_err(|e| e.to_string())?.port();

    let app_accept = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        loop {
            let (stream, _peer) = match listener.accept().await {
                Ok(v) => v,
                Err(_) => break, // listener 关闭 → 结束 accept 循环
            };
            let conn_id = format!("conn-{}", CONN_SEQ.fetch_add(1, Ordering::Relaxed));
            let (read, write) = stream.into_split();
            app_accept
                .state::<ServerState>()
                .conns
                .lock()
                .await
                .insert(conn_id.clone(), write);
            let _ = app_accept.emit(
                "acp://server/open",
                ServerConnEvent {
                    conn_id: conn_id.clone(),
                },
            );

            let app_conn = app_accept.clone();
            let cid = conn_id;
            tauri::async_runtime::spawn(async move {
                pump_lines(BufReader::new(read), |ev| match ev {
                    AcpEvent::Message(line) => {
                        let _ = app_conn.emit(
                            "acp://server/message",
                            ServerMessageEvent {
                                conn_id: cid.clone(),
                                line,
                            },
                        );
                    }
                    AcpEvent::Closed(_) => {
                        let _ = app_conn.emit(
                            "acp://server/closed",
                            ServerConnEvent {
                                conn_id: cid.clone(),
                            },
                        );
                    }
                })
                .await;
                app_conn
                    .state::<ServerState>()
                    .conns
                    .lock()
                    .await
                    .remove(&cid);
            });
        }
    });
    *server.accept_task.lock().await = Some(handle);
    Ok(bound)
}

/// 停止监听并断开所有入站连接。
#[tauri::command]
pub(crate) async fn acp_listen_stop(server: State<'_, ServerState>) -> Result<(), String> {
    if let Some(h) = server.accept_task.lock().await.take() {
        h.abort();
    }
    server.conns.lock().await.clear(); // drop 写半 → 关连接
    Ok(())
}

/// 向某入站连接 (id = connId) 写一条 ACP 消息 (补 '\n')。
#[tauri::command]
pub(crate) async fn acp_server_send(
    server: State<'_, ServerState>,
    id: String,
    line: String,
) -> Result<(), String> {
    let mut map = server.conns.lock().await;
    let w = map.get_mut(&id).ok_or("no-conn")?;
    w.write_all(line.as_bytes())
        .await
        .map_err(|e| format!("write-failed: {e}"))?;
    w.write_all(b"\n")
        .await
        .map_err(|e| format!("write-failed: {e}"))?;
    w.flush().await.map_err(|e| format!("flush-failed: {e}"))?;
    Ok(())
}

/// 主动关闭某入站连接 (id = connId)。
#[tauri::command]
pub(crate) async fn acp_server_close(
    server: State<'_, ServerState>,
    id: String,
) -> Result<(), String> {
    server.conns.lock().await.remove(&id); // drop 写半 → 关
    Ok(())
}

// ── 外部智能体检测 (设置里"点选即用") ───────────────────────────────────────────────────────────
// 无 dep, 纯文件系统: acp_which 在 PATH 上解析可执行文件; acp_script_path 定位仓库内置脚本 (如 echo 测试智能体)。

fn is_executable(p: &std::path::Path) -> bool {
    if !p.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// GUI 启动的 App 继承的是桌面 PATH, 常缺 nvm / homebrew / cargo 等用户级 bin 目录。
/// 收集这些常见目录 (后续按"存在"过滤), 供 which 解析与子进程 PATH。
fn extra_bin_dirs() -> Vec<std::path::PathBuf> {
    use std::path::PathBuf;
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        // nvm: 各 node 版本各有一个 bin 目录。
        if let Ok(rd) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            for e in rd.flatten() {
                dirs.push(e.path().join("bin"));
            }
        }
        for rel in [
            ".volta/bin",
            ".local/bin",
            ".cargo/bin",
            ".bun/bin",
            ".deno/bin",
            ".npm-global/bin",
            ".config/npm/bin",
        ] {
            dirs.push(home.join(rel));
        }
    }
    for p in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/home/linuxbrew/.linuxbrew/bin",
        "/usr/bin",
        "/bin",
    ] {
        dirs.push(PathBuf::from(p));
    }
    dirs
}

/// 现有 PATH + extra_bin_dirs (去重、仅保留存在目录); 供 which 与子进程使用 (修 GUI 启动缺 PATH)。
fn augmented_path() -> std::ffi::OsString {
    use std::collections::HashSet;
    use std::path::PathBuf;
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path));
    }
    candidates.extend(extra_bin_dirs());
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut parts: Vec<PathBuf> = Vec::new();
    for p in candidates {
        if p.is_dir() && seen.insert(p.clone()) {
            parts.push(p);
        }
    }
    std::env::join_paths(parts).unwrap_or_default()
}

/// 在 (增广) PATH 上解析可执行文件 (含路径分隔符则当路径直接判定)。返回绝对/原始路径; 不存在返回 None。
fn which(program: &str) -> Option<String> {
    if program.is_empty() {
        return None;
    }
    if program.contains('/') || program.contains('\\') {
        let direct = std::path::Path::new(program);
        return is_executable(direct).then(|| direct.to_string_lossy().into_owned());
    }
    let path = augmented_path();
    for dir in std::env::split_paths(&path) {
        let cand = dir.join(program);
        if is_executable(&cand) {
            return Some(cand.to_string_lossy().into_owned());
        }
        #[cfg(windows)]
        for ext in ["exe", "cmd", "bat"] {
            let c2 = dir.join(format!("{program}.{ext}"));
            if is_executable(&c2) {
                return Some(c2.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// 在 PATH 上解析可执行文件, 返回路径供"检测可用智能体"点选; 不存在返回 null。
#[tauri::command]
pub(crate) fn acp_which(program: String) -> Option<String> {
    which(&program)
}

/// 找内置脚本 scripts/<name> (best-effort, 相对当前工作目录); 只取文件名防路径穿越。
/// 用于"内置回显(测试)"一键项与"暴露自测"客户端。
#[tauri::command]
pub(crate) fn acp_script_path(name: String) -> Option<String> {
    let file = std::path::Path::new(&name)
        .file_name()?
        .to_string_lossy()
        .into_owned();
    let cwd = std::env::current_dir().ok()?;
    for base in ["scripts", "../scripts"] {
        let p = cwd.join(base).join(&file);
        if p.is_file() {
            return p
                .canonicalize()
                .ok()
                .map(|c| c.to_string_lossy().into_owned());
        }
    }
    None
}

/// spawn 程序、读尽 stdout (有超时)、回收, 返回 stdout 文本。一次性诊断用 (如暴露自测客户端)。
async fn run_once_inner(program: &str, args: &[String], timeout_ms: u64) -> Result<String, String> {
    let resolved = which(program).ok_or_else(|| format!("program-not-found: {program}"))?;
    let mut child = Command::new(&resolved)
        .args(args)
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("spawn-failed: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("no-stdout")?;
    let mut buf = String::new();
    match tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        stdout.read_to_string(&mut buf),
    )
    .await
    {
        Ok(Ok(_)) => {
            let _ = child.wait().await;
            Ok(buf)
        }
        Ok(Err(e)) => Err(format!("read-failed: {e}")),
        Err(_) => {
            let _ = child.start_kill();
            Err("timeout".into())
        }
    }
}

/// 一次性运行程序并取其 stdout (timeoutMs 缺省 20s)。
#[tauri::command]
pub(crate) async fn acp_run_once(
    program: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    run_once_inner(&program, &args, timeout_ms.unwrap_or(20_000)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // 跨平台: 内存 reader 验证「行框定 + EOF 收 Closed」。
    #[test]
    fn frames_lines_then_closed_at_eof() {
        let events = Mutex::new(Vec::new());
        tauri::async_runtime::block_on(async {
            let reader = BufReader::new(&b"alpha\nbeta\ngamma\n"[..]);
            pump_lines(reader, |ev| events.lock().unwrap().push(ev)).await;
        });
        assert_eq!(
            events.into_inner().unwrap(),
            vec![
                AcpEvent::Message("alpha".into()),
                AcpEvent::Message("beta".into()),
                AcpEvent::Message("gamma".into()),
                AcpEvent::Closed(None),
            ]
        );
    }

    // 末行无换行也不丢 (流末尾可能无 '\n')。
    #[test]
    fn last_line_without_trailing_newline_kept() {
        let events = Mutex::new(Vec::new());
        tauri::async_runtime::block_on(async {
            let reader = BufReader::new(&b"only"[..]);
            pump_lines(reader, |ev| events.lock().unwrap().push(ev)).await;
        });
        assert_eq!(
            events.into_inner().unwrap(),
            vec![AcpEvent::Message("only".into()), AcpEvent::Closed(None)]
        );
    }

    #[test]
    fn oversized_or_injected_ndjson_lines_are_rejected() {
        let events = Mutex::new(Vec::new());
        tauri::async_runtime::block_on(async {
            let input = vec![b'x'; MAX_NDJSON_LINE_BYTES + 1];
            let reader = BufReader::new(input.as_slice());
            pump_lines(reader, |ev| events.lock().unwrap().push(ev)).await;
        });
        assert_eq!(events.into_inner().unwrap(), vec![AcpEvent::Closed(None)]);
        assert!(valid_outbound_line("{\"jsonrpc\":\"2.0\"}"));
        assert!(!valid_outbound_line("{}\n{}"));
        assert!(!valid_outbound_line(&"x".repeat(MAX_NDJSON_LINE_BYTES + 1)));
    }

    // 入站 TCP 往返 (跨平台): 监听 127.0.0.1:0 → 客户端连入写两行并半关 → 服务端读半经 pump_lines 行框定。
    #[test]
    fn tcp_listener_pumps_framed_lines() {
        use tokio::net::{TcpListener, TcpStream};
        let events = Mutex::new(Vec::new());
        tauri::async_runtime::block_on(async {
            let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            let addr = listener.local_addr().unwrap();
            let client = tauri::async_runtime::spawn(async move {
                let mut s = TcpStream::connect(addr).await.unwrap();
                s.write_all(b"hello\nworld\n").await.unwrap();
                s.shutdown().await.unwrap(); // 关写半 → 服务端读到 EOF
            });
            let (stream, _peer) = listener.accept().await.unwrap();
            let (read, _write) = stream.into_split();
            pump_lines(BufReader::new(read), |ev| events.lock().unwrap().push(ev)).await;
            client.await.unwrap();
        });
        assert_eq!(
            events.into_inner().unwrap(),
            vec![
                AcpEvent::Message("hello".into()),
                AcpEvent::Message("world".into()),
                AcpEvent::Closed(None),
            ]
        );
    }

    // which: 垃圾名解析失败; 已知二进制 (Unix: sh) 解析成功。
    #[test]
    fn which_resolves_known_and_rejects_garbage() {
        assert!(which("definitely-not-a-real-binary-xyz-12345").is_none());
        assert!(which("").is_none());
        #[cfg(unix)]
        assert!(which("sh").is_some(), "PATH 上应能找到 sh");
    }

    // augmented_path: 装了 nvm node 时, 增广 PATH 应含其 bin (修 GUI 启动缺 PATH)。
    #[cfg(unix)]
    #[test]
    fn augmented_path_includes_nvm_when_present() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };
        let nvm = std::path::Path::new(&home).join(".nvm/versions/node");
        if !nvm.is_dir() {
            return; // 无 nvm 跳过
        }
        let aug = augmented_path();
        let has = std::env::split_paths(&aug).any(|d| d.starts_with(&nvm));
        assert!(has, "augmented PATH 应含 nvm node bin");
    }

    // run_once: 捕获子进程 stdout (仅 Unix: sh -c)。
    #[cfg(unix)]
    #[test]
    fn run_once_captures_stdout() {
        let out = tauri::async_runtime::block_on(run_once_inner(
            "sh",
            &["-c".into(), "printf 'self-test-ok'".into()],
            5000,
        ))
        .expect("run_once");
        assert_eq!(out, "self-test-ok");
    }

    // 真子进程往返 (仅 Unix: 用 cat 回显)。验证 spawn + 写 stdin + stdout 行框定 + EOF 全链路。
    #[cfg(unix)]
    #[test]
    fn cat_subprocess_roundtrip() {
        let events = Mutex::new(Vec::new());
        tauri::async_runtime::block_on(async {
            let mut child = Command::new("cat")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .spawn()
                .expect("spawn cat");
            let stdout = child.stdout.take().unwrap();
            let mut stdin = child.stdin.take().unwrap();
            stdin.write_all(b"one\ntwo\nthree\n").await.unwrap();
            drop(stdin); // 关 stdin → cat 回显完即 EOF 退出
            pump_lines(BufReader::new(stdout), |ev| events.lock().unwrap().push(ev)).await;
        });
        assert_eq!(
            events.into_inner().unwrap(),
            vec![
                AcpEvent::Message("one".into()),
                AcpEvent::Message("two".into()),
                AcpEvent::Message("three".into()),
                AcpEvent::Closed(None),
            ]
        );
    }
}
