# ideall

[![License: Apache 2.0](<https://img.shields.io/badge/License-Apache%202.0-blue.svg>)](LICENSE)

**功能定位：个人信息终端**

**设计风格：现代 · 面板 · 留白**

**设计思想：借鉴linux一切皆文件思想，将所有功能统一抽象到存储、文件系统、文件、渲染引擎和显示这个模型中，不同的数据存储（本地、远程、app、第三方app），通过文件系统汇总展示为ideall中的文件，然后根据不同场景（如音频、开发）将同一个文件经引擎渲染展示为不同视图**

核心功能：ai agent、shell、浏览器、本地文件/远程文件，实现数据+链接+AI

## 项目组成

| 组件             | 说明                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| **ideall** | 项目本体：跨平台 App（Android / iOS / Windows / macOS / Linux），管理本地数据，并连接 AI、应用与 Web |
| **wonita** | 数据服务（独立项目）：数据同步、资讯与社区；提供默认后端实现                                         |

## 统一文件系统

ideall 在底层不按数据来源拆成多套文件系统。IndexedDB、Blob、远端服务、内置 App 和第三方 App 都作为独立存储来源，经文件系统挂载到一个隐藏的合成根；Display 层用固定五分区组织它们，工作区则负责同一文件的场景化显示。

```text
Storage → FileSystem → IdeallFile → Engine → Display
```

- 活动栏的一级入口始终固定为五个分区；选中分区后，左侧二级侧栏展示对应入口。App 在授权后贡献的动态挂载也会汇入同一导航体系。

  | 一级分区 | 二级入口 |
  | --- | --- |
  | **我的** | 关注、书签、资源、文件 |
  | **活动** | 空间、任务、删除 |
  | **浏览** | 新闻、社区、浏览器 |
  | **应用** | 搜索、本地应用 |
  | **设置** | 基本、AI |

- 工作区即视图，只在顶栏切换，不作为左侧导航项：**文件**（默认文件视图 + AI Agent）、**音频**（文件视图 + 音频播放）、**开发**（文件视图 + Git + Shell）。切换工作区保留已有标签和脏草稿；若当前打开的是文件，会激活同一 `FileRef` 在新场景下的默认 Engine 标签。
- 文件使用稳定 `FileRef` 寻址，路径和目录项只是投影。同一书签可同时出现在“书签”和“浏览器”中而不复制数据。
- 普通打开由默认引擎在当前标签页显示；“打开方式”选择其他引擎时创建同一文件的独立 Engine 标签。只有文件 capability 与 Engine 策略同时允许时，才可另开独立 App 窗口。
- 默认引擎支持按工作区、单文件或内容类型配置；任意“文件 + 引擎”都可设为首次启动界面。正常启动优先恢复上次关闭的工作现场。
- 音频和 Code 是针对同一文件的场景化引擎；Git 与 Shell 是开发工作区的保持挂载工具。旧 Resource/Node 标签只在工作区水合边界迁移，旧路由和 Resource 深链只在深链解析边界转换为 File + Engine，运行期不保留第二套标签身份。
- 普通领域 CRUD 即使经兼容 `FilesPort` 调用，也会进入 FileSystem registry；只有需要墓碑全量快照与原子批处理的同步流程使用独立的窄 `StorageSyncPort`。可信运行时扩展可把 FileSystem 与 Engine/renderer 作为一个组合贡献原子安装、卸载；package 的重放记录绑定版本、内容/权限摘要与经宿主恢复的 consent receipt，不从存储执行代码。

完整契约、权限和迁移说明见 [文件系统与引擎架构](docs/file-system-engine-architecture.md)及 [architecture.md](docs/architecture.md)。

## 开源客户端与后端服务

本仓库（**ideall**）是 **Apache 2.0** 开源的客户端，可自由使用、修改、自托管。后端取数经 `ServerPort` 契约消费——**ideall 不被任何单一后端绑死**，wonita 只是默认与参考实现。

|      | ideall（本仓库）                                          | wonita 后端服务（默认，可换）                   |
| ---- | --------------------------------------------------------- | ----------------------------------------------- |
| 内容 | Next.js 前端、本地 home、插件、BYO-key agent              | 采集、NLP、知识图谱、实体/事件追踪、鉴权 API    |
| 许可 | [Apache 2.0](LICENSE)                                      | 闭源，官方运营（也可自实现`ServerPort` 替换） |
| 角色 | 独立可用的本地终端                                        | 可选的「语料级智能」增强                        |
| 商标 | **Wonita** 名称与官方 logo 不随 Apache 2.0 许可转让 | **Wonita** 品牌与官方数据                 |

**要点：**

- **本地能力（home / apps / tool / agent）不依赖后端**——离线、无账号、数据存在你设备上（本地应用启动器仅在 Tauri 桌面端可用）。跨端同步同样无账号且只上传密文，但执行同步仍需可用的 Sync 服务；当前同步范围是关注与笔记。
- **agent 是横跨本地的 AI 环境层**：除自带 LLM 密钥（BYO-key）直连 OpenAI 兼容端点外，还可**连接外部 ACP agent / 外部 MCP**，并能**联网搜索 / 抓取网页**（出站受 egress 守卫的 SSRF 防护约束）。
- **需要聚合 / 知识图谱时**：默认连接 [wonita 后端](#连接后端)；也可换用自建后端或自行实现 `ServerPort`。
- **请勿**用 Wonita 商标对外提供竞争性信息服务，或冒充官方 Wonita / ideall 网络。

本仓库是该客户端的源码权威仓库。个人数据默认不上传，仅跨端同步 / 发布时经后端服务。

ideall **仅以 App 形态分发**：同一套 Next.js 代码经 **Tauri 2.0** 静态导出后打包为**跨平台客户端 —— Windows / Linux / macOS 桌面 + iOS / Android 移动**。无 Node 运行时、无 SSR 生产服务端，客户端直连后端数据服务。详见 [App（桌面 / 移动）](#app桌面--移动) 与 [docs/app.md](docs/app.md)。

## 开发环境

日常 Web 开发需要 **Node.js ≥ 22** + **pnpm 9**（见 `package.json` 的 `packageManager`）。Tauri 桌面 / 移动构建还需要 Rust 与平台系统依赖，详见 [docs/app.md#开发环境--前置依赖](docs/app.md#开发环境--前置依赖)。

## 快速开始

```bash
git clone git@github.com:jinziyou/ideall.git
cd ideall
cp .env.example .env.local   # 按需选择官方或自托管后端地址
pnpm install
pnpm dev                     # 开发服 http://localhost:5020（也是 Tauri 壳的加载源）
pnpm app:dev                 # 起 Tauri 桌面开发壳（加载上面的 dev 服）
```

## 本地验证

```bash
pnpm verify:checks        # 不含构建：format / lint（代码、workflow、依赖、文档）/ version / typecheck / test / API drift
pnpm verify:base          # verify:checks → build → bundle 预算检查
pnpm verify:smoke:static  # 生产形态冒烟：build → serve out/ → notes/files/plugins/trash
pnpm verify:full          # 基础门禁 + 开发服冒烟（自动挑 5020-5023 可用端口）
```

依赖使用检查可单独运行 `pnpm lint:deps`；`pnpm test:coverage` 生成 c8 text/lcov 报告并执行核心层覆盖率基线，它也是 `verify:checks` 的业务测试步骤。生产构建后可单独运行 `pnpm verify:bundle` 检查 `out/` 的 JavaScript bundle 预算。静态导出产物检查可单独运行 `pnpm verify:static-export`；已有 `out/` 时可用 `node scripts/verify-static-smoke.mjs --no-build smoke:notes` 只跑指定冒烟脚本。脚本入口、参数与新增脚本约定见 [docs/scripts.md](docs/scripts.md)。

### 连接后端

开箱默认连官方 wonita（`https://api.wonita.link` + iframe `https://www.wonita.link`），见 [`.env.example`](.env.example)。home / tool 不依赖后端；info / community 需可用后端（经 `ServerPort` 契约；wonita 是默认实现）。

| 场景                          | 做法                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **独立运行 / 官方后端** | 无需配置，或复制`.env.example` → `.env.local`                                                                                            |
| **联调自建 / 本地后端** | 复制`.env.example` → `.env.local`，按需修改 `NEXT_PUBLIC_SERVER_ADDR` / `NEXT_PUBLIC_EMBED_BASE`（`.env.local` 不入库）。Tauri App 使用自建 embed 源时还须同步修改 `src-tauri/tauri.conf.json` 的 CSP `frame-src`，并让门户的 `frame-ancestors` 放行 ideall 后重新打包 |

客户端直连需后端放行 CORS（见 [docs/app.md](docs/app.md)）。

## App（桌面 / 移动）

ideall 同一套代码经 **Tauri 2.0** 打包为跨平台客户端（Windows / Linux / macOS / iOS / Android）。当前 App 开发、构建、平台矩阵、CI 发布、签名与环境变量口径见 [docs/app.md](docs/app.md)；环境变量示例见 [`.env.example`](.env.example)。

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

| 文档                                              | 内容                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)       | 架构权威说明：领域模型、模块与边界、数据流图、技术选型、关键不变量                  |
| [docs/README.md](docs/README.md)                   | 全部文档按现行规范、操作手册、决策记录与历史归档分类                               |
| [docs/app.md](docs/app.md)                         | App（桌面 / 移动）当前开发、构建、CI、发布与签名手册                                |
| [docs/scripts.md](docs/scripts.md)                 | 本地验证、冒烟、API codegen、发布与脚本维护入口                                     |
| [docs/app-history.md](docs/app-history.md)         | App-only / Tauri 化历史路线图                                                       |
| [docs/design/ui-style.md](docs/design/ui-style.md) | UI 视觉规范（现代 · 面板 · 留白）：阴影 / 颜色 / 圆角 / 间距 / 公共组件的统一口径 |
| [docs/development.md](docs/development.md)         | 仓库结构与开发约定（贡献者速查）                                                    |
| [.github/SECURITY.md](.github/SECURITY.md)         | 安全策略与漏洞报告（含跨端同步加密关注点）                                          |

## 参与贡献

欢迎 Issue 与 PR（UI、home 本地能力、插件等）。开发约定见 [docs/development.md](docs/development.md)，架构说明见 [docs/architecture.md](docs/architecture.md)。

## 许可与商标

- 源码：[Apache License 2.0](LICENSE)
- 商标：**Wonita** 名称与官方 logo 不随 [Apache 2.0](LICENSE) 许可转让
