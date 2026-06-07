# CLAUDE.md

## Repository

`peer` 是 [Wonita](https://github.com/jinziyou/wonita) monorepo 中的用户节点 (myos) 前端。
全局布局与 API 契约同步见根目录 [`CLAUDE.md`](../../CLAUDE.md)。

## Positioning

myos 是 Wonita（**本地优先的个人信息总控终端**）面向用户的**用户界面**: 从个人视角出发,
把分散的他人、信息、资源、工具聚合到一处。

**home 是信息中枢, info / community / tool 三个模块都为 home 服务** (hub-and-spoke):
home 通过**订阅**把「发现」里的来源 (发布者 / 实体 / 工具 / 搜索 / 社区发布者 peer) 回流到
`/home/subscriptions` 订阅流; 订阅偏好本地优先 (IndexedDB), 内容实时拉取。
**跨端同步 (端到端加密, 无账号)**: 同步码在浏览器派生 storageId + AES 密钥, 只上传密文。
**社区 = 用户/peer 发布层 (账号)**: 登录后发布内容成为社区发布者, 他人订阅其发布进订阅流。
**账号 (公开发布身份) 与跨端同步的无账号同步码是两套独立身份**。

## 架构: OS 式 5 子项目 (src/ 下)

借鉴操作系统概念组织, 用 tsconfig 路径别名 + ESLint `no-restricted-imports` **强制**依赖方向:

| 子项目 | 别名 | OS 类比 | 内容 |
|---|---|---|---|
| **core** | `@core/*` | 内核 + shell | `hub/` 中枢 (dashboard/订阅/书签/资源/发布 + IndexedDB 数据层 `hub/lib`)、`shell/` 全局壳 (header/nav/命令台/主题/`boot`)、`nav/` |
| **apps** | `@app/*` | 用户态应用 | `info` / `community` / `tool` —— **三者完全独立**, 互不 import、不碰 core/plugin |
| **plugins** | `@plugin/*` | 内核模块 | `agent` (AI 助手) + `sync` (跨端同步) —— 经 protocol 挂到 core |
| **lib** | `@lib/*` / `@/lib/*` | libc | 纯共享叶子: utils/format/id/env/ner-labels/safe-url/idb/hub-format/sync-code/sync-crypto + auth/api/peer-action 实现 |
| **protocol** | `@protocol/*` | ABI / IPC | 跨子项目契约: subscription/content(解析注册表)/flowback/hub-data(HubDataPort)/sync(SyncPort)/peer/auth/transport/server + feeders |

**依赖方向 (单向)**: `protocol→lib`; `lib→∅`; `app/*→{protocol,lib,components}`;
`plugin/*→{protocol,lib,components}`; `core→{protocol,lib,components}` (插件经 `@protocol` registry 触达)。
唯一例外: 组合根 `core/shell/boot.ts` 可 import 各 `@app/*/manifest`、`@plugin/*/manifest`。

**`src/app/` 仅放 Next 路由入口** (薄 re-export, 真实代码在 `@core`/`@app`/`@plugin`)。

### 依赖反转 (app/plugin 经 protocol 而非直连 core)

- **内容 feed**: 中枢订阅流调 `@protocol/content` 的 `resolveSubscription`; info/community 在各自 `manifest.ts`
  注册 resolver (info 管 publisher/entity/search, community 管 peer)。core 不 import app。
- **中枢数据**: app 反馈组件 (`@protocol/feeders`) 与 agent 插件经 `@protocol/hub-data` 的 `getHubData()`
  (HubDataPort, core 在 boot 注册实现) 读写订阅/书签/资源, 不直接依赖 core 存储。
- **跨端同步**: core 同步面板调 `@protocol/sync` 的 `getSyncPort()`; sync 插件 `manifest.ts` 注册 SyncPort。
- 启动注册由 `core/shell/boot-gate.tsx` (客户端启动闸, 挂在根 layout) 调 `boot.ts#registerAll()` 完成。

## Common commands

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build
pnpm lint         # 含依赖边界强制 (no-restricted-imports)
pnpm test         # node --test：protocol/sync (合并) + lib/sync-crypto

# API codegen (改了 super/server 的 schema 后跑)
pnpm sync:api     # 从 super/server/openapi.json 同步 → openapi/server.json
pnpm gen:api      # → src/lib/api/server.d.ts
pnpm gen:api:check  # CI 卡点
```

## Conventions

- 默认 Server Component, 仅交互组件加 `"use client"`
- UI 复用 `src/components/ui` 的 shadcn 原语, 禁止引入并行 UI 库
- TypeScript strict, 跨后端 DTO 一律从 `@protocol/server` (源 `src/lib/api/server.d.ts`) 派生
- 所有 fetch / Server Action 必须 `try-catch` + `res.ok` 检查
- 用户可见文案与代码注释均使用简体中文
- **新增 app / plugin**: 在 `src/apps/<name>` 或 `src/plugins/<name>` 建模块 + `manifest.ts`,
  在 `core/shell/boot.ts` 注册; 跨子项目交互一律经 `@protocol` (新增契约/端口加到 `src/protocol`)
- **边界**: app/plugin 不得 import `@core`/其他 app/plugin (`pnpm lint` 强制); 越界请改走 `@protocol`
- 本地优先模块的数据存 IndexedDB (`@/lib/idb`); 个人数据默认不上传, 仅跨端同步/发布时经 super 节点
