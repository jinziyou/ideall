# CLAUDE.md

## Repository

myos 是 Wonita 生态面向用户的**客户端前端** (Next.js)，本仓库为源码权威仓库。
整体定位见 [README.md](README.md)；API 契约同步见下方 "API codegen"。
信息采集 / NLP / 知识图谱 / 鉴权由官方信息服务（后端，闭源）提供，myos 经 `SERVER_ADDR` 连接，不在本仓库范围内。

## Positioning

myos 是 Wonita（**本地优先的个人信息总控终端**）面向用户的**用户界面**: 从个人视角出发,
把分散的他人、信息、资源、工具聚合到一处。

**home 是信息中枢, info / community / tool 三个模块都为 home 服务** (hub-and-spoke):
home 通过**订阅**把「发现」里的来源 (发布者 / 实体 / 工具 / 搜索 / 社区发布者 peer) 回流到
`/home/subscriptions` 订阅流; 订阅偏好本地优先 (IndexedDB), 内容实时拉取。
**跨端同步 (端到端加密, 无账号)**: 同步码在浏览器派生 storageId + AES 密钥, 只上传密文。
**社区 = 用户/peer 发布层 (账号)**: 登录后发布内容成为社区发布者, 他人订阅其发布进订阅流。
**账号 (公开发布身份) 与跨端同步的无账号同步码是两套独立身份**。

## 架构: 扁平三目录 (src/ 下)

常规 Next.js 布局: 路由与核心实现同址, 共享代码归 components, 契约独立。

| 目录 | 别名 | 内容 |
|---|---|---|
| **app** | `@/app/*` | Next 路由 + 核心实现同址: `home/` 中枢 (dashboard/订阅/书签/资源/发布 + IndexedDB 数据层 `home/lib`, 页面即路由)、`shell/` 全局壳 (header/nav/命令台/主题/`boot`, 非路由)、`nav/` 导航配置、`(discover)/` 与 `auth` 等路由入口 |
| **components** | `@/components/*` | 全部共享代码: `apps/` 三应用模块 (`info` / `community` / `tool`, 页面组件由 app 路由薄 re-export)、`plugins/` (`agent` AI 助手 + `sync` 跨端同步)、`lib/` 纯工具 (utils/format/idb/sync-crypto/auth/api/...)、`ui/` shadcn 原语、`feeders/` 等共享 UI |
| **protocol** | `@protocol/*` | 跨模块契约 (纯端口/类型/纯函数, 不含 UI): subscription/content(解析注册表)/flowback/hub-data(HubDataPort)/sync(SyncPort)/peer/auth/transport/server |

ESLint 仅强制 **protocol 纯度**: 契约层只可依赖 `@/components/lib` 纯工具, 不得 import UI 或页面代码。
其余依赖方向不再用 lint 强制, 但仍遵循惯例: components 不 import app; info/community/tool 互不 import。

### 依赖反转 (模块经 protocol 而非互相直连)

- **内容 feed**: 中枢订阅流调 `@protocol/content` 的 `resolveSubscription`; info/community 在各自 `manifest.ts`
  注册 resolver (info 管 publisher/entity/search, community 管 peer)。
- **中枢数据**: 反馈组件 (`@/components/feeders`) 与 agent 插件经 `@protocol/hub-data` 的 `getHubData()`
  (HubDataPort, 中枢在 boot 注册实现) 读写订阅/书签/资源, 不直接依赖中枢存储。
- **跨端同步**: 中枢同步面板调 `@protocol/sync` 的 `getSyncPort()`; sync 插件 `manifest.ts` 注册 SyncPort。
- 启动注册由 `app/shell/boot-gate.tsx` (客户端启动闸, 挂在根 layout) 调 `boot.ts#registerAll()` 完成
  (组合根, import 各模块 manifest)。

## Common commands

```bash
pnpm install
pnpm dev          # Web (SSR) http://localhost:3000
pnpm build        # Web 生产 (output: standalone)
pnpm lint         # 含 protocol 纯度强制 (no-restricted-imports)
pnpm test         # node --test：protocol/sync (合并) + components/lib/sync-crypto

# App (Tauri 跨平台桌面/移动; 工程在 src-tauri/, 见 docs/app.md)
pnpm app:dev      # 桌面开发壳 (加载 pnpm dev 的 localhost:3000)
pnpm app:export   # 静态导出 → out/ (BUILD_TARGET=app; 依赖数据层客户端化)
pnpm app:build    # 多平台打包 (需平台工具链 + 图标)

# API codegen (改了 super/server 的 schema 后)
pnpm gen:api      # openapi/server.json → src/components/lib/api/server.d.ts (离线, 普通贡献者只需这一步)
pnpm gen:api:check  # CI 卡点
# 维护者刷新契约源 (拿到后端新导出的 openapi.json 时):
SERVER_LOCAL=/abs/path/to/openapi.json pnpm sync:api
```

## 形态：Web + App

同一套 Next.js 代码两种构建目标 (见 [docs/app.md](docs/app.md)):
- **Web** (默认): `output: standalone` SSR；官方生产实例由 wonita 仓库编排部署 (代码仍在本仓)。
- **App**: `BUILD_TARGET=app` → `output: export` 静态导出，Tauri 2.0 (`src-tauri/`) 打包为 Linux/Windows/macOS/iOS/Android。无 Node 运行时，故数据层走**客户端直连后端** (`NEXT_PUBLIC_SERVER_ADDR`)；Server Actions 需逐步客户端化 (docs/app.md Phase 1)。
- `lib/env.ts` 的 `SERVER_ADDR` 已同构 (服务端 `SERVER_ADDR` / 客户端 `NEXT_PUBLIC_SERVER_ADDR`)。

## Conventions

- 默认 Server Component, 仅交互组件加 `"use client"`
- UI 复用 `src/components/ui` 的 shadcn 原语, 禁止引入并行 UI 库
- TypeScript strict, 跨后端 DTO 一律从 `@protocol/server` (源 `src/components/lib/api/server.d.ts`) 派生
- 所有 fetch / Server Action 必须 `try-catch` + `res.ok` 检查
- 用户可见文案与代码注释均使用简体中文
- **新增功能模块 / 插件**: 在 `src/components/apps/<name>` 或 `src/components/plugins/<name>` 建模块 +
  `manifest.ts`, 在 `app/shell/boot.ts` 注册; 跨模块交互一律经 `@protocol` (新增契约/端口加到 `src/protocol`)
- **边界**: protocol 不得 import UI/页面 (`pnpm lint` 强制); components 不 import app、
  info/community/tool 互不 import 为惯例约束
- 本地优先模块的数据存 IndexedDB (`@/components/lib/idb`); 个人数据默认不上传, 仅跨端同步/发布时经 super 节点
