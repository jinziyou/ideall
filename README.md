# ideall

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**开源、本地优先、供应商中立的个人信息工作台** — 你的信息、密钥与后端都在你手里。

ideall **能独立成立**：自带本地阅读与 AI 助手（自带 LLM 密钥），**零后端即是完整产品**；需要聚合与知识图谱时，默认接入 **wonita** 智能后端，且经 `ServerPort` 契约**随时可换 / 可自建**。

以 **home（「我的」）为信息中枢**，`info`（资讯）/ `community`（社区）/ `tool`（工具）围绕并服务于 home：

| 模块 | 路由 | 角色 | 是否依赖远程后端 |
| --- | --- | --- | --- |
| home | `/home` | 信息中枢（个人资源 / 书签，本地优先） | 否 |
| info | `/info` | 信息聚合展示 | 是（后端数据服务） |
| community | `/community` | 发布者地图、订阅与发布 | 是（后端数据服务） |
| tool | `/tool` | 工具聚合（搜索 / AI / 导航） | 部分功能可选 |

## 开源客户端与后端服务

本仓库（**ideall**）是 **Apache 2.0** 开源的客户端，可自由使用、修改、自托管。后端取数经 `ServerPort` 契约消费——**ideall 不被任何单一后端绑死**，wonita 只是默认与参考实现。

| | ideall（本仓库） | wonita 后端服务（默认，可换） |
| --- | --- | --- |
| 内容 | Next.js 前端、本地 home、插件、BYO-key agent | 采集、NLP、知识图谱、实体/事件追踪、鉴权 API |
| 许可 | [Apache 2.0](LICENSE) | 闭源，官方运营（也可自实现 `ServerPort` 替换） |
| 角色 | 独立可用的本地工作台 | 可选的"语料级智能"增强 |
| 商标 | **Wonita** 名称与官方 logo 不随 Apache 2.0 许可转让 | **Wonita** 品牌与官方数据 |

- **本地能力（home / tool / 同步 / agent）零后端即可用**——离线、无账号、数据存在你设备上。
- **需要聚合 / 知识图谱时**：默认连接 [wonita 后端](#连接后端-next_public_server_addr)；也可换用自建后端或自行实现 `ServerPort`。
- **请勿**用 Wonita 商标对外提供竞争性信息服务，或冒充官方 Wonita / ideall 网络。

本仓库是该客户端的源码权威仓库。个人数据默认不上传，仅跨端同步 / 发布时经后端服务。

ideall **仅以 App 形态分发**：同一套 Next.js 代码经 **Tauri 2.0** 静态导出后打包为**跨平台客户端 —— Windows / Linux / macOS 桌面 + iOS / Android 移动**。无 Node 运行时、无 SSR 生产服务端，客户端直连后端数据服务。详见 [App（桌面 / 移动）](#app桌面--移动) 与 [docs/app.md](docs/app.md)。

## 快速开始

```bash
git clone git@github.com:jinziyou/ideall.git
cd ideall
cp .env.example .env.local   # 按需选择官方或自托管后端地址
pnpm install
pnpm dev                     # 开发服 http://localhost:5020（也是 Tauri 壳的加载源）
pnpm app:dev                 # 起 Tauri 桌面开发壳（加载上面的 dev 服）
```

### 连接后端 (`NEXT_PUBLIC_SERVER_ADDR`)

App 客户端直连后端数据服务，地址在静态导出构建期内联进包，故用 `NEXT_PUBLIC_SERVER_ADDR`：

| 模式 | 适用 | `NEXT_PUBLIC_SERVER_ADDR` 示例 |
| --- | --- | --- |
| **官方** | 使用 Wonita 官方资讯与图谱 | _官方 API 尚未公开发布；上线后填正式基址_ |
| **本地开发**（默认） | 本机联调后端 | `http://127.0.0.1:5021` |

复制 [`.env.example`](.env.example) 为 `.env.local` 后取消对应模式的注释。开箱默认走本地开发模式。home / tool 的本地能力不依赖后端；info / community 需可用的后端数据服务（经 `ServerPort` 契约消费；wonita 的 server 是其一个参考实现）。客户端直连需后端放行 CORS（见 [docs/app.md](docs/app.md)）。

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
| `NEXT_PUBLIC_SERVER_ADDR` | App 客户端直连的后端 API 基址（官方信息服务或自托管） | 见 `.env.example` |
| `SERVER_ADDR` | 仅 `pnpm dev` SSR 渲染期在服务端读取；不设时回退到上一项 | 见 `.env.example` |

## API 类型同步 (codegen)

ideall 调用后端数据服务的类型来自 OpenAPI schema（经 `ServerPort` 契约消费；wonita 的 server 是其一个参考实现），**不手写 DTO**：

```
openapi/server.json                    ← 已提交的契约源
src/components/lib/api/server.d.ts     ← openapi-typescript 生成物
scripts/sync-server-openapi.mjs        ← 维护者刷新契约用 (可选)
```

```bash
pnpm gen:api        # openapi/server.json → server.d.ts（离线；普通贡献者只需这一步）
pnpm gen:api:check  # CI：schema 与生成物一致

# 维护者：拿到后端新导出的 openapi.json 后刷新契约源并提交
SERVER_LOCAL=/abs/path/to/openapi.json pnpm sync:api
```

`openapi/server.json` 已随仓库提交，构建/类型生成完全离线；后端契约更新后由维护者 `sync:api` 刷新并提交。

## 参与贡献

欢迎 Issue 与 PR（UI、home 本地能力、插件等）。开发约定见 [CLAUDE.md](CLAUDE.md)。

## 赞助

ideall 客户端免费开源；赞助用于支持客户端开发与社区维护（**不包含**官方信息服务订阅）。

<!-- TODO: 启用 .github/FUNDING.yml 或填入链接 -->
<!-- [GitHub Sponsors](https://github.com/sponsors/YOUR_USERNAME) · [爱发电](https://afdian.com/a/YOUR_ID) -->

## 许可与商标

- 源码：[Apache License 2.0](LICENSE)
- 商标：**Wonita** 名称与官方 logo 不随 [Apache 2.0](LICENSE) 许可转让
