# ideall：App（桌面 / 移动）

ideall **仅以 App 形态分发**：一套 Next.js 代码库经 Tauri 打包为跨平台客户端。

| 项 | 当前口径 |
| --- | --- |
| **构建** | `next build`（`output: export` → `out/`），再由 Tauri 打包 |
| **渲染** | 静态导出；无 Node 运行时 / 无 SSR 生产部署 |
| **数据** | 客户端经 `ServerPort` 直连后端数据服务（CORS + JWT） |
| **开发** | `pnpm dev` 本地 SSR 开发服供 `pnpm app:dev` 的 Tauri 壳加载 |
| **发布** | 桌面走 GitHub Releases；移动走应用商店 |

历史迁移路线见 [app-history.md](app-history.md)。

## 目录

```text
ideall/
├── src/                      # Next.js 应用（静态导出）
├── src-tauri/                # Tauri 2.0 app 外壳（Rust）
│   ├── Cargo.toml
│   ├── tauri.conf.json       # devUrl=localhost:5020 / frontendDist=../out
│   ├── capabilities/         # 权限能力集
│   ├── icons/                # 应用图标
│   └── src/{main,lib}.rs
├── out/                      # 静态导出产物（gitignore）
└── docs/app.md               # 本文件
```

## 开发环境 / 前置依赖

日常 Web 开发只需 **Node.js ≥ 22** + **pnpm 9**（见根目录 `package.json`）。Tauri 桌面/打包另需 **Rust ≥ 1.77.2** 与下表平台依赖；装完后在仓库根执行 `pnpm exec tauri info`，**Environment** 段应全绿。

| 平台 | 系统依赖（概要） | 验证 |
| --- | --- | --- |
| **Linux / WSL** | `libwebkit2gtk-4.1-dev`、`librsvg2-dev`、`libgtk-3-dev`、`libayatana-appindicator3-dev`、`build-essential`、`libssl-dev`、`libxdo-dev`、`pkgconf` 等 | `pnpm exec tauri info` → webkit2gtk / rsvg2 ✔ |
| **Windows** | MSVC Build Tools + WebView2 Evergreen | 同上 |
| **macOS** | Xcode 或 Command Line Tools | 同上 |
| **Android** | JDK、Android SDK/NDK；`pnpm tauri android init` | `rustup target add` 各 Android triple |
| **iOS** | macOS + Xcode；`pnpm tauri ios init` | 仅 macOS 构建机 |

**Linux / WSL 一键安装（Debian 系，含 Kali）：**

```bash
sudo apt-get update && sudo apt-get install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev \
  librsvg2-dev libgtk-3-dev pkgconf
```

WSL 图形依赖 **WSLg**；dbus/GTK 包更新后窗口仍异常时，Windows 侧 `wsl --shutdown` 后重开。详见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

> **窗口空白（WSL2 无 GPU）**：WebKitGTK 的 DMABUF / 加速合成渲染在 WSL2 常初始化失败（`libEGL` / `MESA ZINK` / `dri2` 报错）导致窗口空白。`scripts/app-dev.mjs` 会在 Linux 启动前注入 WebKitGTK 软件渲染与 WSLg 相关环境变量；已手动 export 同名变量则以你的为准。

## 构建 / 运行命令

```bash
# 开发
pnpm dev            # SSR 开发服 http://localhost:5020（也是 Tauri 壳的加载源）
pnpm app:dev        # 桌面开发壳：复用或启动上面的 dev 服

# 构建
pnpm build          # 静态导出 → out/（= pnpm app:export）
pnpm app:export     # 静态导出 → out/（= pnpm build）
pnpm app:build      # 多平台打包（依赖 app:export + 平台工具链/图标）

# 本地基础门禁
pnpm verify:base
```

### 指定备用端口启动（5020 被占用时）

默认 `pnpm app:dev` 内部走 `next dev -p 5020`。WSL 下编辑器（Cursor / VS Code Remote）的自动端口转发可能钉死 5020，导致反复报 `EADDRINUSE: address already in use :::5020`。

换个端口启动即可绕开——用 Tauri 的 `--config` 内联覆盖 `devUrl` 与 `beforeDevCommand`；末尾参数经 `app:dev` 原样透传给 `tauri dev`：

```bash
pnpm app:dev --config '{"build":{"devUrl":"http://localhost:5026","beforeDevCommand":"pnpm exec next dev -p 5026"}}'
```

- `beforeDevCommand` 改为 `pnpm exec next dev -p 5026` → 前端开发服起在 5026。
- `devUrl` 同步指到 5026 → Tauri 壳加载它。
- 端口随意换（5026 仅示例，挑一个 `ss -ltn` 里没占用的即可）；若某些 pnpm 版本未透传参数，改用 `pnpm app:dev -- --config '...'`。

## 环境变量

完整示例见 [`.env.example`](../.env.example)。常用变量：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `NEXT_PUBLIC_SERVER_ADDR` | App 客户端直连的后端 API 基址 | `https://api.wonita.link` |
| `SERVER_ADDR` | 仅 `pnpm dev` 的 SSR 渲染期读取；不设时回退到上一项 | 同 `NEXT_PUBLIC_SERVER_ADDR` |
| `NEXT_PUBLIC_EMBED_BASE` | info/community iframe 嵌入的 portal 基址 | `https://www.wonita.link` |
| `NEXT_PUBLIC_XSTATE_INSPECT` | 开发态 XState Inspector；设为 `0` 关闭 | 开启 |
| `IDEALL_BROWSER_CDP` | Linux/WSL 内嵌浏览器后端；设为 `1` 启用 CDP 模式 | WebKit 内嵌 |

## 平台矩阵

| 平台 | Tauri 目标 | 构建机要求 | 产物 |
| --- | --- | --- | --- |
| Linux | desktop | Linux + webkit2gtk | `.deb` / `.rpm` / `.AppImage` |
| Windows | desktop | Windows + WebView2 | `.msi` / `.exe` (NSIS) |
| macOS | desktop | macOS + Xcode CLT | `.dmg` / `.app` |
| iOS | mobile | macOS + Xcode | `.ipa` |
| Android | mobile | JDK + Android SDK/NDK | `.apk` / `.aab` |

## CI / 发布

CI 分三层：

- `.github/workflows/ci.yml`：format / lint / workflow lint / typecheck / test / API drift / build。
- `.github/workflows/rust.yml`：`src-tauri/**` 改动时跑 cargo check、clippy 零警告和 cargo test。
- `.github/workflows/smoke.yml`：应用面改动时跑静态导出生产形态的浏览器冒烟。

App 发布由 `.github/workflows/app-build.yml` 负责：

- push `main` → 滚动预发布 `app-edge`。
- push `app-v*` tag → 正式 Release 草稿（人工 review 后发布）。
- workflow_dispatch → 手动构建。
- 桌面 matrix 产出 macOS / Linux / Windows 安装包，并生成 `SHA256SUMS`。
- Android 仅 tag / 手动时产出 debug APK；iOS 需 Apple 证书与 macOS 构建机，未纳入 CI。

静态导出地址由 GitHub 仓库变量注入；未设置时回退到生产默认：

- `NEXT_PUBLIC_SERVER_ADDR`
- `NEXT_PUBLIC_EMBED_BASE`

## 签名 / 自动更新

**自动更新（桌面，已启用）**：

- `tauri-plugin-updater` 已配置，endpoint 指向 GitHub 最新正式 Release 的 `latest.json`。
- `bundle.createUpdaterArtifacts: true` + CI 注入 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 后，tauri-action 为安装包生成 `.sig` 与 `latest.json`。
- 自动更新只认已发布的「非草稿、非预发布」正式 tag 版。

发版流程：

```bash
pnpm bump <x.y.z>      # 同步 package.json / tauri.conf.json / Cargo.toml / Cargo.lock
git tag app-v<x.y.z>
git push origin main app-v<x.y.z>
```

CI 会检查 `app-v*` tag 与 `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 版本一致；不一致直接失败。

**OS 代码签名 / 公证（待证书，当前出未签名包）**：

| 用途 | 状态 | 所需 secret / 配置 |
| --- | --- | --- |
| 更新签名（minisign） | ✅ 已启用 | `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| macOS 签名 + 公证 | ⏳ 待证书 | Apple 开发者会员 → `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` |
| Windows Authenticode | ⏳ 待证书 | OV/EV 证书，或 Azure Trusted Signing |
| Android release | ⏳ | keystore（`*.jks`）+ 别名/口令 |
| iOS | ⏳ | Apple 证书 + 描述文件 |

> 要出未签名包就**不要**把 `APPLE_*` / `TAURI_SIGNING_*` 以空字符串注入 env；Tauri 会据「env 存在」尝试签名并失败。未启用的签名项整组不注入。

## 风险与注意

- **静态导出限制**：不可用 Server Actions / Route Handlers / 请求时 `headers()` / 任意动态路径段 / `next/image` 优化（已设 `images.unoptimized`）。依赖请求时服务端数据的路由需客户端取数。
- **CORS / 鉴权**：App 静态导出无服务端代理，客户端直连 `NEXT_PUBLIC_SERVER_ADDR`。后端侧需放行 app 来源（`tauri://localhost` / 开发期 `http://localhost:5020`）。App 内 agent 经 `tauri-plugin-http` 绕过 webview CORS。
- **深链/路由**：Tauri 加载静态资源用相对路径；如遇路由 404，可加 `trailingSlash: true` 或自定义协议处理。
- **图标**：已生成全平台图标集到 `src-tauri/icons/`；替换为正式品牌图后重跑 `pnpm tauri icon <1024.png>`。
