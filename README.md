# ideall

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**个人信息终端**

**设计思想：一切皆文件，一切皆标签页。** 数据统一成文件，表现统一成标签页。

**设计风格：现代 · 面板 · 留白。**

## 项目组成

| 组件 | 说明 |
| --- | --- |
| **ideall** | 项目本体：跨平台 App（Android / iOS / Windows / macOS / Linux），管理本地数据，并连接 AI、应用与 Web |
| **wonita** | 数据服务（独立项目）：数据同步、资讯与社区；提供默认后端实现 |

## 为什么做这个项目

- **个人视角、本地优先**：给我自己开发使用的项目
- **不想来回切换多个软件**
- **我想自己决定看什么**

## 五个分区

终端按五个产品分区组织。**「我的」(home) 是本机数据区**，**apps（应用）是本机已安装应用的启动器**（Tauri 桌面 / 本地模式专属、零后端）；`info`（资讯）/ `community`（社区）/ `tool`（工具）是三个**发现**模块——它们发现的内容经**关注汇入「我的」**：

| 模块 | 路由 | 角色 | 是否依赖远程后端 |
| --- | --- | --- | --- |
| 我的 (home) | `/home` | 本机数据区：概览 / 笔记 / 书签 / 资源 / 关注 / 对话；本地优先（**发布**需账号，见 [architecture.md](docs/architecture.md)） | 否 |
| apps（应用） | `/apps` | 本机已安装应用启动器：列举并一键启动本机已装应用 | 否（**Tauri 桌面 / 本地模式专属**，零后端） |
| info | `/info` | 信息聚合展示（发现界面默认 wonita 应用嵌入，经[嵌入桥](docs/ideall-embed-bridge.md)可换源） | 是（后端数据服务） |
| community | `/community` | 发布者地图、关注与发布（发现界面默认 wonita 应用嵌入，可换源） | 是（后端数据服务） |
| tool | `/tool` | 工具聚合（搜索 / AI / 导航） | 否（本地外链启动器，历史仅存本机） |

> 活动栏另有两个**工作区级入口**（不属产品分区）：**浏览器**（`/browser`，连接模式的内嵌 webview 标签）与 **AI**（`/ai`，右侧常驻对话栏与 AI 区段标签）。
>
> 想深入领域模型、模块边界、数据流图与关键不变量？见 [docs/architecture.md](docs/architecture.md)。

## 开源客户端与后端服务

本仓库（**ideall**）是 **Apache 2.0** 开源的客户端，可自由使用、修改、自托管。后端取数经 `ServerPort` 契约消费——**ideall 不被任何单一后端绑死**，wonita 只是默认与参考实现。

| | ideall（本仓库） | wonita 后端服务（默认，可换） |
| --- | --- | --- |
| 内容 | Next.js 前端、本地 home、插件、BYO-key agent | 采集、NLP、知识图谱、实体/事件追踪、鉴权 API |
| 许可 | [Apache 2.0](LICENSE) | 闭源，官方运营（也可自实现 `ServerPort` 替换） |
| 角色 | 独立可用的本地终端 | 可选的「语料级智能」增强 |
| 商标 | **Wonita** 名称与官方 logo 不随 Apache 2.0 许可转让 | **Wonita** 品牌与官方数据 |

**要点：**

- **本地能力（home / apps / tool / 同步 / agent）零后端即可用**——离线、无账号、数据存在你设备上（apps 为 Tauri 桌面 / 本地模式专属）。
- **agent 是横跨本地的 AI 环境层**：除自带 LLM 密钥（BYO-key）直连 OpenAI 兼容端点外，还可**连接外部 ACP agent / 外部 MCP**，并能**联网搜索 / 抓取网页**（出站受 egress 守卫的 SSRF 防护约束）。
- **需要聚合 / 知识图谱时**：默认连接 [wonita 后端](#连接后端)；也可换用自建后端或自行实现 `ServerPort`。
- **请勿**用 Wonita 商标对外提供竞争性信息服务，或冒充官方 Wonita / ideall 网络。

本仓库是该客户端的源码权威仓库。个人数据默认不上传，仅跨端同步 / 发布时经后端服务。

ideall **仅以 App 形态分发**：同一套 Next.js 代码经 **Tauri 2.0** 静态导出后打包为**跨平台客户端 —— Windows / Linux / macOS 桌面 + iOS / Android 移动**。无 Node 运行时、无 SSR 生产服务端，客户端直连后端数据服务。详见 [App（桌面 / 移动）](#app桌面--移动) 与 [docs/app.md](docs/app.md)。

## 开发环境

### 通用（Web 与 App）

| 工具 | 版本 | 说明 |
| --- | --- | --- |
| **Node.js** | ≥ 22 | Next.js 16 运行时 |
| **pnpm** | 9（见 `package.json` 的 `packageManager`） | 包管理；可用 `corepack enable` 对齐版本 |

仅跑浏览器态开发（`pnpm dev` / `pnpm build` / lint / test）装以上两项即可。

### Tauri 桌面壳（`pnpm app:dev` / `app:build`）

另需 **Rust ≥ 1.77.2**（见 `src-tauri/Cargo.toml` 的 `rust-version`）及对应平台的系统依赖。安装后可用 `pnpm exec tauri info` 自检 Environment 是否全绿。

**Linux / WSL（Debian / Ubuntu / Kali 等）**

```bash
sudo apt-get update && sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl wget file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libgtk-3-dev \
  pkgconf
```

> WSL 需启用 **WSLg** 才能弹出 Tauri 窗口（Win11 自带）。首次装完 GTK/dbus 相关包后若图形异常，可在 Windows 执行 `wsl --shutdown` 再重开 WSL。

**Windows**：[Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)。

**macOS**：Xcode 或 `xcode-select --install`（Command Line Tools）。

完整平台矩阵与移动端（iOS / Android）工具链见 [docs/app.md](docs/app.md#开发环境--前置依赖) 与 [Tauri 官方前置依赖](https://v2.tauri.app/start/prerequisites/)。

## 快速开始

```bash
git clone git@github.com:jinziyou/ideall.git
cd ideall
cp .env.example .env.local   # 按需选择官方或自托管后端地址
pnpm install
pnpm dev                     # 开发服 http://localhost:5020（也是 Tauri 壳的加载源）
# bash scripts/run.sh        # 等价于 pnpm dev
pnpm app:dev                 # 起 Tauri 桌面开发壳（加载上面的 dev 服）
```

### 连接后端

开箱默认连官方 wonita（`https://api.wonita.link` + iframe `https://www.wonita.link`），见 [`.env.example`](.env.example)。home / tool 不依赖后端；info / community 需可用后端（经 `ServerPort` 契约；wonita 是默认实现）。

| 场景 | 做法 |
| --- | --- |
| **独立运行 / 官方后端** | 无需配置，或复制 `.env.example` → `.env.local` |
| **联调自建 / 本地后端** | 复制 `.env.example` → `.env.local`，把 `NEXT_PUBLIC_SERVER_ADDR` / `NEXT_PUBLIC_EMBED_BASE` 指向你的后端地址（`.env.local` 不入库） |

客户端直连需后端放行 CORS（见 [docs/app.md](docs/app.md)）。

## App（桌面 / 移动）

ideall 同一套代码经 **Tauri 2.0** 打包为跨平台客户端（Windows / Linux / macOS / iOS / Android），工程在 [`src-tauri/`](src-tauri)。App 用 Next.js 静态导出（`output: export`）+ 客户端直连后端（`NEXT_PUBLIC_SERVER_ADDR`）。

```bash
pnpm app:dev        # 桌面开发壳（加载 pnpm dev 的 localhost:5020）
pnpm app:export     # 静态导出 → out/（= pnpm build）
pnpm app:build      # 多平台打包（需平台工具链 + 图标 pnpm tauri icon）
pnpm lint           # 含 protocol 纯度强制
pnpm typecheck
```

完整方案、平台矩阵与分阶段路线图见 [docs/app.md](docs/app.md)。

## 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `NEXT_PUBLIC_SERVER_ADDR` | App 客户端直连的后端 API 基址 | `https://api.wonita.link` |
| `NEXT_PUBLIC_EMBED_BASE` | info/community iframe 嵌入的 portal 基址 | `https://www.wonita.link` |
| `SERVER_ADDR` | 仅 `pnpm dev` SSR 渲染期在服务端读取；不设时回退到上一项 | 同 `NEXT_PUBLIC_SERVER_ADDR` |

## API 类型同步（codegen）

ideall 调用后端数据服务的类型来自 OpenAPI schema（经 `ServerPort` 契约消费；wonita 的 server 是其一个参考实现），**不手写 DTO**：

```
openapi/server.json             ← 已提交的契约源
src/lib/api/server.d.ts         ← openapi-typescript 生成物
scripts/sync-server-openapi.mjs ← 维护者刷新契约用（可选）
```

```bash
pnpm gen:api        # openapi/server.json → server.d.ts（离线；普通贡献者只需这一步）
pnpm gen:api:check  # CI：schema 与生成物一致

# 维护者：拿到后端新导出的 openapi.json 后刷新契约源并提交
SERVER_LOCAL=/abs/path/to/openapi.json pnpm sync:api
```

`openapi/server.json` 已随仓库提交，构建/类型生成完全离线；后端契约更新后由维护者 `sync:api` 刷新并提交。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 架构权威说明：领域模型、模块与边界、数据流图、技术选型、关键不变量 |
| [docs/app.md](docs/app.md) | App（桌面 / 移动）方案、平台矩阵、CI、签名与分阶段路线图 |
| [docs/design/ui-style.md](docs/design/ui-style.md) | UI 视觉规范（现代 · 面板 · 留白）：阴影 / 颜色 / 圆角 / 间距 / 公共组件的统一口径 |
| [docs/claude.md](docs/claude.md) | 仓库结构与开发约定（贡献者速查） |
| [.github/SECURITY.md](.github/SECURITY.md) | 安全策略与漏洞报告（含跨端同步加密关注点） |

## 参与贡献

欢迎 Issue 与 PR（UI、home 本地能力、插件等）。开发约定见 [docs/claude.md](docs/claude.md)，架构说明见 [docs/architecture.md](docs/architecture.md)。

## 赞助

ideall 客户端免费开源；赞助用于支持客户端开发与社区维护（**不包含**官方信息服务关注）。

<!-- TODO: 启用 .github/FUNDING.yml 或填入链接 -->

<!-- [GitHub Sponsors](https://github.com/sponsors/YOUR_USERNAME) · [爱发电](https://afdian.com/a/YOUR_ID) -->

## 许可与商标

- 源码：[Apache License 2.0](LICENSE)
- 商标：**Wonita** 名称与官方 logo 不随 [Apache 2.0](LICENSE) 许可转让
