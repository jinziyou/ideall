# 安全策略

## 适用范围

本策略仅覆盖 **ideall 客户端**（本仓库）。

- ✅ ideall 前端、本地数据层、跨端同步加密（`src/lib/sync-crypto.ts`）、插件、Tauri App 壳
- ❌ **官方信息服务后端**（采集 / NLP / 知识图谱 / 鉴权 API）不在本仓库范围内；相关问题请通过官方服务渠道反馈

## 报告漏洞

**请勿在公开 Issue / PR / Discussion 中披露安全漏洞。**

请通过 GitHub 私密通道报告：

- 仓库 **Security → Report a vulnerability**（GitHub Security Advisories）—— 当前唯一正式渠道

报告请尽量包含：受影响版本 / 形态（Web 或 App）、复现步骤、影响评估、可能的修复建议。

> 官方域名（`wonita.*`）上线后将增设 `security@` 邮箱与 PGP 公钥，并在此更新。

## 处理流程与预期

- ideall 由小团队 / 个人维护，我们会尽力在合理时间内确认与响应（best-effort）
- 修复发布后会在 Release notes 中致谢报告者（如你愿意具名）
- 请给予合理的协调披露窗口，在修复发布前不公开细节

## 威胁模型与信任边界

- **第一方 webview（可信）**：ideall 前端与本地数据层（IndexedDB）。登录令牌、同步码、模型 API Key、MCP secret / OAuth token 等敏感凭据经统一 secure-store 访问：Tauri App 优先写入系统凭据库；Web / dev 形态以及原生凭据库调用失败时，降级到宿主 origin 下带 `ideall:secure-fallback:` 前缀的 `localStorage`。公开设置与用户展示资料仍可存于普通 `localStorage`。系统凭据库降低静态磁盘与浏览器存储快照的暴露，但不把已获主窗口执行权的同源 XSS 变成可信代码。
- **跨域嵌入页（半信任）**：`info`/`community` 默认嵌入 `wonita.link` 的 iframe，独立部署/独立供应链，经 MCP-over-postMessage 桥与宿主通信。
- **模型端点（用户自选外部锚）**：BYO-key 直连，agent 发送的一切它都可见。
- **外部 MCP（用户配置，不可信）**：远端 HTTP/SSE 服务或本机 stdio 子进程可看到发给它的初始化、工具参数与配置给该服务的凭据；其返回值会进入 agent 循环，并可能继续发给模型端点。
- **agent 出站外网（目标可被模型/被投毒内容左右，不可信）**：agent 经 `web:search`/`web:fetch`（`@/lib/web-search`）联网取数，目标 URL 由模型决定；抓回的网页正文是攻击者可控数据，**仅为数据、绝不可当指令**。与「模型端点」是两条独立出站边界。
- **后端 / 网络（不可信）**：同步后端只存不透明密文；网络中间人在 TLS 下不可破，但后端本身视为敌手。

## 数据出站矩阵

“本地优先”表示本地数据不会作为中央账户备份被自动整库上传，不表示所有联网功能都零出站。下表是当前实现的出站边界；将 wonita 换成自建服务、模型或 MCP 后，接收方也随配置改变。

| 边界 | 何时出站 | 会离开设备的数据 | 不会自动发送 / 主要控制 |
| --- | --- | --- | --- |
| **wonita 数据服务与嵌入门户** | 打开 info/community、查询服务数据，或主动登录、修改资料、发布内容；默认 iframe 加载 `www.wonita.link` | 请求 URL、查询条件与常规网络元数据；登录材料、认证请求中的 account token；用户提交的资料与发布内容。内置 iframe 还能按静态 manifest 调用已授权的关注读取/写入、书签写入、身份读取/发布能力；token 留在宿主，由宿主代发认证请求 | 不发送模型 API Key 或同步码；iframe 无笔记正文、Blob、`web:*` 权限。可用 `ServerPort` / embed 配置改接自建服务，运行期可断开已连接 iframe 的宿主能力 |
| **用户选择的模型端点** | 用户发送普通对话或 agent 回合 | BYO API Key（`Authorization`）、模型名、系统提示、最近对话；启用上下文时包含 home 标题、用户当前活动文件的引用正文与浏览器上下文；agent 模式还会发送工具 schema、工具调用结果，以及外部 MCP / web 工具返回的数据 | 不自动上传整个 IndexedDB 或文件库；正文读取受活动文件与 `fs.notes:read` / `fs.blobs:read` 等能力闸约束。该端点能看到实际请求中的全部内容 |
| **外部 MCP** | 用户配置并启用 stdio、SSE 或 Streamable HTTP server，agent 建连、发现工具或调用其工具 | MCP 初始化/发现流量、工具参数，以及为该 server 配置的 header、OAuth token 或 secret；本机 stdio 子进程同样能看到其 MCP 流量 | 不自动获得模型 API Key、同步码或完整本地库；但模型可能把对话或本地工具所得内容放入外部工具参数。外部工具在默认 `confirm` 策略下逐次确认，`auto` 策略仍对外部工具强制确认 |
| **`web.search` / `web.fetch`** | agent 调用联网工具；`confirm` 策略会逐次确认，`auto` 策略可直接调用 | 搜索词会发给内置搜索源（DuckDuckGo，失败时级联 Wikipedia）；`web.fetch` 的目标 URL 会发给目标站点；接收方还可记录 IP、时间与常规网络元数据。抓回的结果会进入模型上下文 | 不带 cookie、`Authorization` 或模型 API Key。只允许 HTTPS/443，逐跳检查重定向、限制响应体与超时；App 侧再做 DNS 解析、私网阻断与连接钉定。搜索可对固定源使用 GET/POST，任意页面抓取只用 GET |
| **同步服务** | 用户创建/加入同步并执行同步 | 每个同步 scope 的稳定 `storageId`、AES-GCM 密文块（`iv`、`ciphertext`、`updated_at`）、请求时序/大小与常规网络元数据；当前 scope 仅关注与笔记 | 同步码、AES 密钥与明文不离开设备；无需账号。服务端仍可回滚、扣留、覆盖密文或凭 `storageId` 干扰写入，详见下方密码学取舍 |

核心承诺：**本地数据不自动整库上传，启用联网能力时按上表出站**；**跨端同步端到端加密、仅上传密文**；**BYO 密钥只发给用户选择的模型端点，不经 wonita、同步服务或嵌入桥**。涉及 `sync-crypto`、密钥派生、密文存储、嵌入桥能力面、agent 隐私闸的问题请优先报告。

## 本轮加固（2026-06）

- **同步入站时间戳上界**（`@protocol/sync` 的 `isSaneSyncTimestamp` + `isValidRemoteSub`/`isValidRemoteNote`）：拒绝远未来 `createdAt/updatedAt/deletedAt` 与块墓碑 `del`，关闭「持正确同步码但失陷/老旧的对端用远未来时间戳永久赢 LWW、钉死被投毒项或造 GC 清不掉的不死墓碑」路径。
- **CSP `frame-src` 去明文源**：移除 `http://www.wonita.link`/`http://wonita.link`，仅保留 https，杜绝 MITM 在被白名单的明文源上投放页并领取一方嵌入能力。
- **根错误兜底** `app/global-error.tsx`：根 layout 自身崩溃也有恢复 UI。
- **CSP `connect-src` 收窄为 `'self' tauri:`**：穷尽分析确认 webview 内零 `fetch`/XHR/WebSocket（所有远端请求走 Rust `plugin-http`），故收窄不影响数据加载，缩小 XSS 经 webview 直连外传的面。
- **`fs.readBlob` 私密读闸（`fs.blobs:read`）**：文件二进制读与 note 正文同级 consent —— 无 `fs.blobs:read` 返回 `consent-required(-32003)`；`agentGrant` 不含该位，agent 默认不能无授权把上传文件读出外发模型端点。
- **嵌入「已连接的应用」面板 + 一键断开**：设置齿轮内列出运行期已建桥的嵌入应用（origin + 已授权限），可吊销其宿主能力面（断 MCP server，页面仍在但失去全部 host 工具）。
- **agent `ui.openTab` 自激活隔离**：工作区记录激活来源（user/agent），active-node 端口对 agent 经 `ui.openTab` 自激活的节点返回 `null` —— agent 无法把任意笔记设为活动标签再经 `referenced-context` 自喂其正文给模型端点（软绕 `fs.notes:read` consent）；用户手动点回该标签即恢复为已同意。
- **agent 联网 `web:search`/`web:fetch` 的 egress 守卫（`@/lib/web-search`）**：把 `/tool` 搜索升级为真·抓取并返回数据，所有出站经单一收口强制：① 仅 `https`（连明文 `http` 都拒，关掉环回/内网/明文面），拒带 `userinfo` 的 URL，端口仅 443；② 解析 IP 字面量拦 环回/私网（10·172.16·192.168）/link-local（含云元数据 `169.254.169.254`）/ULA/CGNAT/广播，IPv6 拦 `::1`/`fe80::/10`/`fc00::/7` 并解 `::ffff:` 映射回查，名字面拦 `localhost`/`.local`/`.internal`；③ 重定向 `manual`、逐跳重跑同一策略、上限 3 跳（堵重定向→内网/元数据旁路）；④ 响应体 ≤2MB、连接/读超时 10s，不带 cookie/Authorization、绝不复用模型 apiKey；任意页面抓取只用 `GET`，搜索只向固定内置源发 `GET`/`POST` 查询；⑤ `web:fetch` 回喂前抽正文并截断，agent 系统提示明确标注抓取内容为「数据非指令」防间接提示注入。`web:*` 钉死 first-party（`PERMISSION_MIN_TIER`），半信任嵌入页拿不到宿主出站通道（机器强制：`grant.test.ts` 锁 iframe manifest 不含 `web:*`）。
- **agent 联网出站的 Rust 侧 resolve+pin+connect 守卫（`src-tauri` 的 `agent_guarded_fetch` 命令）**：App 形态的 agent 出站不再走 `plugin-http`，改走专用 Rust 命令——**自行解析主机→校验所有解析 IP（任一落环回/私网/link-local/元数据/ULA/CGNAT 即 `fail closed` 拒绝）→ `resolve_to_addrs` 把连接钉死到已校验 IP**（reqwest 不再二次解析），从而**闭合 JS 侧拦不住的「公网域名 A 记录指向私网」名解析 SSRF 与 DNS-rebind/TOCTOU**（校验与连接同源）；Rust 侧同样强制 https-only、端口 443、流式体积上限（解压后计数，挡解压炸弹）、连接/读超时、不带凭证，并承载上述受限的 `GET`/`POST` 请求。该命令经 `build.rs` 声明 + `capabilities/default.json` 的 `allow-agent-guarded-fetch` 授权，桌面与移动端通用；IP 全局性判定有离线 Rust 单测（与 JS 侧拦截集互为镜像）。

## 已知取舍（有意接受，非疏漏）

- **secure-store 降级与主窗口 XSS**：Tauri App 已通过系统凭据库保存登录令牌、同步码、模型 API Key、MCP secret / OAuth token 等凭据；Web / dev 形态固定降级到命名 `localStorage`，原生凭据库调用失败时也会降级。系统凭据库改善静态存储安全，但主窗口拥有不按 key 限域的 secure-store 读写命令；一旦第一方同源 XSS 获得该窗口执行权，仍可能读取凭据或经 `plugin-http` 外传。**路线**：按 owner / key scope 收窄 Tauri 命令，并为原生降级提供显式告警或 fail-closed 模式。
- **CSP `script-src 'unsafe-inline'`**：Next.js 静态导出向 HTML 注入大量内联 hydration 脚本（单文件 70+），单 hash 无法覆盖、静态导出又无法用 nonce，故暂留 `unsafe-inline`。**路线**：迁移到可去内联脚本的 CSP 方案后移除。
- **Tauri `http:default` 放行任意 URL（webview `connect-src` 已收窄）**：webview `connect-src` 现为 `'self' tauri:`（见本轮加固），但 App 出站实际走 Rust `plugin-http`，其 `capabilities/default.json` 放行 `https://*`/`http://*` 是 BYO-key 任意端点 + 自建后端的必需放宽——故 XSS 仍可经 `plugin-http` 外传，且不受 webview CSP 约束。**路线**：若未来 BYO 端点可枚举/白名单化，再收窄 `http:default`；当前为有意接受的残余面。
- **agent 联网 egress 的残余面（出站不受 CSP 约束 / 提示注入 / 隐私 / 每轮次数）**：`web:fetch` 给了 agent 模型可控目标的网络出站。**名解析 SSRF 与 DNS-rebind 已由 Rust 侧 `agent_guarded_fetch` 守卫闭合**（见本轮加固，App 形态）；剩余有意接受的残余：① **dev/浏览器形态无 Rust 命令**——`pnpm dev` 纯浏览器态退回标准 `fetch`，受 CORS 限制且名解析 SSRF 不闭合，但 agent 仅以 App 形态分发，此态仅本地开发用。② 出站走 Rust（`plugin-http` 或 `agent_guarded_fetch`），**不受 webview `connect-src` 约束**——故 egress 策略是「应用层」强制而非 webview CSP 兜底（这是 App 直连后端/BYO 端点的必需放宽）。③ **间接提示注入**：抓回的网页正文回灌进 agent 循环，已靠系统提示标注「数据非指令」+ 正文截断压制，但模型层面无法绝对保证。④ **隐私**：即便正常调用，查询词/URL 也会发往搜索/被抓主机并被其日志记录（数据离设备）。**路线**：每轮抓取次数硬上限；可选「联网总开关」。
- **E2E 同步密码学**：AES-256-GCM + 每次随机 IV + HKDF 域分离，后端读不到/伪造不了明文（单测钉死）。固定共享 `salt` + 单轮 HKDF **安全当且仅当同步码为 128bit 机器随机**——禁口令式/用户自拟低熵码（`join` 只应粘贴本 App 生成的码）。当前无前向保密 / 密钥轮换，「关闭同步」不删服务端密文。写入侧无密码学授权（`storageId` 即 bearer 写能力，泄露可 DoS）；`updated_at` 未进 AAD（不可信后端可回滚/扣留旧密文）。**路线**：写授权 MAC、AAD 绑 `storageId`+单调版本、码轮换 + 删云端、`join` 前熵校验。
- **嵌入应用一方自动授权（现可见 + 可吊销）**：`info`/`community` 一方 manifest 仍自动获发布/改资料/增删关注书签等能力，无连接时逐次 consent。但现已**运行期可见 + 可一键吊销**（见本轮加固「已连接的应用」面板），被嵌页失陷时用户可即时断开。**路线**：连接时的逐次 consent 弹窗（T1+ 接入前）。
- **X25519 登录口令加密**：仅防传输中被动记录，**不替代 TLS、不对服务端或主动 MITM 保密**（服务端持临时私钥解密；临时公钥未签名/钉定）。真正的口令机密性来自 TLS。**路线**：对临时公钥做服务端长期密钥签名 + 客户端校验。
