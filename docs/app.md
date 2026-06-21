# ideall：App（跨平台）方案与路线图

ideall **仅以 App 形态分发**，一套 Next.js 代码库经 Tauri 打包为跨平台客户端：

| 项 | 说明 |
| --- | --- |
| **构建** | `next build`（`output: export` → `out/`，默认且唯一生产构建），再由 Tauri 打包 |
| **渲染** | 静态导出（无 Node 运行时 / 无 SSR 生产部署） |
| **部署** | 随 ideall 发版，多平台产物（桌面装包 / 移动应用商店） |
| **数据** | **客户端直连后端**（CORS + JWT） |
| **开发** | `pnpm dev` 是本地 SSR 开发服，供 `pnpm app:dev` 的 Tauri 壳加载 |

App 框架：**Tauri 2.0** —— 单代码库覆盖 **Windows / Linux / macOS 桌面** + **iOS / Android 移动**，Rust 外壳包裹 Web 前端。工程位于 [`src-tauri/`](../src-tauri)。

> 关键约束：iOS/Android 与离线桌面 app **不能跑 Node 服务器**，所以 app 用 Next.js **静态导出** + **客户端经 `ServerPort` 直连后端数据服务**（后端已支持 CORS + JWT；鉴权 crypto 已在 `lib/auth/crypto.ts` 客户端可用，会话已存 localStorage）。已不再分发 Web SSR 生产形态。

## 目录

```
ideall/                         # 独立仓库根 (git@github.com:jinziyou/ideall.git)
├── src/                      # Next.js 应用 (静态导出)
├── src-tauri/                # Tauri 2.0 app 外壳 (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json       # devUrl=localhost:5020 (dev) / frontendDist=../out (打包)
│   ├── build.rs
│   ├── capabilities/         # 权限能力集
│   ├── icons/                # 应用图标 (见 icons/README.md)
│   └── src/{main,lib}.rs
├── out/                      # `pnpm build` (= app:export) 的静态导出产物 (gitignore)
└── docs/app.md               # 本文件
```

## 构建 / 运行命令

```bash
# 开发
pnpm dev            # SSR 开发服 http://localhost:5020 (也是 Tauri 壳的加载源)

# App (Tauri)
pnpm app:dev        # 桌面开发壳: 加载 pnpm dev 起的 localhost:5020
pnpm build          # 静态导出 → out/ (= pnpm app:export)
pnpm app:export     # 静态导出 → out/ (= pnpm build)
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

> 目标平台：Windows / Linux / iOS / Android；macOS 由 Tauri 一并覆盖、随桌面发布。

## 路线图

### ✅ Phase 0 — 基础骨架
- Tauri 2.0 工程 `src-tauri/`（dev 壳已可 `pnpm app:dev` 加载 SSR 开发服）。
- `next.config.ts` 默认 `output: export`（App-only 唯一生产构建）。
- 客户端取数所需 env 接通：`NEXT_PUBLIC_SERVER_ADDR`，`lib/env.ts` 改为**同构**读取（`pnpm dev` SSR 渲染期服务端用 `SERVER_ADDR`，App 客户端用 `NEXT_PUBLIC_SERVER_ADDR`）。
- gitignore 覆盖 `src-tauri/target`、`src-tauri/gen`、`out/`。

### ✅ Phase 1 — 数据层客户端化（`app:export` 已绿）
静态导出不支持 Server Actions / Route Handlers / 请求时 `headers()` / 任意动态路径段，已全部改造：
- 5 个 `"use server"` 文件去指令 → **同构数据访问**（`pnpm dev` SSR 渲染 / app 客户端直连后端共用）：
  现分别为 `community/data`、`info/data`、`lib/auth/auth-api`、`lib/peer-api`、`plugins/sync/lib/sync-api`（已由 `*-action` 改名）。
  （`apiFetch` 本就同构、token 走 localStorage、`SERVER_ADDR` 已同构，故迁移机械低风险。）
- `community/page` async Server Component → 客户端组件（`useEffect` 取数）；去 `force-dynamic`。
  `getVisitorLocation` 暂返回 null（客户端无法读自身公网 IP）→ 地图回退全国，可手动切城市。
- 动态路径段 → **查询参数路由**：`/info/entity/[label]/[name]` → `/info/entity?label=&name=`；
  `/info/publisher/[domain]` → `/info/publisher?domain=`（`useSearchParams` + `Suspense`）。
- `info/analysis` (`await searchParams`) → 客户端 `useSearchParams` 取数。
- **Agent**：删服务端代理 Route Handler，`agent-chat` 改客户端直连 OpenAI 兼容端点（BYO key 留本地）。
  ⚠️ 浏览器直连受厂商 CORS 限制（本地 Ollama / 放行 CORS 的端点可用）；桌面/移动 App 后续接
  Tauri HTTP 插件（`@tauri-apps/plugin-http`，Rust 侧请求绕过 CORS）即可全端点可用 —— 见 Phase 3 待办。

> 验证：`pnpm build`（= `app:export`，21 静态页）✓ · lint ✓ · typecheck ✓ · test 12/12 ✓
> 后端侧：后端数据服务（如 wonita 的 server）的 `CORS_ALLOW_ORIGINS` 需放行 app 来源（`tauri://localhost` / 开发期 `http://localhost:5020`）。

### ✅ Phase 2 — 平台构建与 CI（桌面 + Android 已接，iOS 待证书）
- **图标**：已用品牌字形生成全平台图标集到 `src-tauri/icons/`（桌面 `.ico`/`.icns`/png + Windows Store + Android/iOS）。重做：`pnpm tauri icon <1024.png>`。
- **CI**：`.github/workflows/app-build.yml`（触发：push `main` / `app-v*` tag / 手动）：
  - `gate` 前置 job：tag / 手动总构建；`main` 推送仅当含「非文档/配置」改动才构建（纯文档、`*.md`、`.github/`、`.prettier*` 等提交跳过全平台构建，省 CI）。
  - 桌面 matrix（macOS arm64/x64、Linux、Windows）经 `tauri-apps/tauri-action` 出安装包；先 `create-release` 建唯一 Release、矩阵 `releaseId` 仅上传（规避并发各自建滚动 tag 的竞态）。
  - 两条发布渠道：**push `main` → 滚动预发布 `app-edge`**（永远是 main 最新、直接可下载）；**push `app-v*` tag → 正式 Release 草稿**（人工 review 后发布）。
  - Android：仅 tag/手动时 `tauri android init` + `tauri android build --debug --apk` → 上传 debug APK 工件。
  - `checksums` job：桌面包上传后生成 `SHA256SUMS` 挂回同一 Release（供下载校验完整性）。
  - 静态导出地址由仓库变量注入（未设回退生产默认）：`NEXT_PUBLIC_SERVER_ADDR`（数据服务 apiserver）、`NEXT_PUBLIC_EMBED_BASE`（info/community 内嵌的 wonita/portal）。
- **iOS**：需 Apple 开发者证书/描述文件，未纳入 CI（见 Phase 3）。本地：`pnpm tauri ios init && pnpm tauri ios build`（macOS + Xcode）。
### ✅ Phase 3 — HTTP 插件 / 自动更新（已启用）/ OS 代码签名（待证书）

**HTTP 插件（已接，功能完整）**：`tauri-plugin-http` 已装 + 授权（`capabilities/default.json` 放行任意 `http/https`），`agent-chat` 在 Tauri 内经插件 `fetch`（Rust 侧请求）绕过 webview CORS → **App 内 agent 可直连任意 LLM 端点（含 OpenAI 等云厂商）**；`pnpm dev` 浏览器内调试时仍受厂商 CORS 限制（用本地 Ollama / 放行 CORS 的端点）。

**自动更新（桌面，已启用）**：`tauri-plugin-updater` 已装、`lib.rs` 据 `plugins.updater` 配置条件挂载、桌面能力 `capabilities/desktop.json`（移动端走应用商店）；JS 侧 `lib/updater.ts#checkForUpdate()`，入口在命令台「检查更新」。当前已配齐：

- **签名密钥（minisign）**：`pnpm tauri signer generate` 已生成；私钥设为 GitHub secret `TAURI_SIGNING_PRIVATE_KEY`(+`_PASSWORD`)（CI 签名用）+ 离线备份在密码管理器（1Password/Bitwarden）。公钥在 `tauri.conf.json` `plugins.updater.pubkey`（公开、可入库）。
  - ⚠ **私钥务必长期保管**：公钥编译进 App，装机端只认配对私钥签的更新；**私钥丢失无法对已装机端轮换**（只能让用户手动重装新公钥版本）。GitHub secret 只写、取不回，**不算备份**——权威备份放密码管理器。
- **endpoint**：`tauri.conf.json` 配 `https://github.com/jinziyou/ideall/releases/latest/download/latest.json`，即 GitHub「最新正式 Release」（排除草稿与预发布）。
- **产物**：`bundle.createUpdaterArtifacts: true` + CI 注入 `TAURI_SIGNING_*` → tauri-action 给每个包出 `.sig` 并生成 `latest.json` 挂上 Release。
- **激活条件**：自动更新只认**已发布的「非草稿、非预发布」tag 版**。流程：push `app-v*` tag → 出**草稿** Release（已签名）→ 人工 **publish（去草稿）** → 它成为 `releases/latest` → 装机端「检查更新」即拉到。`app-edge` 预发布也带 `.sig`/`latest.json`，但被 `releases/latest` 排除、不用于自动更新（仅供手动下载试用）。

**OS 代码签名 / 公证（待证书，当前出未签名包）**：未签名时 macOS 被 Gatekeeper 拦（需右键→打开）、Windows 触发 SmartScreen「未知发布者」。各项所需：

| 用途 | 状态 | 所需 secret / 配置 |
| --- | --- | --- |
| 更新签名（minisign） | ✅ 已启用 | `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| macOS 签名 + 公证 | ⏳ 待证书 | Apple 开发者会员（$99/年）→ `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` |
| Windows Authenticode | ⏳ 待证书 | OV/EV 证书，或 **Azure Trusted Signing**（CI 友好，~$10/月）→ 配 `tauri.conf.json` `bundle.windows` 或自定义签名命令 |
| Android release | ⏳ | keystore（`*.jks`）+ 别名/口令（CI 现为 debug APK，release 需补签名 + secret） |
| iOS | ⏳ | Apple 证书 + 描述文件（macOS + Xcode；未纳入 CI） |

> ⚠ **坑（务必照做）**：要出未签名包就**不要**把 `APPLE_*` / `TAURI_SIGNING_*` 以**空字符串**注入 env —— Tauri 会据「env 存在」尝试签名并报 `security import: failed to import keychain certificate` 而构建失败。未启用的签名项**整组不注入**；启用时（配好 secret 后）再在 `desktop` job 的 `env` 加回对应变量（updater 的两项现已注入）。

**发布渠道**：桌面 → GitHub Releases（`app-edge` 滚动预发布 + `app-v*` 正式版，均附 `SHA256SUMS`；正式版 publish 后驱动自动更新）；移动 → App Store / Google Play（各自开发者账号 + 签名）。

## 风险与注意
- **静态导出限制**：去掉 SSR 后，依赖请求时服务端数据的路由需改客户端取数（Phase 1）。`output: export` 下不可用 `next/image` 优化（已设 `images.unoptimized`）、不可用中间件/Route Handlers 作运行时逻辑。
- **CORS / 鉴权**：App 静态导出无服务端代理，客户端直连 `NEXT_PUBLIC_SERVER_ADDR`。App 内 agent 经 `tauri-plugin-http` 绕过 CORS（Phase 3 已用）；调后端 server 时若用 webview `fetch`，后端侧 `CORS_ALLOW_ORIGINS` 需放行 app 来源（`tauri://localhost` / 开发期 `http://localhost:5020`，属后端部署配置），或同样改用插件 fetch。
- **深链/路由**：Tauri 加载静态资源用相对路径；如遇路由 404，可加 `trailingSlash: true` 或自定义协议处理。
- **图标**：已生成全平台图标集到 `src-tauri/icons/`；替换为正式品牌图重跑 `pnpm tauri icon <1024.png>`。
