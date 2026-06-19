# ideall 架构

> 本文是 ideall 的架构权威说明，面向贡献者与集成方。产品定位与上手步骤见 [README.md](README.md)；App（桌面/移动）打包细节见 [docs/app.md](docs/app.md)；开发约定见 [CLAUDE.md](CLAUDE.md)。

## 1. 概览

ideall 是**开源、本地优先、供应商中立的个人信息工作台**：把分散的他人、信息、资源、工具，从你自己的视角聚合到一处。它**仅以 App 形态分发**——同一套 Next.js 代码经 Tauri 2.0 静态导出后打包为跨平台客户端。

三条核心理念贯穿全部设计：

- **本地优先**：home（书签/资源/订阅/agent 对话）与 tool 的能力存于设备 IndexedDB，离线、无账号即可用。个人数据默认不离开设备。
- **供应商中立**：所有后端取数经 `ServerPort` 契约消费，**后端可换、可自建**。wonita 服务只是默认与参考实现，ideall 不被任何单一后端绑死。
- **零后端即完整产品**：home / tool 本地能力 + 无账号端到端同步 + BYO-key agent，不连任何后端也是一个完整可用的产品；info / community 是连接后端后的增强。

## 2. 领域模型

ideall 的领域类型分两类：**本地拥有**（存 IndexedDB，core 即权威）与**后端供给**（经 `ServerPort` 取数，ideall 用自己的领域词汇定义，见 `src/protocol/server-port.ts`）。

| 领域概念 | 归属 | 定义位置 | 说明 |
| --- | --- | --- | --- |
| 资源 `StoredFile` / 书签 `Bookmark` / 收藏夹 `BookmarkFolder` | 本地 | `protocol/hub-data.ts` | home 中枢的本地优先实体；文件含原始 Blob |
| 订阅 `Subscription` | 本地（偏好）+ 后端（内容） | `protocol/subscription.ts` | 类型为 `publisher`/`entity`/`tool`/`search`/`peer`；**仅订阅偏好**存 IndexedDB，内容实时拉取 |
| 信息 `Info` / 事件 `InfoEvent` / 实体 `EntityDetail` / 发布者 `Publisher` | 后端 | `protocol/server-port.ts` | info 模块的资讯数据，由后端的采集/NLP/图谱产出 |
| 社区发布者 `PeerPublisher` / 发布 `Publication` | 后端 | `protocol/server-port.ts` | community 的用户发布层 |
| 同步块 `SyncBlob` | 本地派生密文 ↔ 后端不透明存储 | `protocol/sync.ts` | `{ iv, ciphertext, updated_at }`，后端只存密文 |
| 登录会话 `AuthBody` / 当前用户 `CurrentUser` | 后端（账号身份） | `protocol/server-port.ts` | 公开发布身份；与无账号同步码是两套独立身份 |
| agent 对话线程 | 本地 | `app/home/lib`（`agentThreads` 仓库） | BYO-key AI 助手，消息内联存于线程文档 |

**两套独立身份**（务必区分）：

- **账号**（公开发布身份）：登录后可在 community 发布，他人订阅；走后端 X25519 登录方案。
- **跨端同步码**（无账号）：高熵随机串，在浏览器派生 `storageId` + AES 密钥，只上传密文。

## 3. 模块与边界

### 3.1 四模块（hub-and-spoke）

home 是信息中枢，info / community / tool 三模块围绕并服务于它——三模块的「发现」内容经**订阅**回流到 `/home/subscriptions` 订阅流。

| 模块 | 路由 | 角色 | 是否需后端 |
| --- | --- | --- | --- |
| **home** | `/home`（dashboard / subscriptions / bookmarks / resources / publications / agent） | 信息中枢：个人资源、书签、订阅流、本地 AI 助手 | 否（本地优先） |
| **info** | `/info`（含 search / entity / publisher / analysis） | 资讯聚合展示：信息流、实体与发布者、关联分析 | 是 |
| **community** | `/community` | 发布者地图、订阅与发布（peer 发布层） | 是 |
| **tool** | `/tool`（含 search / ai / navigation） | 工具聚合（搜索 / AI / 导航） | 部分功能可选 |

> 路由分布：home 在 `src/app/home/*`（页面即路由，含本地数据层 `home/lib`）；info/community/tool 在路由组 `src/app/(discover)/*`，页面组件由路由薄 re-export `src/components/apps/<name>` 的实现。

### 3.2 本地能力 vs 需后端能力

- **本地能力（零后端可用）**：home 的书签/资源/订阅偏好、tool 的本地功能、跨端同步、BYO-key agent。数据存 IndexedDB，离线无账号。
- **需后端能力**：info 的资讯/实体/分析、community 的发布者地图与发布、订阅流的内容拉取、账号鉴权。全部经 `ServerPort` 消费。

### 3.3 抽象层：扁平三目录（`src/` 下）

常规 Next.js 布局，路由与核心实现同址，共享代码归 `components`，契约独立成 `protocol`。

| 目录 | 别名 | 内容 |
| --- | --- | --- |
| **app** | `@/app/*` | Next 路由 + 核心实现同址：`home/` 中枢（页面即路由 + IndexedDB 数据层 `home/lib`）、`shell/` 全局壳（header/nav/命令台/主题/`boot`，非路由）、`nav/` 导航配置、`(discover)/` 与 `auth/` 路由入口 |
| **components** | `@/components/*` | 全部共享代码：`apps/`（info/community/tool 三应用模块）、`plugins/`（`agent` AI 助手 + `sync` 跨端同步）、`lib/` 纯工具（utils/format/idb/sync-crypto/auth/api/server 适配器…）、`ui/` shadcn 原语、`feeders/` 等共享 UI |
| **protocol** | `@protocol/*` | 跨模块契约（纯端口/类型/纯函数，**不含 UI**）：`subscription` / `content`（解析注册表）/ `flowback` / `hub-data`（HubDataPort）/ `sync`（SyncPort）/ `server-port`（ServerPort）/ `peer` / `auth` |

**端口模式**：每个跨模块契约都是「端口 + register/get」。模块经 protocol 间接协作，core 永不直连具体 app/plugin：

- **内容 feed**：订阅流调 `@protocol/content` 的 `resolveSubscription`；info/community 在各自 `manifest.ts` 注册 resolver（info 管 publisher/entity/search，community 管 peer）。
- **中枢数据**：反馈组件与 agent 插件经 `@protocol/hub-data` 的 `getHubData()`（HubDataPort，中枢在 boot 注册实现）读写订阅/书签/资源，不直接依赖中枢存储。
- **跨端同步**：同步面板调 `@protocol/sync` 的 `getSyncPort()`；sync 插件 manifest 注册 SyncPort。
- **后端取数**：所有信息/发布/鉴权取数经 `@protocol/server-port` 的 `getServerPort()`（ServerPort）。

**ServerPort ↔ HTTP 适配器**：ServerPort 是 ideall 自有领域类型定义的端口（`src/protocol/server-port.ts`），**不依赖** wonita 服务的 wire DTO。默认实现是 `components/lib/server/http-adapter`（对接 wonita 服务的 HTTP API），是**唯一** import openapi 生成类型（`@/components/lib/api/server`）的地方——wire→domain 的映射与漂移门收敛于此。ServerPort 是**同构端口**（SSR 预渲染期也取数），故 `getServerPort()` 默认回退该 HTTP 适配器；App / 嵌入式 / 局域网节点 / 测试可经 `registerServerPort()` 覆盖——**这是供应商中立的技术支点**。

**组合根**：`app/shell/boot.ts#registerAll()` 是唯一允许 import 各 manifest 的地方，由客户端启动闸 `boot-gate.tsx`（挂在根 layout）调用一次，幂等注册全部端口实现。

## 4. 数据流

```
                          ┌─────────────────────────────────────────────┐
                          │            ideall App (Tauri webview)         │
                          │                                               │
   本地优先 (零后端)  ┌───┤  home/tool ──► HubDataPort ──► IndexedDB      │
   ───────────────   │   │   书签/资源/订阅偏好/agent 对话 (明文, 不上传) │
                     │   │                                               │
                     │   │  agent (BYO key) ──► OpenAI 兼容端点           │
   BYO-key agent ────┘   │     │ key 仅存本地, 随请求带 Authorization     │
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

1. **本地 IndexedDB**：home/tool 经 HubDataPort 读写本地数据（`wonita-home` 库，仓库含 files / bookmarks / bookmarkFolders / subscriptions / agentThreads）。明文不上传。
2. **经 ServerPort 直连后端**：info/community 经 `getServerPort()` 取资讯/发布/鉴权数据；客户端直连后端 API（`NEXT_PUBLIC_SERVER_ADDR`），需后端放行 CORS。
3. **E2E 同步只传密文**：同步码在浏览器派生 `storageId` + AES 密钥，订阅列表本地 AES-GCM 加密后上传 `SyncBlob`，后端不透明存储、读不到内容；多端按 LWW 并集合并（`unionMerge`）。
4. **BYO-key agent 经 Tauri 绕 CORS**：agent 直连用户配置的 OpenAI 兼容端点，key 仅存本地。在 App（Tauri）内经 `tauri-plugin-http`（Rust 侧请求）绕过 webview CORS，可直连任意云厂商端点；纯浏览器调试时用标准 fetch，受厂商 CORS 限制（本地 Ollama / 放行 CORS 的端点可用）。

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
5. **依赖方向**（惯例）：components 不 import app；info/community/tool 互不 import；跨模块交互一律经 `@protocol`。
6. **两套身份隔离**：账号（公开发布）与无账号同步码互不耦合。
7. **零后端可用**：home/tool/同步/agent 不依赖后端可用性，必须始终能离线工作。

## 7. 部署 / 分发形态

ideall 仅以 App 形态分发（Tauri 工程在 `src-tauri/`）：构建期 `next build`（`output: export` → `out/`），再由 Tauri 打包。

| 平台 | Tauri 目标 | 构建机要求 | 产物 |
| --- | --- | --- | --- |
| Linux | desktop | Linux + webkit2gtk | `.deb` / `.rpm` / `.AppImage` |
| Windows | desktop | Windows + WebView2 | `.msi` / `.exe`（NSIS） |
| macOS | desktop | macOS + Xcode CLT | `.dmg` / `.app` |
| iOS | mobile | macOS + Xcode | `.ipa` |
| Android | mobile | JDK + Android SDK/NDK | `.apk` / `.aab` |

桌面发布走 GitHub Releases（含 `tauri-plugin-updater` 自动更新）；移动走 App Store / Google Play。完整方案、CI、签名与路线图见 [docs/app.md](docs/app.md)。

## 8. 文档导航

- [README.md](README.md) — 产品定位、模块表、快速开始、连接后端、App 打包、API 类型同步。
- [docs/app.md](docs/app.md) — App（桌面/移动）方案、平台矩阵、CI、签名与分阶段路线图。
- [CLAUDE.md](CLAUDE.md) — 仓库结构与开发约定（贡献者必读）。
- [.github/SECURITY.md](.github/SECURITY.md) — 安全策略与漏洞报告（含同步加密关注点）。
