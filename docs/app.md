# myos：Web + App（跨平台）方案与路线图

myos 一套 Next.js 代码库，产出两种形态：

| 形态 | 构建 | 渲染 | 部署 | 数据 |
| --- | --- | --- | --- | --- |
| **Web** | `next build`（`output: standalone`，默认） | SSR + Server Components | **wonita 仓库编排**，从 `peer/` submodule 构建（代码仍在 myos）| 服务端取数（现状） |
| **App** | `BUILD_TARGET=app next build`（`output: export` → `out/`），Tauri 打包 | 静态导出（无 Node 运行时） | 随 myos 发版，多平台产物 | **客户端直连后端**（CORS + JWT）|

App 框架：**Tauri 2.0** —— 单代码库覆盖 **Linux / Windows / macOS 桌面** + **iOS / Android 移动**，Rust 外壳包裹 Web 前端，与 super/server 的 Rust 栈一致。工程位于 [`peer/src-tauri/`](../src-tauri)。

> 关键约束：iOS/Android 与离线桌面 app **不能跑 Node 服务器**，所以 app 用 Next.js **静态导出** + **客户端直连 super/server**（后端已支持 CORS + JWT；鉴权 crypto 已在 `lib/auth/crypto.ts` 客户端可用，会话已存 localStorage）。Web 形态不受影响，继续 SSR。

## 目录

```
peer/
├── src/                      # Next.js 应用 (web + app 共用)
├── src-tauri/                # Tauri 2.0 app 外壳 (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json       # devUrl=localhost:3000 (dev) / frontendDist=../out (打包)
│   ├── build.rs
│   ├── capabilities/         # 权限能力集
│   ├── icons/                # 应用图标 (见 icons/README.md)
│   └── src/{main,lib}.rs
├── out/                      # `BUILD_TARGET=app next build` 的静态导出产物 (gitignore)
└── docs/app.md               # 本文件
```

## 构建 / 运行命令

```bash
# Web (现状, 不变)
pnpm dev            # SSR 开发 http://localhost:3000
pnpm build          # 生产 (output: standalone)

# App (Tauri)
pnpm app:dev        # 桌面开发壳: 加载 pnpm dev 起的 localhost:3000 (Phase 0 即可用)
pnpm app:export     # 静态导出 → out/ (BUILD_TARGET=app; 依赖 Phase 1 数据层客户端化)
pnpm app:build      # 多平台打包 (依赖 app:export + 平台工具链/图标)

# 首次需要 Rust + 平台依赖:
#   Linux:   libwebkit2gtk-4.1-dev、build-essential 等 (见 Tauri 文档)
#   移动端:  iOS=Xcode；Android=Android SDK/NDK，`pnpm tauri android init` / `ios init`
```

## 平台矩阵

| 平台 | Tauri 目标 | 构建机要求 | 产物 |
| --- | --- | --- | --- |
| Linux | desktop | Linux + webkit2gtk | `.deb` / `.rpm` / `.AppImage` |
| Windows | desktop | Windows + WebView2 | `.msi` / `.exe` (NSIS) |
| macOS | desktop | macOS + Xcode CLT | `.dmg` / `.app` |
| iOS | mobile | macOS + Xcode | `.ipa` |
| Android | mobile | JDK + Android SDK/NDK | `.apk` / `.aab` |

> 需求列了 Linux/Windows/iOS/Android；macOS 由 Tauri 顺带覆盖，可选发布。

## 路线图

### ✅ Phase 0 — 基础骨架（本次）
- Tauri 2.0 工程 `peer/src-tauri/`（dev 壳已可 `pnpm app:dev` 加载 SSR 开发服）。
- `next.config.ts` 按 `BUILD_TARGET=app` 切换到 `output: export`。
- 客户端取数所需 env 接通：`NEXT_PUBLIC_SERVER_ADDR`，`lib/env.ts` 改为**同构**读取（服务端仍用 `SERVER_ADDR`，客户端用 `NEXT_PUBLIC_SERVER_ADDR`）。
- gitignore/dockerignore 覆盖 `src-tauri/target`、`src-tauri/gen`、`out/`。
- Web 生产部署回流 wonita（`scripts/prod.sh`、`scripts/deploy.sh` 从 `peer/` 构建）。

### ⏭ Phase 1 — 数据层客户端化（让 `app:export` 变绿）
静态导出**不支持 Server Actions**，需把 5 个 `"use server"` 文件改为同构/客户端取数：
`community/action.ts`、`info/action.ts`、`lib/auth/auth-action.ts`、`lib/peer-action.ts`、`plugins/sync/lib/sync-action.ts`。

迁移配方（逐文件，低风险——`apiFetch` 已同构、token 已走 localStorage）：
1. 去掉文件首行 `"use server"`。
2. 取数基址改用同构 `SERVER_ADDR`（已支持 `NEXT_PUBLIC_SERVER_ADDR`）。
3. 需要 token 的调用沿用现有「显式传 token」约定（如 `fetchMe(token)`、`publish(session.token, …)`）。
4. 确认调用方在客户端组件里 `await`（Server Component 直出的取数改为客户端 `useEffect`/数据获取，或在 web 侧保留 SSR 分支）。
5. 后端 CORS 放行 app 来源（`tauri://localhost`、`capacitor://`、`http://tauri.localhost` 等）。

> Web 侧若要保留 SSR 直出，可让数据层同构（同一函数服务端/客户端都能跑），web 走 SSR、app 走客户端。本仓库 `apiFetch` 已满足同构前提。

### ⏭ Phase 2 — 平台构建与 CI
- `pnpm tauri icon <1024.png>` 生成各平台图标。
- 桌面三平台 GitHub Actions matrix（`tauri-apps/tauri-action`）。
- 移动端：`tauri android init` / `tauri ios init`，CI 加 Android SDK / macOS runner。

### ⏭ Phase 3 — 签名与发布
- Windows 代码签名证书；macOS notarization；Android keystore 签名；iOS 证书/描述文件。
- Tauri updater（桌面自动更新）签名密钥。
- 发布渠道：GitHub Releases（桌面）、App Store / Google Play（移动）。

## 风险与注意
- **静态导出限制**：去掉 SSR 后，依赖请求时服务端数据的路由需改客户端取数（Phase 1）。`output: export` 下不可用 `next/image` 优化（已设 `images.unoptimized`）、不可用中间件/Route Handlers 作运行时逻辑。
- **CORS / 鉴权**：app 直连后端，super/server 的 `CORS_ALLOW_ORIGINS` 需放行 app 来源（属 super 侧配置）。
- **深链/路由**：Tauri 加载静态资源用相对路径；如遇路由 404，可加 `trailingSlash: true` 或自定义协议处理。
- **图标缺失**：未生成图标时 `pnpm app:build` 会失败（`app:dev` 不需要）。见 `src-tauri/icons/README.md`。
