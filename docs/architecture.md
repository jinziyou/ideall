# ideall 架构

> 本文是 ideall 的架构权威说明，面向贡献者与集成方。产品定位与上手步骤见 [README.md](../README.md)；App（桌面/移动）打包细节见 [app.md](app.md)；开发约定见 [claude.md](claude.md)。

## 1. 概览

ideall 是**开源、本地优先、供应商中立的个人信息工作台**：把分散的他人、信息、资源、工具，从你自己的视角聚合到一处。它**仅以 App 形态分发**——同一套 Next.js 代码经 Tauri 2.0 静态导出后打包为跨平台客户端。

三条核心理念贯穿全部设计：

- **本地优先**：home（笔记/书签/资源/订阅/对话）与 tool 的能力存于设备 IndexedDB，离线、无账号即可用。个人数据默认不离开设备。
- **供应商中立**：所有后端取数经 `ServerPort` 契约消费，**后端可换、可自建**。wonita 服务只是默认与参考实现，ideall 不被任何单一后端绑死。
- **零后端即完整产品**：home / tool 本地能力 + 无账号端到端同步 + BYO-key agent，不连任何后端也是一个完整可用的产品；info / community 是连接后端后的增强。

**AI 原生个人空间**（在上述三条之上的组织/交互层，已落地，详见 [design/ai-native-redesign.md](design/ai-native-redesign.md)）：

- **一切皆文件**（数据组织，借 Linux VFS）：所有本地内容收敛为单一命名空间里的可寻址 `Node` 节点（统一 `STORE_NODES`，按 `kind` 区分 note/bookmark/folder/file/feed/thread），共用同一套树/同步/墓碑原语。
- **一切皆标签**（UI）：打开任意「文件」即开一个工作区标签，标签是通用查看器；活动栏 home 子项是根命名空间（places），侧栏是跨 kind 文件树。
- **AI 是环境层**：AI 经 `fs.*` 工具面（与嵌入页共用同一条 Grant→MCP 能力链路）读写这些节点——文件是它的记忆与工作产物，标签是它为你物化的视图；个人正文默认不进 AI 上下文（隐私三道闸，见 §6）。

## 2. 领域模型

ideall 的领域类型分两类：**本地拥有**（存 IndexedDB，core 即权威）与**后端供给**（经 `ServerPort` 取数，ideall 用自己的领域词汇定义，见 `src/protocol/server-port.ts`）。

### 2.1 统一 Node 模型（一切皆文件）

全部**本地拥有**内容收敛为单一可辨识联合 `Node`（`protocol/node.ts`），由 `kind` 区分六类，共存于同一个 IndexedDB 对象仓 `STORE_NODES`：

| kind | 域类型（投影后） | 说明 |
| --- | --- | --- |
| `note` | `Note`（+`blockMeta?`） | 笔记；正文为 Plate 块数组，并发合并经块级 sidecar（§6 / [design](design/ai-native-redesign.md) §7） |
| `bookmark` | `Bookmark` | 书签；`folderId` 投影为节点 `parentId` |
| `folder` | `BookmarkFolder` | 收藏夹（书签命名空间内的目录节点） |
| `file` | `StoredFile` | 资源；轻量元数据存节点，原始 Blob 旁存独立 `STORE_BLOBS`（节点持 `blobRef`，不进同步） |
| `feed` | `Subscription` | 订阅偏好；**确定性 id** `feed:type:key`，同步边界投影回旧 `"subs"` wire |
| `thread` | `Thread` | AI 对话线程；`messages` 在协议层为不透明 `unknown[]`，本地独占、默认不同步 |

所有节点共用同一套基座字段（`id`/`kind`/`parentId`/`sortKey`/`createdAt`/`updatedAt`/`deletedAt?`）与同一套**树 / LWW 同步 / 软删墓碑**原语。

**投影封在仓库边界**（关键不变量）：每个 kind 有一个 `*-store` 门面（`notes-store`/`bookmarks-store`/`files-store`/`subscriptions-store`/`threads-store`），对内读写 `STORE_NODES` 并按 `kind` 过滤/打标，对外仍暴露原有域类型（`Bookmark`/`StoredFile`/`Subscription`…）。**故 11+ 处消费方（UI / agent / embed）在四步折叠中零改动**。`nodes-store` 是跨 kind 协调层（`listNodeSummaries`/`listNodesRaw`/`getNodeRaw` + create/update/move/delete 按 kind 分派），AI `fs.*` 层即建于其上。

### 2.2 领域类型一览

| 领域概念 | 归属 | 定义位置 | 说明 |
| --- | --- | --- | --- |
| 统一节点 `Node`（note/bookmark/folder/file/feed/thread） | 本地 | `protocol/node.ts` | 全部本地内容的单一可辨识联合；存 `STORE_NODES`，按 kind 投影为下列域类型 |
| 资源 `StoredFile` / 书签 `Bookmark` / 收藏夹 `BookmarkFolder` / 笔记 `Note` | 本地 | `protocol/hub-data.ts` | home 中枢的本地优先实体（节点投影）；文件原始 Blob 旁存 `STORE_BLOBS` |
| 订阅 `Subscription` | 本地（偏好）+ 后端（内容） | `protocol/subscription.ts` | 类型为 `publisher`/`entity`/`tool`/`search`/`peer`；**仅订阅偏好**存为 `feed` 节点，内容实时拉取 |
| AI 对话线程 `Thread` | 本地 | `protocol/hub-data.ts` | BYO-key AI 助手；消息内联存于线程节点，经 `HubDataPort` 读写（不再由 agent 插件自存） |
| 信息 `Info` / 事件 `InfoEvent` / 实体 `EntityDetail` / 发布者 `Publisher` | 后端 | `protocol/server-port.ts` | info 模块的资讯数据，由后端的采集/NLP/图谱产出 |
| 社区发布者 `PeerPublisher` / 发布 `Publication` | 后端 | `protocol/server-port.ts` | community 的用户发布层 |
| 同步块 `SyncBlob` | 本地派生密文 ↔ 后端不透明存储 | `protocol/sync.ts` | `{ iv, ciphertext, updated_at }`，后端只存密文 |
| 登录会话 `AuthBody` / 当前用户 `CurrentUser` | 后端（账号身份） | `protocol/server-port.ts` | 公开发布身份；与无账号同步码是两套独立身份 |

**两套独立身份**（务必区分）：

- **账号**（公开发布身份）：登录后可在 community 发布，他人订阅；走后端 X25519 登录方案。
- **跨端同步码**（无账号）：高熵随机串，在浏览器派生 `storageId` + AES 密钥，只上传密文。

## 3. 模块与边界

### 3.1 四模块（hub-and-spoke）

home 是信息中枢，info / community / tool 三模块围绕并服务于它——三模块的「发现」内容经**订阅**回流到 `/home/subscriptions` 订阅流。

| 模块 | 路由 | 角色 | 是否需后端 |
| --- | --- | --- | --- |
| **home** | `/home`（笔记 / 书签 / 资源 / 订阅 / 对话；工作区标签 + places 侧栏） | 信息中枢：本地内容工作区，统一 Node 库 + 一切皆标签 | 否（本地优先） |
| **info** | `/info`（含 search / entity / publisher / analysis） | 资讯聚合展示：信息流、实体与发布者、关联分析 | 是 |
| **community** | `/community` | 发布者地图、订阅与发布（peer 发布层） | 是 |
| **tool** | `/tool`（含 search / ai / navigation） | 工具聚合（搜索 / AI / 导航） | 部分功能可选 |

> 路由分布：home 在 `src/app/home/*`（页面即路由，含本地数据层 `home/lib`）；info/community/tool 在路由组 `src/app/(discover)/*`，页面组件由路由薄 re-export `src/components/apps/<name>` 的实现。

**一切皆标签（home 工作区，`src/app/workspace/*`）**：打开任意节点即开一个工作区标签，标签内容由 kind→查看器注册表 `node-viewers.ts` 决定（已落地 note/file/bookmark/feed/thread 五个实体查看器）；深链用 `?node=kind:id`（`nodeTab`/`parseNodeParams` 编解码，URL 守护幂等）。活动栏 home 子项是**根命名空间**（places，`NS_ROOT`：笔记/书签/资源/订阅/对话），侧栏是基于泛型 `buildTree<T extends TreeItem>` 渲染的**跨 kind 只读文件树**（`places-sidebar.tsx`/`node-tree.tsx`）。`MODULE_OF_KIND` 把全部本地 kind 归 `home`。

### 3.2 本地能力 vs 需后端能力

- **本地能力（零后端可用）**：home 的书签/资源/订阅偏好、tool 的本地功能、跨端同步、BYO-key agent。数据存 IndexedDB，离线无账号。
- **需后端能力**：info 的资讯/实体/分析、community 的发布者地图与发布、订阅流的内容拉取、账号鉴权。全部经 `ServerPort` 消费。

### 3.3 抽象层：扁平三目录（`src/` 下）

常规 Next.js 布局，路由与核心实现同址，共享代码归 `components`，契约独立成 `protocol`。

| 目录 | 别名 | 内容 |
| --- | --- | --- |
| **app** | `@/app/*` | Next 路由 + 核心实现同址：`home/` 中枢（页面即路由 + IndexedDB 数据层 `home/lib`）、`shell/` 全局壳（header/nav/命令台/主题/`boot`，非路由）、`nav/` 导航配置、`(discover)/` 与 `auth/` 路由入口 |
| **components** | `@/components/*` | 全部共享代码：`apps/`（info/community/tool 三应用模块）、`plugins/`（`agent` AI 助手 + `sync` 跨端同步）、`lib/` 纯工具（utils/format/idb/sync-crypto/auth/api/server 适配器…）、`ui/` shadcn 原语、`shared/` 跨 app/core/plugin 共享 UI 原语（app-header/service-header/prompt-dialog/data-table-pagination/wonita-mark）、`feeders/` 中枢回流反馈 UI |
| **protocol** | `@protocol/*` | 跨模块契约（纯端口/类型/纯函数，**不含 UI**）：`node`（统一 Node 联合 + `stripNode`）/ `note-merge`（块级合并纯代数）/ `subscription` / `content`（解析注册表）/ `flowback` / `hub-data`（HubDataPort，含 fs.* + thread 方法）/ `sync`（SyncPort）/ `server-port`（ServerPort）/ `peer` / `auth` |

**端口模式**：每个跨模块契约都是「端口 + register/get」。模块经 protocol 间接协作，core 永不直连具体 app/plugin：

- **内容 feed**：订阅流调 `@protocol/content` 的 `resolveSubscription`；info/community 在各自 `manifest.ts` 注册 resolver（info 管 publisher/entity/search，community 管 peer）。
- **中枢数据**：反馈组件、agent 插件与 AI `fs.*` 层经 `@protocol/hub-data` 的 `getHubData()`（HubDataPort，中枢在 boot 注册实现）读写笔记/订阅/书签/资源/线程，不直接依赖中枢存储。HubDataPort 已扩出节点级 `fsListNodes/fsGetNode/fsCreateNode/fsUpdateNode/fsMoveNode/fsDeleteNode/fsReadBlob` + 线程方法。
- **跨端同步**：同步面板调 `@protocol/sync` 的 `getSyncPort()`；sync 插件 manifest 注册 SyncPort。
- **后端取数**：所有信息/发布/鉴权取数经 `@protocol/server-port` 的 `getServerPort()`（ServerPort）。
- **UI 动作 / 活动节点**（守 components↛app 边界）：插件经 `@/components/lib/ui-actions`（`UiActions`：开/关标签）与 `@/components/lib/active-node`（当前激活标签→`NodeRef`）两个端口与工作区交互，app 在 boot 注入实现、插件只消费。

### 3.4 AI `fs.*` 层（一切皆文件的 AI 侧）

AI 不再持专有工具，而是经一套**文件系统语义**的 MCP 工具面 `fs.*`/`ui.*` 读写统一 Node 库——与嵌入页（embed）共用同一条 **Grant→MCP** 能力链路（`src/components/embed/*`）：

- **能力链路**：`createHubMcpServer(grant, ctx)` 据 `grant.permissions` 注册工具；权限位 `fs:read`/`fs:write`/`fs.notes:read`/`fs.notes:write`/`ui.tabs`。工具：`fs.list`/`fs.read`/`fs.readBlob`/`fs.create`/`fs.write`/`fs.move`/`fs.delete` + `ui.openTab`/`ui.closeTab`，资源 `fs://nodes`。
- **agent→MCP 回环**：agent 插件经 `agentGrant`（`fs:read`/`fs:write`/`fs.notes:write`/`ui.tabs`，**无 `fs.notes:read`**）→ `createHubMcpServer` → `createLoopbackTransports`（本进程 MessageChannel + 复用的 `MessagePortTransport`）→ `agent-mcp.ts`（`connectAgentMcp`：tools/list→OpenAI 工具、callTool、`summarizeTool` 中文回执）。即 agent 与嵌入第三方走同一套受限工具面，无特权旁路。
- **对话即文件**：当前激活标签经 `active-node` 端口注入为隐式上下文（`gatherReferencedContext`），宿主对激活 note/thread 的全量读 = 用户隐式同意，授权集不变。
- **隐私三道闸**：见 §6 第 9 条。

**ServerPort ↔ HTTP 适配器**：ServerPort 是 ideall 自有领域类型定义的端口（`src/protocol/server-port.ts`），**不依赖** wonita 服务的 wire DTO。默认实现是 `components/lib/server/http-adapter`（对接 wonita 服务的 HTTP API），是**唯一** import openapi 生成类型（`@/components/lib/api/server`）的地方——wire→domain 的映射与漂移门收敛于此。ServerPort 是**同构端口**（SSR 预渲染期也取数），故 `getServerPort()` 默认回退该 HTTP 适配器；App / 嵌入式 / 局域网节点 / 测试可经 `registerServerPort()` 覆盖——**这是供应商中立的技术支点**。

**组合根**：`app/shell/boot.ts#registerAll()` 是唯一允许 import 各 manifest 的地方，由客户端启动闸 `boot-gate.tsx`（挂在根 layout）调用一次，幂等注册全部端口实现。

## 4. 数据流

```
                          ┌─────────────────────────────────────────────┐
                          │            ideall App (Tauri webview)         │
                          │                                               │
   本地优先 (零后端)  ┌───┤  home/tool ──► HubDataPort ──► IndexedDB      │
   ───────────────   │   │   统一 Node 库 STORE_NODES + Blob 旁存 STORE_BLOBS│
                     │   │   (note/bookmark/folder/file/feed/thread, 明文不上传)│
                     │   │                                               │
                     │   │  agent (BYO key) ─fs.*/ui.* MCP→ Node 库       │
                     │   │     │ Grant→createHubMcpServer→loopback        │
   BYO-key agent ────┘   │     ▼                                          │
                         │  agent ──► OpenAI 兼容端点 (key 仅存本地)       │
                         │     └─ App: tauri-plugin-http (Rust 侧) 绕 CORS │
                         │        web: 标准 fetch (受厂商 CORS 限制)       │
                         │                                               │
   需后端 (经契约) ──────┤  info/community ──► getServerPort()            │
                         │        │ 默认 HTTP 适配器 (唯一 import wire DTO) │
                         │        ▼                                       │
                         │   registerServerPort() 可覆盖 ◄─ 中立性支点    │
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

1. **本地 IndexedDB（统一 Node 库）**：home/tool 经 HubDataPort 读写**单一对象仓 `STORE_NODES`**（六类 kind 节点）+ 旁存 `STORE_BLOBS`（`{key,blob}`，文件原始字节，不进同步）。跨多仓的原子写经 `idbPutAcrossStores`（防孤儿 Blob）；写靠 put→delete 排空、`onupgradeneeded` 内零 I/O 的懒迁移（DB_VERSION 已升至 10 以淘汰旧端缓存）。明文不上传。
2. **经 ServerPort 直连后端**：info/community 经 `getServerPort()` 取资讯/发布/鉴权数据；客户端直连后端 API（`NEXT_PUBLIC_SERVER_ADDR`），需后端放行 CORS。
3. **E2E 同步只传密文**：同步码在浏览器派生 `storageId` + AES 密钥，本地 AES-GCM 加密后上传 `SyncBlob`，后端不透明存储、读不到内容。订阅/书签等按 LWW 并集合并（`unionMerge` + 软删墓碑 + 过期 GC）；**笔记走块级合并**——整篇删除走 node 级 LWW（`deletedAt`），正文走块级 `mergeNoteContent`（per-block `(v,by)` 取胜 + `(sk,id)` 排序，跨端并发改不同块无损），块墓碑 GC 独立一步。`feed` 节点在同步边界投影回旧 `"subs"` wire，订阅同步协议一字未改。
4. **BYO-key agent 经 fs.* MCP 读写 + Tauri 绕 CORS**：agent 经 `agentGrant`→`createHubMcpServer`→loopback MCP 客户端（`agent-mcp.ts`）以 `fs.*`/`ui.*` 工具读写 Node 库（与嵌入第三方同一受限工具面），再直连用户配置的 OpenAI 兼容端点。key 仅存本地；在 App（Tauri）内经 `tauri-plugin-http`（Rust 侧请求）绕过 webview CORS，可直连任意云厂商端点；纯浏览器调试时用标准 fetch，受厂商 CORS 限制（本地 Ollama / 放行 CORS 的端点可用）。

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

1. **供应商中立 = 后端可换/可自建**：业务代码只依赖 `ServerPort` 领域类型，绝不直连某个具体后端。`registerServerPort()` 是替换点。
2. **个人数据默认不上传**：home/tool 本地数据存 IndexedDB，仅在跨端同步（密文）或主动发布时才经后端。同步只上传密文，后端读不到明文。
3. **协议纯度**（ESLint 强制）：`protocol/` 只可依赖 `@/components/lib` 纯工具，**不得** import UI 或页面代码。
4. **wire DTO 边界**（ESLint 强制）：openapi 生成类型（`@/components/lib/api/server`）**仅** HTTP 适配器（`components/lib/server`）可 import；protocol 与业务代码一律用 ServerPort 领域类型。
5. **依赖方向**（惯例 + 部分 ESLint 强制）：components 不 import app；info/community/tool 互不 import；跨模块交互一律经 `@protocol`。插件需触达工作区时只经 `ui-actions`/`active-node` 端口（app 注入），不反向 import app。
6. **两套身份隔离**：账号（公开发布）与无账号同步码互不耦合。
7. **零后端可用**：home/tool/同步/agent 不依赖后端可用性，必须始终能离线工作。
8. **统一 Node 库的投影封边界**（一切皆文件）：所有本地内容存单一 `STORE_NODES`，节点↔域类型投影**只在各 `*-store` 门面内**发生，消费方仍见原域类型。folding 期由 `*.test.ts` 锁「零丢数据 + 幂等」；迁移走懒迁移（纯 `plan*` + I/O 包装），**绝不在 `onupgradeneeded` 内做 I/O**。
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
- [design/ai-native-redesign.md](design/ai-native-redesign.md) — AI 原生重设计权威稿：统一 Node 模型、四步折叠、墓碑、一切皆标签 UI、`fs.*` AI 层与隐私三道闸、笔记块级合并的完整推导与雷区清单（本文 §2/§3.4/§6 即其落地回写）。
- [app.md](app.md) — App（桌面/移动）方案、平台矩阵、CI、签名与分阶段路线图。
- [claude.md](claude.md) — 仓库结构与开发约定（贡献者必读）。
- [.github/SECURITY.md](.github/SECURITY.md) — 安全策略与漏洞报告（含同步加密关注点）。
