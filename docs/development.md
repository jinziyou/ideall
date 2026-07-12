# ideall 开发约定

## Repository

ideall 是**独立项目 / 独立仓库**（`git@github.com:jinziyou/ideall.git`）的 **Next.js 客户端应用**，本仓库为源码权威仓库。
整体定位见 [README.md](../README.md)；架构权威说明见 [architecture.md](architecture.md)；API 契约同步见下方“API codegen”。
ideall 是后端数据服务的**外部消费方 / 客户端**：经 `ServerPort` 契约消费 wonita 服务的数据服务 API（wonita 服务是 `ServerPort` 的参考实现；第三方 / 嵌入式 / 局域网节点亦可实现 `ServerPort`）。信息采集 / NLP / 知识图谱 / 鉴权由该后端数据服务提供，ideall 经 `NEXT_PUBLIC_SERVER_ADDR` 连接，不在本仓库范围内；ideall 不被单一后端绑死。

ideall **仅以 App 形态分发**（Tauri 跨平台静态导出，无 Node 运行时 / 无 SSR 生产部署）。

**分支模型（dev / main）**：`main` 稳定/发布（App 版本 tag 基于它），`dev` 集成/日常开发；改动先进 `dev`，CI 在 `main` / `dev` / PR 均运行，稳定后合并 `main` 发布。

## Positioning

ideall 是**开源、本地优先的个人信息终端**（独立项目）：从个人视角出发，把分散的他人、信息、资源和工具聚合到一处。
**设计思想**：一切皆文件、一切皆标签页——各类 Storage 经 FileSystem 挂载到统一命名空间，以 `FileRef` 寻址；打开任意文件即由 Engine 渲染为工作区标签页。`ideall.core` 的笔记、书签、资源、关注和对话收敛为 Node 库；音频、数据库、Agent 配置和第三方 App 等来源保留各自存储语义。
**设计风格**：现代 · 面板 · 留白的标签工作区。

**导航信息架构**：活动栏的一级分区固定为“我的 / 活动 / 浏览 / 应用 / 设置”，二级侧栏依次为“关注 / 书签 / 资源 / 文件”、“空间 / 任务 / 删除”、“新闻 / 社区 / 浏览器”、“搜索 / 本地应用”、“基本 / AI”。五个一级入口始终可见，本机数据、联网资源与 App 挂载继续经同一合成文件系统进入 Display。

**战略方向 D（已定）**：ideall **能独立成立**，命运不与 wonita 深度绑定。

- **本地核心不依赖后端**：“我的”（home）/ tool 本地能力与 BYO-key agent 可离线使用。跨端同步无账号且只传密文，但同步动作仍需要可用的 Sync 服务；当前同步范围仅为关注（`subs`）与笔记（`notes`）。
- **wonita 是默认且最好的后端选项，而非命根**：取数经 `@protocol/server-port` 的 `ServerPort` 契约，**后端可换 / 可自建**；wonita 只是默认与参考实现。后端可换 / 可自建是核心对外能力，必须兑现。
- **开源核心商业模型**：ideall（开源免费）做漏斗与信任护城河；wonita（闭源付费）以“语料级智能”变现。免费/付费线守在“语料级智能”（聚合 / 知识图谱 / 实体事件追踪），基础本地功能不入墙。
- **目标盘**：信息密集型专业人士，以及重视数据自持的高级用户 / 极客（非大众市场）。
- **community / peer 发布降级为远期可选赌注**：Follow、腾讯 ima 已大规模占据，验证本地产品留存后再投。

**home 是“我的”（本机数据区）；info / community / tool 是三个发现模块，其内容经关注汇入“我的”**：“我的”通过**关注**把“发现”里的来源（发布者 / 实体 / 工具 / 搜索 / 社区发布者 peer）加入 `/home/subscriptions` 关注流；关注偏好本地优先（IndexedDB），内容实时拉取。
**跨端同步（端到端加密、无账号）**：同步码在浏览器派生 `storageId` 与 AES 密钥，只上传密文。
**社区是用户 / peer 发布层（账号）**：登录后发布内容成为社区发布者，他人可关注其发布并汇入关注流。
**账号（公开发布身份）与跨端同步的无账号同步码是两套独立身份**。

## 架构：终端分层（src/ 下）

> 本节是日常开发速查；完整架构（领域模型 / 数据流图 / 不变量）见 [architecture.md](architecture.md)。

`src/` 已按终端分层重组：路由薄标记 / 终端外壳 / 一切皆标签 / 一切皆文件 / 功能模块 / 插件 / 契约 / UI 原语 / 纯工具。

| 目录 | 别名 | 内容 |
| --- | --- | --- |
| **app** | `@/app/*` | Next 路由层——仅打开目标或执行工作区命令的薄标记（`page.tsx` 几乎全是 re-export `@/workspace/open-workspace-tab`；唯一例外 `app/auth/page.tsx` 是独立登录页，渲染 `@/shell/auth-form`）+ 根 layout/error/loading/not-found + `globals.css` |
| **shell** | `@/shell/*` | 终端外壳 —— 五分区导航 / 命令台 / header / bottom-tab-bar / 主题 / account / mobile-nav，以及唯一组合根 `boot`、启动闸 `boot-gate` 和可信扩展生命周期 `runtime-extensions` |
| **workspace** | `@/workspace/*` | Display 编排 —— File + Engine 标签、三种工作区、目录树、标签生命周期、脏 Engine 休眠，以及仅位于深链解析/工作区水合边界的旧 Resource/Node 标签迁移 |
| **filesystem** | `@/filesystem/*` | FileSystem registry、隐藏合成根、provider 挂载、批量读取与 watch 生命周期；`resource-file-system` 将 `resource-sources/` 下的 Node/连接数据 Resource source/provider 适配到 `ideall.core` |
| **engines** | `@/engines/*` | Engine descriptor、匹配、默认选择以及按工作区隔离的偏好 |
| **files** | `@/files/*` | 一切皆文件——统一 Node 数据层。`stores/`（各 kind store + `nodes-store` 跨 kind 协调层）；顶层 Node 原语：note-blocks / sort-key / notes-tree-util / note-write-queue / flowback / feed-node（关注↔feed 节点投影）/ `files-port`（经 FileSystem registry 的兼容外观）/ `storage-sync-port`（同步专用原子存储面）/ bookmark-import |
| **modules** | `@/modules/*` | 功能模块——`home`（“我的”：本机笔记/书签/资源/关注/对话的功能 UI = overview/notes/bookmarks/resources/publications/subscriptions）/ `info` / `community` / `tool` / `apps`（本机已安装应用启动器，Tauri 桌面专属；由 `src-tauri/src/installed_apps.rs` + `src/lib/installed-apps.ts` 支撑） |
| **plugins** | `@/plugins/*` | 插件——`agent`（AI 环境层，BYO-key）/ `sync`（跨端 E2E 同步）/ `embed`（嵌入页 + AI 共用的 Grant→`createLocalMcpServer` 能力链路）/ `code` / `git` / `shell` / `audio` / `database`；公共插件数据能力在 `plugins/shared` |
| **protocol** | `@protocol/*` | 契约 / 端口（纯类型 / 纯函数，不含 UI）：file-system / engine / node / files（FilesPort 兼容领域外观）/ storage-sync / note-merge / subscription / content / flowback / sync / server-port / peer / auth |
| **ui** | `@/ui/*` | shadcn 原语 + 块编辑器（`editor/`） |
| **shared** | `@/shared/*` | 跨层共享 UI；`feeders/` 仅保留工具固定按钮 `PinToolButton` 与统一回流提示 `flowbackToast` |
| **lib** | `@/lib/*` | 纯工具——utils/format/idb/id/sync-crypto/auth/api（wire DTO 生成物）/server（HTTP 适配器）/ui-actions/active-node/safe-url/theme/env/tauri/updater 等 |

**别名**：`@/*` → `src/*`；`@protocol/*` → `src/protocol/*`（其余层一律使用 `@/<layer>/...`；app 路由使用 `@/app/*`、`@/app/globals.css`）。

ESLint 强制五条边界：

1. **protocol 纯度**：契约层只可依赖 `@/lib` 纯工具，不得 import UI 或页面代码。
2. **wire DTO 边界**：后端数据服务的 OpenAPI 生成类型（`@/lib/api/server`）仅允许 `@/lib/server` 与 `@/lib/api` import；protocol 与业务代码一律使用 `@protocol/server-port` 领域类型。
3. **app 路由不可被反向 import**（路由层只分发打开目标或工作区命令）。
4. **modules 三应用 info/community/tool 互隔**（互不 import）。
5. **plugins 不反向 import shell/workspace**：插件触达工作区只能经 `@/lib/ui-actions` / `@/lib/active-node` 端口。

### 依赖反转（模块经 protocol 而非互相直连）

- **内容 feed**：“我的”关注流调用 `@protocol/content` 的 `resolveSubscription`；info/community 在各自 `manifest.ts` 注册 resolver（info 管 publisher/entity/search，community 管 peer）。
- **本机文件数据**：`@/shared/feeders/pin-tool-button` 与 agent 插件经 `@protocol/files` 的 `getFilesPort()`
  使用兼容领域 DTO；普通 CRUD 由该外观继续分派到 FileSystem registry，不直接依赖底层 Node 存储。只有 sync 经 `StorageSyncPort` 使用含墓碑快照与原子 bulk。
- **跨端同步**：“我的”同步面板调用 `@protocol/sync` 的 `getSyncPort()`；sync 插件 `manifest.ts` 注册 SyncPort。
- **后端取数（wonita 服务数据服务）**：所有信息、发布和鉴权取数经 `@protocol/server-port` 的 `getServerPort()`（ServerPort = 后端数据服务契约 + 自有领域类型）。默认实现是 `@/lib/server` 的 HTTP 适配器，对接 wonita server（后端数据服务的一个实现），也是**唯一** import wire DTO 的位置。ServerPort 是同构端口，SSR 预渲染期（`pnpm dev` 与导出前预渲染）也会取数，因此 `getServerPort()` 默认回退该 HTTP 适配器；App、嵌入式、局域网节点和测试可经 `registerServerPort()` 覆盖。这是 ideall 作为外部消费方、不被单一后端绑死的支点。
- 启动注册由 `@/shell/boot-gate.tsx`（客户端启动闸，挂在根 layout）调用 `boot.ts#registerAll()` 完成（组合根，import 各模块 manifest）。

## Common commands

> 环境：Node ≥ 22、pnpm 9；Tauri 另需 Rust ≥ 1.77.2 与平台系统库 —— 见 [README.md#开发环境](../README.md#开发环境)。

```bash
pnpm install
pnpm dev          # 浏览器开发服（SSR）http://localhost:5020
pnpm build        # 静态导出 → out/（output: export；等同 pnpm app:export）
pnpm clean:next   # 清理 .next/，verify:base 会在 typecheck 前自动执行
pnpm lint         # 含 protocol 纯度强制（no-restricted-imports）
pnpm lint:deps    # 检查未使用、未声明与多余依赖
pnpm lint:docs    # 检查仓库内文档链接与 docs/README.md 收录完整性
pnpm version:check # 校验 package/Tauri/Cargo/Cargo.lock 版本一致
pnpm test         # tsx + node:test（经 scripts/run-tests.mjs；可加子串过滤，如 pnpm test sort-key）
pnpm test:coverage # 为选定核心源码生成 c8 text/lcov，并检查仓库覆盖率基线
pnpm test:scripts # 维护脚本的 node:test 测试

# App（Tauri 跨平台桌面/移动；工程在 src-tauri/，见 docs/app.md）
pnpm app:dev      # 复用或启动 Next 开发服，再启动桌面开发壳
pnpm app:export   # 静态导出 → out/（= pnpm build；数据层已同构客户端化）
pnpm app:build    # 为当前宿主平台打包（跨平台矩阵由 CI 在各平台构建）

# 本地基础门禁（对应 CI 基础检查；会先清理 .next 再 typecheck）
pnpm verify:checks # 不含生产构建的质量门禁，包含 lint:deps
pnpm verify:base   # verify:checks → build → verify:bundle
pnpm verify:bundle # 检查已有 out/ 的 JavaScript raw/gzip bundle 预算
pnpm verify:static-export # 检查 out/ 静态导出关键入口与 _next chunks
pnpm verify:smoke:static  # 生产形态浏览器冒烟：build → serve out/ → notes/files/plugins/trash
pnpm verify:full          # verify:base + 开发服冒烟（自动挑 5020-5023 可用端口）

# API codegen（后端数据服务的 schema 变更后）——产物是 wire DTO，仅供 HTTP 适配器消费
pnpm gen:api      # openapi/server.json → src/lib/api/server.d.ts（离线，普通贡献者只需这一步）
pnpm gen:api:check  # CI 卡点
# 维护者刷新契约源（拿到后端新导出的 openapi.json 时）：
SERVER_LOCAL=/abs/path/to/openapi.json pnpm sync:api
```

脚本入口、参数与新增脚本约定见 [scripts.md](scripts.md)。

## 形态：App-only（Tauri 跨平台）

ideall 仅以 App 形态分发（当前流程见 [app.md](app.md)，历史迁移见 [app-history.md](app-history.md)）：

- **构建**：`output: export` 静态导出（默认且唯一生产构建），Tauri 2.0（`src-tauri/`）打包为 **Windows / Linux / macOS / iOS / Android**。无 Node 运行时 / 无 SSR 生产部署，数据层走**客户端直连后端**（`NEXT_PUBLIC_SERVER_ADDR`）；数据访问已同构客户端化。
- **开发**：`pnpm dev` 仍是本地 SSR 开发服（`pnpm app:dev` 会复用或启动它），不影响导出。
- `lib/env.ts` 的 `SERVER_ADDR` 同构：App 客户端 / 浏览器直连 `NEXT_PUBLIC_SERVER_ADDR`；`pnpm dev` 的 SSR 渲染期服务端读取 `SERVER_ADDR`。客户端直连需后端放行 CORS（App 内 agent 经 `tauri-plugin-http` 绕过）。

## Conventions

- 默认使用 Server Component，仅交互组件添加 `"use client"`。
- UI 复用 `src/ui` 的 shadcn 原语，禁止引入并行 UI 库；视觉决策（阴影 / 颜色 / 圆角 / 间距 / 公共组件）以 [docs/design/ui-style.md](design/ui-style.md) 为准。
- 脚本公共能力集中在 `scripts/script-utils.mjs`；新增验证/冒烟脚本时优先复用其中的命令执行、端口探测、HTTP 就绪等待与子进程清理逻辑；对外长流程脚本应支持 `--help`。
- TypeScript strict；后端取数与 DTO 一律经 `@protocol/server-port`（ServerPort + ideall 自有领域类型）。**业务/protocol 代码禁止 import wire DTO**（`@/lib/api/server`），它仅供 `@/lib/server` 适配器消费。
- 所有 fetch / 数据访问函数必须 `try-catch` + `res.ok` 检查
- 用户可见文案与代码注释均使用简体中文
- **新增功能模块 / 插件**：在 `src/modules/<name>` 或 `src/plugins/<name>` 建模块和 `manifest.ts`，在 `@/shell/boot.ts` 注册；跨模块交互一律经 `@protocol`（新增契约/端口加到 `src/protocol`）。
- **边界**：protocol 不得 import UI/页面（`pnpm lint` 强制）；app 路由不可被反向 import，info/community/tool 互不 import。
- `ideall.core` 的笔记、书签、资源、关注和对话使用统一 Node 对象仓 `STORE_NODES`；音频、数据库、Agent 配置等 provider 保留各自 Storage。个人数据默认不上传，仅在显式同步或发布时经配置的服务端口发送。
