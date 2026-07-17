# ideall 扩展模型（Extension Model）

> 本文是 ideall「可添加的扩展」的权威概念模型：用户/三方能往终端里加什么、各落在哪条轴、与现有架构如何挂钩。
> 落地机制（动态注册 / 安装路径）见 [extension-registry-design.md](extension-registry-design.md)。
> 关联：[architecture.md](architecture.md)（终端分层）、[ideall-embed-bridge.md](ideall-embed-bridge.md)（嵌入桥 + MCP 能力契约）。

## 0. 两条公理（一切扩展都挂在它们上）

ideall 已把扩展性因式分解成两条既有轴，**不要另起平铺的「扩展类型」清单**：

1. **一切皆文件 / 一切皆标签** —— 各来源通过 FileSystem 挂载为稳定 `FileRef`，打开文件时由匹配的 Engine 生成工作区标签；旧 Resource/OpenTarget/Node viewer 只保留在兼容边界。
2. **MCP 是统一能力总线** —— 一切「可被调用的能力」收敛为本地 MCP server 上的 tool/resource/prompt。唯一工厂 `createLocalMcpServer`（`src/plugins/embed/local-mcp-server.ts`）同时被 **agent**（进程内 loopback，`agent-mcp.ts`）和**嵌入页**（iframe MessagePort，`host.tsx`）消费，共用同一份 `tools.ts` 注册面与 `PERMISSIONS` 联合（`src/plugins/embed/protocol.ts`）。

## 1. 扩展的三条一等轴 + 一条横切轴

| 轴 | 是什么 | 挂在哪个现有原语 | 有无 viewer |
| --- | --- | --- | --- |
| **A. 能力源 Capability** | 给 agent / 嵌入页经 MCP 调用的能力 | `createLocalMcpServer` + `PERMISSIONS` + `Grant` | 无（不开标签） |
| **B. 表面 Surface** | 用户打开成工作区标签来看的视图 | FileSystem + Engine/renderer；静态嵌入页保留 `REGISTRY` 兼容入口 | 有 |
| **C. 端口后端 Port** | 换掉某个后端实现（同步 / 存储 / 鉴权 / 取数 / feed） | `@protocol/*` 的 `register*/get*` 端口 | 无 |
| **（横切）信任层 Trust** | 叠在能力/表面之上，**永不进类型枚举** | `GrantTier`（`grant.ts`）first-party / verified / any-origin | — |

> 目标模型允许轴 A/B/C 对外扩展，但当前落地面不同：外部 MCP 已可配置，可信 Runtime Extension 可组合贡献 FileSystem + Engine；端口层已有 `register/get` 替换点，但尚不是统一的用户安装市场。轴 C 仍按数据暴露面分信任档——`ServerPort`/`SyncPort` 可换，`FilesPort`（本地明文）只适合自托管/高级集成。历史取舍见 [extension-registry-design.md §2.4](extension-registry-design.md)。

**轴 A「能力源」有三个 MCP 原语面，别只暴露其一：**

| 能力面 | = 用户口中的 | 现状 | 落地 = |
| --- | --- | --- | --- |
| **Tools**（确定性 handler） | `tool`（如 JSON 格式化） | 已实现（`tools.ts`；近纯例 `host.toast`） | 加一个 Permission + 一条 `server.tool` |
| **Prompts**（AI 工作流 / 模板） | `skill` | **agent 侧前身已落地**（`src/plugins/agent/lib/agent-skills.ts` `BUILTIN_SKILLS`，agent 面板「技能」入口）；MCP-Prompts 形态仍未实现 | MCP 形态待跨进程消费方（iframe/出站 MCP）时补 `server.prompt`，与前身共享数据源 |
| **Resources**（只读可枚举数据） | 宿主数据资源 | 已实现（`identity://me`、`hub://*`、`fs://nodes`） | 加一个 Permission + 一条 `server.resource` |

> 能力面再叠一条**传输/方向**子轴：进程内 loopback（agent）/ iframe（嵌入页）/ **外部 MCP server**（ideall 作 client，已支持 stdio、SSE 与 Streamable HTTP）。`mcp` 不是一个并列文件类型，而是能力总线上的外部来源方向。

**轴 B「表面」按承载方式区分，冻结程度不同：**

| 表面 | = 用户口中的 | 承载 | 冻结程度 |
| --- | --- | --- | --- |
| **文件/应用表面** | `plugin`、带数据的 App | FileSystem provider + Engine descriptor/renderer；可信运行时组合贡献可原子安装与卸载 | **已解冻宿主注册；桌面官方签名包发现、验证与进程外 MCP connector 已落地** |
| **嵌入站点**（无本地数据落库） | `webpage` / iframe app | `EmbedHost + Manifest + Grant`；普通网页走 bookmark / `BrowserView` | **受 manifest 与 Tauri CSP 约束** |
| **core Node 类型** | 笔记、看板等 core 领域数据 | `NodeKind` + 隐私分类 + 同步策略 | **硬**；多数新来源应优先独立 FileSystem，不必扩 NodeKind |
| 原生应用 | `application` | `third-party.installed-apps` FileSystem + Engine + `launch` action | **启动链路已落地；内部数据仍需单独授权 provider** |

## 2. 你提的 6 类如何归位

| 你的类型 | 裁定 | 映射到现有 | 动作 |
| --- | --- | --- | --- |
| **mcp** | 🔴 层级错位 | 是**能力总线本体**（`createLocalMcpServer`），非清单一项 | 不作类型；外部源称「远程能力源」 |
| **tool** | 🟠 归并 + 改名 | MCP Tools 的纯 handler 子集 | 折叠进能力轴（确定性端）；**改名**（`utility`/`transform`） |
| **skill** | 🟠 归并 | Agent Skills 已落地；跨进程标准形态对应 MCP Prompts | 折叠进能力轴（AI 端）；补 `server.prompt` 时复用同一数据源 |
| **plugin** | 🔴 已存在 + 改名 | `EmbedHost` 嵌入应用，或 Runtime Extension 的 FileSystem + Engine 组合贡献 | 按是否拥有数据选择「嵌入应用」或「文件/应用表面」 |
| **webpage** | 🟠 归并 | 嵌入表面降级端 / `bookmark` / `BrowserView` 三处已覆盖 | 并入「嵌入站点」+ `connected` 布尔 |
| **application** | 🟢 保留 + 改名 | 已安装 App 已有 FileSystem + Engine + launcher；App 内部数据尚需专用 connector | 改名 `native-app`；不要为启动器新增 Node kind |

## 3. 两个反直觉但硬性的约束

1. **`plugin` 与 `webpage` 不能在未来的「添加站点」流程中靠用户预选。** 一个站点是否实现 ideall 协议，需要通过运行期握手确认（`host.tsx` + `bridge §14`）。当前宿主只加载随包的 info/community manifest，尚未提供任意站点添加与 `connected` 持久落档；未来实现时应让用户添加站点，再由握手结果区分嵌入应用与普通网页。
2. **「能力」与「表面」不是干净二分。** 三类扩展同时落两边，模型必须显式允许「一个扩展既是能力又是表面」：
   - 双向嵌入应用（既开标签、又向 agent 暴露 tools —— 文档「双向」意图，今天的桥是单向：ideall 永远是 server）；
   - 带 UI 面板的确定性工具（JSON 格式化器要 textarea + 输出视图）；
   - 本地原生应用同时暴露 MCP（Ollama / 本地 DB via stdio）。

## 4. 命名保留字（避免撞名，实证）

| 禁用作类型名 | 因为已占用 | 改用 |
| --- | --- | --- |
| `tool` | ① `src/modules/tool` 发现模块（搜索/AI/导航，link-out）② `SubscriptionType 'tool'`（关注类型）③ MCP `server.tool` 动词 ④ `/tool/*` 路由 + `tool-*` kinds | `utility` / `transform` / 算子 |
| `plugin` | `src/plugins/*`（agent/sync/embed 内部机器，boot 硬编码）+ 中文「插件」 | 「嵌入应用 / embed app」 |
| `application` | `src/app/` Next 路由层 + 「嵌入应用」+「三应用」 | `native-app` / 原生应用 |
| `mcp`（作类型） | 与「MCP = 统一总线」同名打架 | 「远程能力源 / external capability」 |

## 5. 已存在 vs 仍需宿主集成（详见设计文档）

- **已落地**：嵌入应用（`EmbedHost`）、外部 MCP client、Skills、bookmark/BrowserView 轻量网页、MCP 总线、Resources 面、`GrantTier` 信任轴，以及本机应用的 FileSystem + Engine + `launch` action 链路。
- **运行时信任与生命周期闭环已落地**：`RuntimeExtensionCatalog` 对 package 强制执行宿主注入的 `discover -> verify -> consent/restore -> activate`，再用一次性内存 permit 调用 `RuntimeExtensionRegistry` 原子安装 FileSystem 与成对的 Engine descriptor/renderer。全局 Catalog 通过 `configureRuntimeExtensionTrustHost` 在首次 package 验证前一次性绑定 verifier，不允许运行中替换信任根；未配置时 fail closed。卸载、撤销和 factory 移除会 abort 在途激活、等待生命周期 disposer、逆序注销贡献；失败资源进入可诊断、可重试的 quarantine。
- **持久 consent 已落地，但持久化不是代码加载器**：严格 v2 公开快照只保存 `{ id, version, digest, permissionDigest, consentReceipt }`；hydrate 不执行 factory，也不把 receipt id 当信任。桌面 App 的缺省 consent authority 把完整、逐字段绑定的 receipt 写入系统凭据库，写后读回成功才授权，Web 环境不会降级到 `localStorage`。并发授权只签发一次；授权中途卸载会删除迟到凭据。撤销先停止运行时，再删除凭据；凭据库故障时保留最小 receipt 引用并进入“撤销待重试”，不会重新激活或允许普通卸载。
- **权限与包管理操作面已落地**：设置页展示来源、publisher 指纹、权限、验证方/时间、授权、健康度、失败、待清理资源和可回滚版本；桌面端可安装/更新签名 envelope、核对并导入第三方 publisher 根、导入签名撤销清单、撤销根信任、回滚与物理卸载。代码安装不等于授权，新版本不会继承旧 consent；mandatory builtin 不显示不可兑现的操作。
- **桌面多 publisher 发行链已落地**：Rust 从固定 App 数据目录发现严格 JSON 清单，官方包使用内置 Minisign 根，第三方包按 publisher 绑定用户确认的独立根；manifest、connector SHA-256、publisher 状态和累积撤销清单在 discover/verify/spawn 三处复验。connector 在清理环境的进程外运行，拒绝项不会进入 Catalog。格式与非沙箱边界见 [runtime-extension-packages.md](runtime-extension-packages.md)。
- **connector 数据与动作映射已落地**：已授权签名包按 manifest 权限挂载独立 `runtime-extension.<id>` FileSystem；资源与工具使用不透明 FileRef，授权 metadata 进入统一搜索但 URI/正文不建索引，工具经带风险确认的通用 FileAction 与副作用前耐久审计调用。当前不会自动把该 mount 授予 Agent/iframe，也不会把外部 JavaScript 加载进 webview。
- **联网发现客户端已落地**：桌面设置通过 Settings FileSystem 显式刷新固定官方 Registry；Rust 对签名信封的原始 payload 逐页验签，限制游标链、页数、条目数、有效期与 HTTPS 包地址，并原子缓存原始签名页。离线只回退到每次重新验签的缓存，过期状态会明确显示。目录条目只能打开签名包地址；安装仍走本机 envelope 的完整复验和逐扩展 consent。固定端点当前尚未部署签名 feed（探测为 HTTP 404），端到端上线仍需服务端发布。
- **publisher 计划轮换已落地**：第三方根通过当前/下一密钥对同一 payload 的双签名、单调序列、候选二次复验和永久退役指纹集合保持 publisher ID 轮换；轮换会先停止并撤销旧签名扩展授权，不兼容旧密钥包。该机制不承担已泄露当前密钥的恢复。
- **Registry 更新事务已落地**：已安装扩展可从重新验签且未过期的目录安全下载更高版本；Rust 对下载域名做解析、非全局地址拒绝与 IP 钉连，并绑定包 SHA、publisher、manifest 摘要、版本和权限。设置页先展示权限差异，确认后停止旧版本、撤销旧 consent、原子安装并保留一个回滚副本；取消和失败都会清理临时包。
- **生产 Feed 发布链已实现、待激活**：ideall 以现有 updater 根在 Actions 中生成确定性分页信封，经 staging Release 原子切换固定通道；Wonita 服务端 PR 只代理并缓存公开签名资产，不接触私钥。首次 Release、服务端合并部署和真实端点验收尚需外部发布权限完成。
- **仍属于后续 R3**：独立离线恢复根支持。当前不做后台静默检查或安装。任意第三方 App 的内部数据仍必须由对应 provider 在平台授权范围内暴露。

落地路径见 **[extension-registry-design.md](extension-registry-design.md)**。
