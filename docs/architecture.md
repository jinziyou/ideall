# ideall 架构

> 本文是 ideall 的架构权威说明，面向贡献者与集成方。产品定位与上手步骤见 [README.md](../README.md)；App（桌面/移动）打包细节见 [app.md](app.md)；开发约定见 [claude.md](claude.md)。

## 1. 概览

ideall 是**开源、本地优先的个人信息终端**：把分散的他人、信息、资源、工具，从你自己的视角聚合到一处。它**仅以 App 形态分发**——同一套 Next.js 代码经 Tauri 2.0 静态导出后打包为跨平台客户端。

三条核心理念贯穿全部设计：

- **本地优先**：home（笔记/书签/资源/关注/对话）与 tool 的能力存于设备 IndexedDB，离线、无账号即可用。个人数据默认不离开设备。
- **后端可换 / 可自建**：所有后端取数经 `ServerPort` 契约消费。wonita 服务只是默认与参考实现，ideall 不被任何单一后端绑死。
- **零后端即完整产品**：home / tool 本地能力 + 无账号端到端同步 + BYO-key agent，不连任何后端也是一个完整可用的产品；info / community 是连接后端后的增强。

**设计思想：一切皆文件，一切皆标签页**（在上述三条之上的组织/交互层，已落地；历史推导见 [design/archive/ai-native-redesign.md](design/archive/ai-native-redesign.md)）：

- **一切皆文件**（数据组织，借 Linux VFS）：所有本地内容收敛为单一命名空间里的可寻址 `Node` 节点（统一 `STORE_NODES`，按 `kind` 区分 note/bookmark/folder/file/feed/thread），共用同一套树/同步/墓碑原语。
- **一切皆标签页**（UI）：打开任意「文件」即开一个工作区标签页，标签页是按 kind 分派的通用查看器；活动栏「我的」子项是根命名空间（places），侧栏是跨 kind 文件树。
- **AI 是环境层**：AI 经 `fs.*` 工具面（与嵌入页共用同一条 Grant→MCP 能力链路）读写这些节点——文件是它的记忆与工作产物，标签页是它为你物化的视图；个人正文默认不进 AI 上下文（隐私三道闸，见 §6）。

**设计风格：现代 · 面板 · 留白**——面板化的标签工作区（活动栏 / 二级侧栏 / 标签条 / 状态栏 / 命令台），克制的留白与现代质感，不堆砌、让信息呼吸。这套 IDE 式标签工作区是 ideall 自有的设计语言：以「文件 + 标签页」为骨架，把发现、阅读、笔记、对话统一进同一个面板化外壳。

## 2. 领域模型

ideall 的领域类型分两类：**本地拥有**（存 IndexedDB，本机即权威）与**后端供给**（经 `ServerPort` 取数，ideall 用自己的领域词汇定义，见 `src/protocol/server-port.ts`）。

### 2.1 统一 Node 模型（一切皆文件）

全部**本地拥有**内容收敛为单一可辨识联合 `Node`（`protocol/node.ts`），由 `kind` 区分六类，共存于同一个 IndexedDB 对象仓 `STORE_NODES`：

| kind | 域类型（投影后） | 说明 |
| --- | --- | --- |
| `note` | `Note`（+`blockMeta?`） | 笔记；正文为 Plate 块数组，并发合并经块级 sidecar（§6 / [历史设计](design/archive/ai-native-redesign.md) §7） |
| `bookmark` | `Bookmark` | 书签；`folderId` 投影为节点 `parentId` |
| `folder` | `BookmarkFolder` | 收藏夹（书签命名空间内的目录节点） |
| `file` | `StoredFile` | 资源；轻量元数据存节点，原始 Blob 旁存独立 `STORE_BLOBS`（节点持 `blobRef`，不进同步） |
| `feed` | `Subscription` | 关注偏好；**确定性 id** `feed:type:key`，同步边界投影回旧 `"subs"` wire |
| `thread` | `Thread` | AI 对话线程；`messages` 在协议层为不透明 `unknown[]`，本地独占、默认不同步 |

所有节点共用同一套基座字段（`id`/`kind`/`parentId`/`sortKey`/`createdAt`/`updatedAt`/`deletedAt?`）与同一套**树 / LWW 同步 / 软删墓碑**原语。

**投影封在仓库边界**（关键不变量）：每个 kind 有一个 `*-store` 门面（`notes-store`/`bookmarks-store`/`files-store`/`subscriptions-store`/`threads-store`），对内读写 `STORE_NODES` 并按 `kind` 过滤/打标，对外仍暴露原有域类型（`Bookmark`/`StoredFile`/`Subscription`…）。**故 11+ 处消费方（UI / agent / embed）在四步折叠中零改动**。`nodes-store` 是跨 kind 协调层（`listNodeSummaries`/`listNodesRaw`/`getNodeRaw` + create/update/move/delete 按 kind 分派），AI `fs.*` 层即建于其上。

### 2.2 领域类型一览

| 领域概念 | 归属 | 定义位置 | 说明 |
| --- | --- | --- | --- |
| 统一节点 `Node`（note/bookmark/folder/file/feed/thread） | 本地 | `protocol/node.ts` | 全部本地内容的单一可辨识联合；存 `STORE_NODES`，按 kind 投影为下列域类型 |
| 资源 `StoredFile` / 书签 `Bookmark` / 收藏夹 `BookmarkFolder` / 笔记 `Note` | 本地 | `protocol/files.ts` | 「我的」的本地优先实体（节点投影）；文件原始 Blob 旁存 `STORE_BLOBS` |
| 关注 `Subscription` | 本地（偏好）+ 后端（内容） | `protocol/subscription.ts` | 类型为 `publisher`/`entity`/`tool`/`search`/`peer`；**仅关注偏好**存为 `feed` 节点，内容实时拉取 |
| AI 对话线程 `Thread` | 本地 | `protocol/files.ts` | BYO-key AI 智能体；消息内联存于线程节点，经 `FilesPort` 读写（不再由 agent 插件自存） |
| 信息 `Info` / 事件 `InfoEvent` / 实体 `EntityDetail` / 发布者 `Publisher` | 后端 | `protocol/server-port.ts` | info 模块的资讯数据，由后端的采集/NLP/图谱产出 |
| 社区发布者 `PeerPublisher` / 发布 `Publication` | 后端 | `protocol/server-port.ts` | community 的用户发布层 |
| 同步块 `SyncBlob` | 本地派生密文 ↔ 后端不透明存储 | `protocol/sync.ts` | `{ iv, ciphertext, updated_at }`，后端只存密文 |
| 登录会话 `AuthBody` / 当前用户 `CurrentUser` | 后端（账号身份） | `protocol/server-port.ts` | 公开发布身份；与无账号同步码是两套独立身份 |

**两套独立身份**（务必区分）：

- **账号**（公开发布身份）：登录后可在 community 发布，他人关注；走后端 X25519 登录方案。
- **跨端同步码**（无账号）：高熵随机串，在浏览器派生 `storageId` + AES 密钥，只上传密文。

## 3. 模块与边界

### 3.1 五模块（「我的」/「应用」+ 三个发现模块）

home（即「我的」）是本机数据区，apps（应用）是本机已安装应用的启动器；info / community / tool 是三个**发现**模块——它们发现的内容经**关注汇入「我的」**的 `/home/subscriptions` 关注流。

| 模块 | 路由 | 角色 | 是否需后端 |
| --- | --- | --- | --- |
| **home（「我的」）** | `/home`（笔记 / 书签 / 资源 / 关注 / 对话；工作区标签页 + places 侧栏） | 「我的」：本机数据区，本地内容工作区，统一 Node 库 + 一切皆标签页 | 否（本地优先） |
| **apps（应用）** | `/apps` | 本机已安装应用启动器：列举本机已装应用并一键启动（`src-tauri/src/installed_apps.rs` + `src/modules/apps/apps-page.tsx` + `src/lib/installed-apps.ts`） | 否（**Tauri 桌面专属 / 本地模式**，零后端） |
| **info** | `/info`（含 search / entity / publisher / analysis） | 资讯聚合展示：信息流、实体与发布者、关联分析 | 是 |
| **community** | `/community` | 发布者地图、关注与发布（peer 发布层） | 是 |
| **tool** | `/tool`（含 search / ai / navigation） | 工具聚合（搜索 / AI / 导航） | 否（本地外链启动器，历史仅存本机） |

> info/community 的发现 UI 默认以 wonita 应用 iframe 嵌入（经 `ideall-embed-bridge` 协议可换源）；其 ServerPort 取数仍是关注流「汇入我的」的真实路径。home 的**发布（publications）**是本机数据区里的例外：发布为账号身份、依赖后端，与 home 其余本地优先数据（笔记/书签/资源/关注）不同。

> 路由分布：app 路由层只是「开标签」的薄标记（`page.tsx` re-export `@/workspace/open-workspace-tab`），实现各归其层——「我的」的本地数据层在 `src/files/*`、功能 UI 在 `src/modules/home/*`；info/community/tool 的实现在 `src/modules/<name>/*`，由路由薄 re-export。
>
> 活动栏另有两个**工作区级入口，不属五模块**：**浏览器**（`/browser`，连接模式活动栏项，打开 `browser:page:default` Resource 标签并由 `BrowserView` 承载）与 **AI**（`/ai`，活动栏专属 AI 钮 + 右侧常驻对话栏 + ai-* 区段标签，刻意不进 `MODULES`，见 `workspace/modules.ts` 尾注）。二者是工作区 chrome 的一部分，路由同为薄标记。

**一切皆标签页（工作区，`src/workspace/*`）**：打开任意资源即经 `OpenTarget` 落到统一 `kind:"resource"` 工作区标签；`openTarget(resource)` 会通过 VFS 读取 `ResourceMeta` 修正标题、route 与 info/community 嵌入导航。本地内容是 `node` scheme 的 Resource，标签内容由 `resource-engines` + `node-kind-ui` 分派（节点查看器已落地 note/file/bookmark/feed/thread 五个 kind）。水合时会把旧 `kind:"node"`/`browser-view` 持久化标签迁移成 Resource 标签，`registry` 只保留运行时兼容读取。浏览器资源由 `BrowserView` 承载（原生子 webview，`src/workspace/browser-view.tsx` + `src-tauri/src/browser_linux.rs` + `src-tauri/capabilities/browser.json`）。深链优先用 `?resource=<ResourceRef>`，继续兼容旧 `?node=kind:id`。活动栏「我的」子项是**根命名空间**（places：笔记/书签/资源/关注/对话），侧栏是基于泛型 `buildTree<T extends TreeItem>` 渲染的**跨 kind 文件树**（书签/收藏夹支持拖拽重排），本地与连接模式动态子项都从 VFS `ResourceMeta` 构造并通过 `watchResources()` 失效缓存。本机内容搜索按输入通过 VFS `listResources()` 查询，文件元数据修改/删除和书签树移动通过 VFS action。实现现收于 `src/workspace/tree/`（`sidebar-tree.tsx` / `sidebar-tree-data.ts` / `sidebar-tree-node-branch.tsx` / `sidebar-tree-bus.ts` / `draggable-node-forest.tsx`）。`NODE_KIND_MODULE` 把全部本地 kind 归 `home`（「我的」）。

### 3.2 本地能力 vs 需后端能力

- **本地能力（零后端可用）**：home 的书签/资源/关注偏好、tool 的本地功能、跨端同步、BYO-key agent。数据存 IndexedDB，离线无账号。
- **需后端能力**：info 的资讯/实体/分析、community 的发布者地图与发布、关注流的内容拉取、账号鉴权。全部经 `ServerPort` 消费。

### 3.3 抽象层：终端分层（`src/` 下）

`src/` 已按「个人信息终端」的语义分层重组——路由层只剩「开标签」的薄标记，外壳、工作区、数据层、功能模块、插件、契约各成一层，契约纯端口独立成 `protocol`。

| 层 | 别名 | 内容 |
| --- | --- | --- |
| **app** | `@/app/*` | Next 路由层——仅「开标签」薄标记：`page.tsx` 几乎全是 re-export `@/workspace/open-workspace-tab`（唯一例外 `app/auth/page.tsx`：独立登录页，直接渲染 `@/shell/auth-form`），外加根 `layout`/`error`/`loading`/`not-found` + `globals.css`（`@/app/globals.css`）。 |
| **shell** | `@/shell/*` | 终端外壳——命令台 / header / bottom-tab-bar / 主题（theme/theme-applier）/ account / mobile-nav / nav-config，加 `boot`（组合根，**唯一**允许 import 各 manifest 处）/ `boot-gate`（启动闸）。 |
| **workspace** | `@/workspace/*` | 一切皆标签页——`tab-host`（keep-alive 多标签）/ `registry`（resource 与静态面板渲染）/ `resource-tab` / `resource-engines` / `store` / `viewers`（按 kind：note/file/bookmark/feed/thread）/ `modules`（模块配置单一真相源）/ `node-ref` / `tree/`（跨 kind Resource 文件树：`sidebar-tree` / `sidebar-tree-data` / `sidebar-tree-node-branch` / `sidebar-tree-bus` / `draggable-node-forest`；根命名空间 places 概念）/ `local-search-items`（⌘K 统一面板的 VFS 本机内容源），以及活动栏 / 二级侧栏 / 标签条 / 状态栏 4 件 IDE chrome。 |
| **vfs** | `@/vfs/*` | Resource VFS 挂载层——`registry` 分派 `node/info/community/tool/browser/app` provider；`node-provider` 包装统一 Node 库并保留隐私/权限闸；`connected-providers` 通过 `connected-resource-manifest` 暴露连接模式 route/title/capability，并把本地书签列为 browser bookmark 资源；`node-actions` / `node-file-actions` 提供 UI action 输入映射；`save-to-mine-projector` 把远端资源幂等投影为关注或书签；provider watch 按 query 粒度驱动显示缓存失效。 |
| **files** | `@/files/*` | 一切皆文件——统一 Node 数据层。`stores/`（各 kind store + `nodes-store` 跨 kind 协调层）；顶层 Node 原语：`note-blocks` / `sort-key` / `notes-tree-util` / `note-write-queue` / `flowback` / `feed-node`（关注↔feed 节点投影）/ `files-port`（FilesPort 实现）/ `bookmark-import`。 |
| **modules** | `@/modules/*` | 功能模块——`home`（「我的」：本机笔记/书签/资源/关注/对话的功能 UI = overview/notes/bookmarks/resources/publications/subscriptions）/ `info` / `community` / `tool` / `apps`（本机已安装应用启动器，Tauri 桌面 / 本地模式）。 |
| **plugins** | `@/plugins/*` | 插件——`agent`（AI 环境层，BYO-key）/ `sync`（跨端 E2E 同步）/ `embed`（嵌入页 + AI 共用的 Grant→`createLocalMcpServer` 能力链路）/ `code` / `git` / `shell` / `audio` / `database`；公共插件数据能力在 `plugins/shared`。 |
| **protocol** | `@protocol/*` | 契约 / 端口（纯类型 / 纯函数，**不含 UI**）：`node`（统一 Node 联合 + `stripNode`）/ `files`（FilesPort + 投影域类型 Note/Bookmark/StoredFile/Subscription/Thread）/ `note-merge`（块级合并纯代数）/ `subscription` / `content`（解析注册表）/ `flowback` / `sync`（SyncPort）/ `server-port`（ServerPort）/ `peer` / `auth`。 |
| **ui** | `@/ui/*` | shadcn 原语 + 块编辑器（`editor/`）。 |
| **shared** | `@/shared/*` | 跨层共享 UI + 关注反馈（`feeders/`：save-to-mine / subscribe-button / pin-tool-button）。 |
| **lib** | `@/lib/*` | 纯工具——utils / format / idb / id / sync-crypto / auth / api（wire DTO 生成物）/ server（HTTP 适配器）/ ui-actions / active-node / safe-url / theme / env / tauri / updater / installed-apps（本机应用 Tauri 命令封装）/ egress-guard（agent 出站 SSRF 守卫）/ acp-transport（ACP 传输桥）… |

> 别名：`@/*` → `src/*`；`@protocol/*` → `src/protocol/*`（其余层一律 `@/<layer>/...`；app 路由用 `@/app/*`、`@/app/globals.css`）。

**端口模式**：每个跨模块契约都是「端口 + register/get」。模块经 protocol 间接协作——逻辑与数据交互须经 protocol 端口，模块间不直连业务逻辑；视图挂载是显式例外：workspace/registry 与 viewers 会经白名单注册直接挂载 plugin 视图（EmbedHost、AgentPanel、thread-viewer 等）。

- **内容 feed**：关注流调 `@protocol/content` 的 `resolveSubscription`；info/community 在各自 `manifest.ts` 注册 resolver（info 管 publisher/entity/search，community 管 peer）。
- **「我的」数据**：反馈组件、agent 插件与 AI `fs.*` 层经 `@protocol/files` 的 `getFilesPort()`（FilesPort，「我的」在 boot 注册实现）读写笔记/关注/书签/资源/线程，不直接依赖底层存储。FilesPort 已扩出节点级 `fsListNodes/fsGetNode/fsCreateNode/fsUpdateNode/fsMoveNode/fsDeleteNode/fsReadBlob` + 线程方法。
- **跨端同步**：同步面板调 `@protocol/sync` 的 `getSyncPort()`；sync 插件 manifest 注册 SyncPort。
- **后端取数**：所有信息/发布/鉴权取数经 `@protocol/server-port` 的 `getServerPort()`（ServerPort）。
- **UI 动作 / 活动节点**（守 plugins↛shell/workspace 边界）：插件经 `@/lib/ui-actions`（`UiActions`：开/关标签）与 `@/lib/active-node`（当前激活标签→`NodeRef`）两个端口与工作区交互，外壳在 boot 注入实现、插件只消费。

### 3.4 AI `fs.*` 层（一切皆文件的 AI 侧）

AI 不再持专有工具，而是经一套**文件系统语义**的 MCP 工具面 `fs.*`/`ui.*` 读写统一 Node 库——与嵌入页（embed）共用同一条 **Grant→MCP** 能力链路（`src/plugins/embed/*`）：

- **能力链路**：`createLocalMcpServer(grant, ctx)` 据 `grant.permissions` 注册工具；权限位 `fs:read`/`fs:write`/`fs.notes:read`/`fs.notes:write`/`fs.blobs:read`/`ui.tabs`/`web:search`/`web:fetch`（定义于 `src/plugins/embed/protocol.ts` 的 `PERMISSIONS`）。工具：`fs.list`/`fs.read`/`fs.readBlob`/`fs.create`/`fs.write`/`fs.move`/`fs.delete` + `ui.openTab`/`ui.closeTab` + `web.search`/`web.fetch`（出站联网面），资源 `fs://nodes`。**web 出站**统一经 `@/lib/web-search` 的 `guardedFetch`，再经 `src/lib/egress-guard.ts` 的 SSRF/出站守卫（仅 https、拒私网/userinfo/伪协议、IP 字面量拦截；红队向量由 `egress-guard.test.ts` 锁死）。
- **agent→MCP 回环**：agent 插件经 `agentGrant`（`fs:read`/`fs:write`/`fs.notes:write`/`ui.tabs`/`web:search`/`web:fetch`，**无 `fs.notes:read` / `fs.blobs:read`**——既存正文与上传文件二进制默认不可见）→ `createLocalMcpServer` → `createLoopbackTransports`（本进程 MessageChannel + 复用的 `MessagePortTransport`）→ `agent-mcp.ts`（`connectAgentMcp`：tools/list→OpenAI 工具、callTool、`summarizeTool` 中文回执）。即 agent 与嵌入第三方走同一套受限工具面，无特权旁路。
- **对话即文件**：当前激活标签经 `active-node` 端口注入为隐式上下文（`gatherReferencedContext`），宿主对激活 note/thread 的全量读 = 用户隐式同意，授权集不变。
- **隐私三道闸**：见 §6 第 9 条。

**ServerPort ↔ HTTP 适配器**：ServerPort 是 ideall 自有领域类型定义的端口（`src/protocol/server-port.ts`），**不依赖** wonita 服务的 wire DTO。默认实现是 `lib/server/http-adapter`（对接 wonita 服务的 HTTP API），是**唯一** import openapi 生成类型（`@/lib/api/server`）的地方——wire→domain 的映射与漂移门收敛于此。ServerPort 是**同构端口**（SSR 预渲染期也取数），故 `getServerPort()` 默认回退该 HTTP 适配器；App / 嵌入式 / 局域网节点 / 测试可经 `registerServerPort()` 覆盖——**这是后端可换 / 可自建的技术支点**。

**组合根**：`shell/boot.ts#registerAll()` 是唯一允许 import 各 manifest 的地方，由客户端启动闸 `boot-gate.tsx`（挂在根 layout）调用一次，幂等注册全部端口实现。

### 3.5 外部 agent（ACP）与外部 MCP / OAuth 子系统

「BYO-key → OpenAI 兼容端点」只是 agent 的**若干后端之一**。除内部 loopback MCP（§3.4）外，agent 还接了一套完整的外部互操作子系统（依赖官方 `@agentclientprotocol/sdk`）：

- **ACP 双向**（Agent Client Protocol，实现收于 `src/plugins/agent/lib/acp/`）：
  - **反向驱动外部 CLI agent**：把系统已装的外部 agent（经 `acp-detect.ts` 在 PATH 上探测、点选即用）当作后端驱动——`acp-client.ts` / `acp-agent.ts`（纯映射，可单测）+ `acp-chat.ts` 接对话回合。
  - **把 ideall 经 ACP 暴露给编辑器**：`acp-expose.ts`（把内核 `runAgent` 接成 ACP 智能体；headless，仅用 home 标题快照，不注入"当前查看节点"）；`shell/boot.ts` 在桌面 + 用户开启 `allowEditorConnect` 时**自启动监听**（`autostartAcpServerFromSettings`）。
  - **传输**：JS 侧 `src/lib/acp-transport.ts` ↔ Rust 侧 `src-tauri/src/acp_transport.rs`（TCP / 哑管道）；状态与设置见 `acp-status.ts` / `acp-settings.ts`（`AcpRunContext` 类型定义在 `acp-expose.ts`）。
- **外部 MCP**（`agent-mcp.ts` / `agent-mcp-registry.ts` / `agent-mcp-stdio.ts`）：除本进程 loopback MCP 外，还支持 `stdio`（本地命令）/ `SSE` / `Streamable-HTTP` 三种外部传输接外部 MCP server（`McpTransport`）。
- **OAuth 回调**：外部 MCP / agent 的 OAuth 授权码经本机 loopback 回调（`src-tauri/src/oauth_callback.rs`）落地，token 经 `agent-oauth` 持久化（仅存本机）。

> 与内部 loopback MCP 一致，外部 agent / MCP 仍走 `fs.*`/`ui.*`/`web.*` 受限工具面，无特权旁路。这些外部子系统多为 Tauri 桌面能力，纯浏览器 dev 态降级或不可用。

## 4. 数据流

```
                          ┌─────────────────────────────────────────────┐
                          │            ideall App (Tauri webview)         │
                          │                                               │
   本地优先 (零后端)  ┌───┤  home/tool ──► FilesPort ──► IndexedDB        │
   ───────────────   │   │   统一 Node 库 STORE_NODES + Blob 旁存 STORE_BLOBS│
                     │   │   (note/bookmark/folder/file/feed/thread, 明文不上传)│
                     │   │                                               │
                     │   │  agent (BYO key) ─fs.*/ui.* MCP→ Node 库       │
                     │   │     │ Grant→createLocalMcpServer→loopback      │
   BYO-key agent ────┘   │     ▼                                          │
                         │  agent ──► OpenAI 兼容端点 (key 仅存本地)       │
                         │     └─ App: tauri-plugin-http (Rust 侧) 绕 CORS │
                         │        web: 标准 fetch (受厂商 CORS 限制)       │
                         │                                               │
   需后端 (经契约) ──────┤  info/community ──► getServerPort()            │
                         │        │ 默认 HTTP 适配器 (唯一 import wire DTO) │
                         │        ▼                                       │
                         │   registerServerPort() 可覆盖 ◄─ 可换后端支点  │
                         │                                               │
   E2E 同步 (无账号) ────┤  sync 面板 ──► SyncPort ──► sync-crypto         │
                         │     同步码 ─派生→ storageId + AES 密钥          │
                         │     仅上传密文 SyncBlob {iv, ciphertext}        │
                         └───────────────┬───────────────────────────────┘
                                         │ HTTPS (NEXT_PUBLIC_SERVER_ADDR)
                                         ▼
                          ┌──────────────────────────────────────┐
                          │  ServerPort 实现 (默认 wonita 服务)    │
                          │  采集/NLP/知识图谱/鉴权/同步块存储      │
                          │  仅存同步密文 (读不到明文)             │
                          └──────────────────────────────────────┘
```

四条数据流：

1. **本地 IndexedDB（统一 Node 库）**：home/tool 经 FilesPort 读写**单一对象仓 `STORE_NODES`**（六类 kind 节点）+ 旁存 `STORE_BLOBS`（`{key,blob}`，文件原始字节，不进同步）。跨多仓的原子写经 `idbPutAcrossStores`（防孤儿 Blob）；`onupgradeneeded` 仅建仓、零 I/O。明文不上传。
2. **经 ServerPort 直连后端**：info/community 经 `getServerPort()` 取资讯/发布/鉴权数据；客户端直连后端 API（`NEXT_PUBLIC_SERVER_ADDR`），需后端放行 CORS。
3. **E2E 同步只传密文**：同步码在浏览器派生 `storageId` + AES 密钥，本地 AES-GCM 加密后上传 `SyncBlob`，后端不透明存储、读不到内容。关注/书签等按 LWW 并集合并（`unionMerge` + 软删墓碑 + 过期 GC）；**笔记走块级合并**——整篇删除走 node 级 LWW（`deletedAt`），正文走块级 `mergeNoteContent`（per-block `(v,by)` 取胜 + `(sk,id)` 排序，跨端并发改不同块无损），块墓碑 GC 独立一步。`feed` 节点在同步边界投影回旧 `"subs"` wire，关注同步协议一字未改。
4. **BYO-key agent 经 fs.* MCP 读写 + Tauri 绕 CORS**：agent 经 `agentGrant`→`createLocalMcpServer`→loopback MCP 客户端（`agent-mcp.ts`）以 `fs.*`/`ui.*`/`web.*` 工具读写 Node 库 / 联网（与嵌入第三方同一受限工具面；web 出站经 `egress-guard` SSRF 守卫），再直连用户配置的 OpenAI 兼容端点。key 仅存本地；在 App（Tauri）内经 `tauri-plugin-http`（Rust 侧请求）绕过 webview CORS，可直连任意云厂商端点；纯浏览器调试时用标准 fetch，受厂商 CORS 限制（本地 Ollama / 放行 CORS 的端点可用）。**OpenAI 兼容端点只是若干后端之一**：agent 亦可经 ACP 反向驱动外部 CLI agent、或把 ideall 经 ACP 暴露给编辑器，并可接 stdio/SSE/Streamable-HTTP 外部 MCP（见 §3.5）。

## 5. 技术选型与权衡

| 选型 | 取舍 |
| --- | --- |
| **Next.js 静态导出（`output: export`）** | 生产构建一律静态导出到 `out/`，无 Node 运行时、无 SSR 生产服务端。`pnpm dev` 的 SSR 仅作开发服（供 Tauri 壳加载）。 |
| **Tauri 2.0 打包** | Rust 外壳包裹 Web 前端，单代码库覆盖 Windows/Linux/macOS 桌面 + iOS/Android 移动。`tauri-plugin-http` 让 App 内 agent 绕 CORS。 |
| **App-only、无 SSR 生产端** | iOS/Android 与离线桌面 App 不能跑 Node 服务器，故采用静态导出 + 客户端经 ServerPort 直连后端（CORS + JWT）。代价：路由不可用 Server Actions / Route Handlers / 请求时 `headers()` / 动态路径段——动态信息一律客户端取数，动态路由改查询参数（如 `/info/entity?label=&name=`）。 |
| **端口 + 组合根的依赖反转** | 模块互不直连，全部经 protocol 端口；新增 app/plugin 只需建 manifest 并在 boot 注册。代价：多一层间接。 |
| **wire DTO 与领域类型分离** | openapi 生成类型仅 HTTP 适配器可见，业务/protocol 用 ServerPort 领域类型。换后端只需换适配器，业务代码零改动。 |

## 6. 关键不变量与约束

这些不变量是产品主张的技术兑现，违反即破坏定位：

1. **后端可换 / 可自建**：业务代码只依赖 `ServerPort` 领域类型，绝不直连某个具体后端。`registerServerPort()` 是替换点。
2. **个人数据默认不上传**：home/tool 本地数据存 IndexedDB，仅在跨端同步（密文）或主动发布时才经后端。同步只上传密文，后端读不到明文。
3. **协议纯度**（ESLint 强制）：`protocol/` 只可依赖 `@/lib` 纯工具，**不得** import UI 或页面代码。
4. **wire DTO 边界**（ESLint 强制）：openapi 生成类型（`@/lib/api/server`）**仅** HTTP 适配器（`lib/server`）可 import；protocol 与业务代码一律用 ServerPort 领域类型。
5. **依赖方向**（惯例 + 部分 ESLint 强制）：app 路由层不可被反向 import；info/community/tool 三应用互不 import；跨模块交互一律经 `@protocol`。插件需触达工作区时只经 `ui-actions`/`active-node` 端口（外壳注入），不反向 import 外壳 / 工作区。
6. **两套身份隔离**：账号（公开发布）与无账号同步码互不耦合。
7. **零后端可用**：home/tool/同步/agent 不依赖后端可用性，必须始终能离线工作。
8. **统一 Node 库的投影封边界**（一切皆文件）：所有本地内容存单一 `STORE_NODES`，节点↔域类型投影**只在各 `*-store` 门面内**发生，消费方仍见原域类型。`onupgradeneeded` 仅建仓、**绝不做 I/O**。
9. **AI 隐私三道闸**（个人正文默认不进 AI 上下文）：(a) 自动注入上下文只取**标题**（`gatherHomeContext`/snapshot title-only）；(b) `fs.list` 一律经纯 `stripNode` 剥除 note 正文与 thread 会话；(c) `fs.read`/资源点 note/thread 须二次持有 `fs.notes:read`，否则返 `consent-required (-32003)`。agent 授权集（`agentGrant`）**不含 `fs.notes:read`**——正文仅在用户打开的活动标签（隐式同意）经 `gatherReferencedContext` 注入；写工具的回执经 `sanitize` 剥正文（防 write-only 消费方回读）。入站远端笔记经 `isValidRemoteNote` 校验（拒 null content 元素 / 脏 blockMeta，防一条投毒项瘫痪全端同步）。
10. **笔记块级合并的零丢数据**（不上 Yjs）：`mergeNoteContent` 为纯 join——交换/结合/幂等、不丢任何块 id、过期墓碑也不丢（GC 是独立一步）。块 id 确定性生成（两端独立迁移同一笔记得同 id）。**取舍**：`updateNote` 以「存量」而非编辑器 mount-base 为 diff base，故纯本地「AI+用户同笔记并发」未完全防夹击；跨端多设备（主场景）由 notes-sync 块级合并完整保障。两边都缺 `blockMeta`（旧端/旧记录）时回退整篇 LWW 兜底，绝不重建出空正文。

## 7. 部署 / 分发形态

ideall 仅以 App 形态分发（Tauri 工程在 `src-tauri/`）：构建期 `next build`（`output: export` → `out/`），再由 Tauri 打包。

| 平台 | Tauri 目标 | 构建机要求 | 产物 |
| --- | --- | --- | --- |
| Linux | desktop | Linux + webkit2gtk | `.deb` / `.rpm` / `.AppImage` |
| Windows | desktop | Windows + WebView2 | `.msi` / `.exe`（NSIS） |
| macOS | desktop | macOS + Xcode CLT | `.dmg` / `.app` |
| iOS | mobile | macOS + Xcode | `.ipa` |
| Android | mobile | JDK + Android SDK/NDK | `.apk` / `.aab` |

桌面发布走 GitHub Releases（含 `tauri-plugin-updater` 自动更新）；移动走 App Store / Google Play。完整方案、CI、签名与路线图见 [app.md](app.md)。

## 8. 文档导航

- [README.md](../README.md) — 产品定位、模块表、快速开始、连接后端、App 打包、API 类型同步。
- [design/archive/ai-native-redesign.md](design/archive/ai-native-redesign.md) — 已落地的 AI 原生重设计历史稿：统一 Node 模型、四步折叠、墓碑、一切皆标签页 UI、`fs.*` AI 层与隐私三道闸、笔记块级合并的完整推导与雷区清单（本文 §2/§3.4/§6 已吸收落地结果）。
- [design/archive/resource-vfs-refactor.md](design/archive/resource-vfs-refactor.md) — 已落地的 Resource/VFS 重构历史稿：ResourceRef、Provider、OpenTarget、Engine、权限隐私与迁移兼容策略。
- [app.md](app.md) — App（桌面/移动）方案、平台矩阵、CI、签名与分阶段路线图。
- [scripts.md](scripts.md) — 本地验证、冒烟、API codegen、发布与脚本维护入口。
- [claude.md](claude.md) — 仓库结构与开发约定（贡献者必读）。
- [.github/SECURITY.md](.github/SECURITY.md) — 安全策略与漏洞报告（含同步加密关注点）。
