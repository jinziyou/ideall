# ideall 作为本地数据提供方（多 transport + 授权模型）— 设计 + P1 已落地

> **状态：P1 已落地；P2 已落地运行期连接可见与一键断开这一小部分，持久 Grant、连接前 consent、外部 transport 与 P3 任意源仍为设计。**
> **P1（最稳/最高杠杆，已实现）**：把原先糅在 `host.tsx` 里的「能力 / transport / 会话授权」三件事拆开 ——
> 抽出 transport 无关的能力层工厂 `createLocalMcpServer(grant)`（`src/plugins/embed/local-mcp-server.ts`）+
> 显式 L3 **Grant 模型**（`src/plugins/embed/grant.ts`：`Grant` / `firstPartyGrant` / `isGrantActive` / `effectivePermissions`，含单测 `grant.test.ts`）。
> `host.tsx` 由此退化为「iframe transport 绑定」之一：构造一方 **T0 Grant**（自动、不过期）→ 调工厂拿 server → 接 `MessagePortTransport`。活动连接同时登记到内存态 `connections.ts`，设置页 `ConnectedApps` 可查看 origin/权限并立即断开对应 MCP server；刷新后仍会按一方 manifest 自动重连，这不是持久撤销或连接前 consent。
> 内置 Agent 另已使用进程内 MessageChannel loopback 复用同一工厂；它不等于本文规划的对外 `127.0.0.1` 服务。**持久 Grant + 连接前 consent + 外部 transport / P3 任意源仍未排期**，下文未标注完成的部分均为设计。
>
> 缘起:讨论「能否让数据流反向 —— 让外部消费方(如 wonita portal)请求 ideall 中存的本地用户数据」,以及「浏览器插件是不是这个思路」。结论是:**反向取数在 iframe 嵌入语境里已经实现**(`src/plugins/embed/` 的 MCP 宿主桥),本文设计如何把它**泛化**成传输无关的「本地数据提供方」并配套 consent/权限模型。

## 背景:反向取数已存在于嵌入桥

`src/plugins/embed/`(`host.tsx` + `tools.ts` + `manifest.ts` + `protocol.ts`)已实现一个方向:ideall 内嵌 wonita portal(`<iframe src="${NEXT_PUBLIC_EMBED_BASE}/info">`),**ideall 跑 `McpServer`(宿主)、portal 是 MCP client(访客)**,ideall 按 manifest 的 `permissions` 只注册被授权的工具/资源。于是内嵌页能向 ideall「反问」本地数据(关注/书签/身份),据此渲染「已关注」「保存到我的」「发布」。

安全模型:数据全程留本地(IndexedDB,不上 wonita 服务器)、**token 永不出宿主**(发布类工具在 ideall 侧 handler 取 token 调 ServerPort)、跨域 + 源白名单握手 + 按授权位最小暴露。

本文要解决的是:把这套从「ideall 当壳、portal 当内嵌访客」**泛化**到其它消费形态(浏览器扩展中继、localhost 回环),同时不破坏上述安全/战略不变量。

## 0. 目标与边界

- 把现有「iframe-only、一方信任」的反向取数,泛化为**传输无关的本地数据提供方**,可经三通道服务消费方:① iframe postMessage(现状)② native messaging(浏览器扩展中继)③ localhost 回环。
- 配一个**可分级的 consent/权限模型**:从「一方自动授权」到「任意 Web 源显式配对」。
- **非目标**:不改数据本身、不削弱本地优先、不(在设计阶段)真造扩展。

## 1. 任何 transport 都必须守住的不变量（验收基线）

1. **凭证封闭**:auth token / 跨端同步码 / BYO key 永不跨越能力边界。需要它们的工具在宿主侧执行、只回结果(现状已如此,设为硬规则)。
2. **最小权限**:消费方只看得到被授予的工具(越权 = 工具不存在)。
3. **数据主权**:个人数据留设备;「反向」= 被消费方就地读取,不是上传给厂商。任何跨到 Web 源的 transport 必须显式、限范围、可吊销、按源 consent。
4. **对端认证**:消费方在授权生效前必须先被认证(哪个 origin / 扩展 / app 在问)。
5. **写入边界校验**:写类工具(addBookmark/addSubscription/publish)在边界强制输入校验(参见审计 M-3:`safeHref` + `z.enum`),与 transport 无关。

## 2. 三层抽象

核心洞察:iframe 路径里「能力 / 传输 / 会话授权」三件事糅在 `host.tsx` 里。拆成三层:

```
消费方  (iframe portal | 扩展 content-script | localhost web app)
        │  MCP / JSON-RPC over <transport>
        ▼
[L2 传输]   MessagePort │ NativeMessaging │ Loopback(WS/HTTP)
        ▼
[L3 会话/授权]  认证对端 → 解析 grant → consent 闸 → 限流/限范围   ★新增
        ▼
[L1 能力]   McpServer(只挂 granted) → getFilesPort / getServerPort / auth-store
        ▼
   本地数据(IndexedDB)  +  ServerPort(token 留宿主侧)
```

- **L1 能力层**(**已抽出**,transport 无关):`host.tsx` 里 `new McpServer + registerGrantedTools/Resources` 已抽成工厂 `createLocalMcpServer(grant)`(`local-mcp-server.ts`),据 Grant 起 server;`host.tsx` 仅余 iframe transport 绑定。
- **L2 传输层**(可插拔):`MessagePortTransport`(现有)+ 新增 `NativeMessagingTransport`、`LoopbackTransport`,都实现 MCP `Transport` 接口。
- **L3 会话/授权层**（部分落地）：Grant 已显式表达对端、权限、信任档与过期时间；一方 iframe 的活动连接可见且可立即断开。持久授权、连接前 consent 与第三方配对仍未实现。

## 3. 三种 transport 画像

| 维度 | iframe postMessage(现状) | native messaging（扩展中继） | loopback 127.0.0.1 |
|---|---|---|---|
| 谁是壳 | **ideall 是壳** | 浏览器是壳,ideall App = native host | 浏览器是壳 |
| 对端身份 | iframe origin(`e.source`+`e.origin`+`manifest.origins` 三校验) | 扩展 id +(背后 web origin) | web origin(CORS)+ 配对 token |
| 默认信任 | 一方,自动 | 默认拒绝,需配对 + 按源 consent | 默认拒绝,最弱对端认证 |
| 落地前提 | 已有 | ideall App 注册 native-messaging host manifest | Tauri 起回环服务 |
| 主要威胁 | env 错配把 init 发错源(已有 origins 断言挡) | 恶意/被攻破的扩展冒充 | DNS rebinding / 任意本地进程打 localhost |
| 适合 | 内嵌 portal | 独立 `web.wonita.link` 标签页 | 无扩展时兜底 |

每条 transport 的硬要求:
- **iframe**:维持现有三校验 + token 不出宿主。
- **native messaging**:扩展只是中继(`web 页 ↔ 扩展 ↔ native host ↔ ideall 数据层`);native host 侧仍要认背后的 web origin,不能因「扩展可信」就放行它服务的任意页面。
- **loopback**:必须 ① origin 白名单 ② 一次性配对得到的 capability token(每请求带)③ 防 DNS-rebinding(校验 `Host`/`Origin` 头、绑随机端口、token 高熵)。

## 4. Grant / Consent 模型（核心新设计）

现状:静态 `manifest.permissions` + 一方信任 + 无用户提示。扩到第三方需分级。

**Grant = { consumerId, origin/peer, permissions[], scope, grantedAt, expiry, revocable }**

| 层级 | 对象 | 授权方式 |
|---|---|---|
| **T0 一方** | ideall 自带 manifest 的 portal | 自动,无提示(现状,保留) |
| **T1 已验消费方** | 签名/登记过的消费方 manifest | 用户一次性看权限披露屏后同意(类 OAuth/扩展授权页) |
| **T2 任意源** | 扩展 / loopback 背后的任意 web origin | 逐源显式配对,默认拒绝,读优先,写另需 consent |

Consent 五原则:
1. **默认拒绝**:T0 之外一律不预授。
2. **用户在 ideall 内发起配对**:批准动作起于主权面(ideall),不是 web 页 —— 防恶意站点静默诱导授权。
3. **按消费方 / 按权限 / 可吊销 / 会过期**:ideall 设置里一个「已连接的应用」面板(每个消费方能做什么、最后访问时间、一键撤销)。
4. **读写分离**:读关注 ≠ 以你身份发布。写永远更高门槛 + 边界校验。
5. **敏感能力锁死**:`identity.publish`(以你身份行动)、任何碰 token 的 —— 绝不自动授给非一方;token 永远宿主侧执行。

## 5. 能力面按敏感度分级

把现有工具(`src/plugins/embed/protocol.ts` 的 `TOOL`)按敏感度归档,决定哪层 grant 能用:

| 敏感档 | 工具 | 可用层级 |
|---|---|---|
| 读-个人 | `hub.listSubscriptions` / `hub.isSubscribed` / `identity.me` / `hub://*` 资源 | T1+,需 consent |
| 写-个人 | `hub.addSubscription` / `hub.addBookmark` / `hub.removeSubscription` | T1+,显式写 consent + 边界校验(M-3:safeHref / z.enum 在此变强制) |
| 以用户身份 | `community.publish` / `deletePublication` / `me.updateProfile` | 仅 T0 或强 consent;token 留宿主 |
| 宿主控制 | `host.navigate` / `host.openExternal` | 白名单内(已有 `NAV_ALLOW` / `safeHref`) |

MCP 原生的 `tools/list` / `resources/list` 即「消费方看自己被授了什么」的发现机制,直接用。

## 6. 战略护栏

反向流仍合「本地优先」当且仅当:就地读不上传 + token 不可被带走 + 每个非一方消费方显式 consent 且可撤 + **不偏置**(提供方服务任何配对成功的消费方,而非只服务 wonita —— 否则就是反向供应商锁定,违背 ServerPort 后端可换 / 可自建的初衷)。

接审计:H-1(localStorage 存 token/同步码/key)意味着能力边界绝不暴露这些;M-3(safeHref/枚举)成为写边界强制项;扩展面更要把这些当红线。

## 7. 复用 vs 新建 + 分期

| | 内容 |
|---|---|
| **原样复用** | L1 能力层(`tools.ts` + `protocol.ts` 权限模型)、MCP server、「token 留宿主」铁律、写边界校验 |
| **重构(已做)** | 从 `host.tsx` 抽出 `createLocalMcpServer(grant)`;`host.tsx` 退化为「iframe transport 绑定」之一 |
| **新建** | ~~L3 Grant 模型（类型 + 一方构造 + 过期判定）~~（P1 已做，`grant.ts`）；~~活动连接查看 + 一键断开~~（内存态已做，`connections.ts` / `connected-apps-view.tsx` / 设置页）；**剩余**：L3 Grant/Consent 持久化存储、连接前 consent 与配对流、`NativeMessagingTransport` + Tauri native-host 注册、对外 loopback 服务（origin 白名单 + capability token + 防 rebinding） |

**分期建议:**
1. **P1（最稳、最高杠杆）——✅ 已落地**：已抽 `createLocalMcpServer` + 引入显式 L3 Grant 类型、构造、过期判定和信任档过滤（`grant.ts` + `local-mcp-server.ts` + `grant.test.ts`）。
2. **P2（部分落地）**：运行期“已连接的应用”列表与一键断开已实现，但 Grant 持久化、连接前 consent、T1 配对和外部 transport 尚未实现。内置 Agent 的进程内 loopback 仅复用能力层，不是对外 transport。
3. **P3(谨慎,按需)**:T2 任意源 / 扩展直通 `web.wonita.link`。

## 8. 待拍板的决策点

1. **要不要 T2(任意 Web 源)?** 倾向先不做,封顶 T1。T2 收益(独立标签页直读)抵不过它撞 H-1 凭证面 + 「数据自持」红线的风险,除非有硬需求。
2. **消费方信任根**:T1 的「已验」靠什么 —— manifest 签名?ideall 内置登记表?(影响后端可换性:登记表别只收录 wonita。)
3. **配对 UX**:扩展/loopback 配对走「ideall 内点批准」还是「展示配对码」?
4. **先落哪条 transport**:native messaging(更贴近浏览器插件,但要 native host)还是 loopback(纯 Tauri 起服务,但 rebinding 防护更费神)?

## 关联

- 嵌入桥实现:`src/plugins/embed/`(`host.tsx` / `tools.ts` / `manifest.ts` / `protocol.ts`)。
- 形态约束:[docs/app.md](app.md)(App-only / Tauri / 客户端直连)。
- 后端契约:`@protocol/server-port`(ServerPort,正向取数;与本文「反向供数」对称)。
- 相关审计项:H-1(localStorage 凭证暴露面)、M-3(嵌入写边界 safeHref/类型枚举)。
