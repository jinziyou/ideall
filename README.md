# myos

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**本地优先的个人信息总控终端** — Wonita 生态的用户界面（客户端）。

以 **home（「我的」）为信息中枢**，`info`（资讯）/ `community`（社区）/ `tool`（工具）围绕并服务于 home：

| 模块 | 路由 | 角色 | 是否依赖远程后端 |
| --- | --- | --- | --- |
| home | `/home` | 信息中枢（个人资源 / 书签，本地优先） | 否 |
| info | `/info` | 信息聚合展示 | 是（后端数据服务） |
| community | `/community` | 发布者地图、订阅与发布 | 是（后端数据服务） |
| tool | `/tool` | 工具聚合（搜索 / AI / 导航） | 部分功能可选 |

## 开源范围与官方服务

本仓库（**myos**）是 **Apache 2.0** 开源的客户端。你可以自由使用、修改、自托管 UI。

| | myos（本仓库） | Wonita 官方信息服务 |
| --- | --- | --- |
| 内容 | Next.js 前端、本地 home、插件 | 采集、NLP、知识图谱、鉴权 API |
| 许可 | [Apache 2.0](LICENSE) | 闭源，由官方运营 |
| 商标 | 见 [TRADEMARK.md](TRADEMARK.md) | **Wonita** 品牌与官方数据 |

- **普通用户**：安装 myos，连接 [官方 API](#连接后端-server_addr) 即可使用完整能力。
- **极客 / 开发者**：fork 本仓库改 UI、写插件；自建后端需自行部署 wonita 服务（官方不提供一键镜像）。
- **请勿**用 Wonita 商标对外提供竞争性信息服务；详见 [TRADEMARK.md](TRADEMARK.md)。

myos 在 Wonita 生态里是**用户侧客户端**：本地 home 中枢 + info/community/tool 三模块。信息采集、知识图谱与鉴权由**官方信息服务**（后端）提供；myos 通过 `SERVER_ADDR` 连接（见下）。本仓库是该客户端的源码权威仓库。

myos 以两种形态分发，同一套 Next.js 代码：**Web**（SSR，生产实例由 myos 自身的部署流程编排，经 `SERVER_ADDR` / `NEXT_PUBLIC_SERVER_ADDR` 指向后端数据服务）与 **App**（Tauri 跨平台桌面 / 移动客户端，随本仓库发布）。详见 [App（桌面 / 移动）](#app桌面--移动) 与 [docs/app.md](docs/app.md)。

## 快速开始

```bash
git clone git@github.com:jinziyou/myos.git
cd myos
cp .env.example .env.local   # 按需选择官方或自托管 SERVER_ADDR
pnpm install
pnpm dev                     # http://localhost:5020
```

### 连接后端 (`SERVER_ADDR`)

| 模式 | 适用 | `SERVER_ADDR` 示例 |
| --- | --- | --- |
| **官方** | 使用 Wonita 官方资讯与图谱 | _官方 API 尚未公开发布；上线后填正式基址_ |
| **本地开发**（默认） | 本机联调后端 | `http://127.0.0.1:5021` |
| **Docker** | compose 注入 | `http://host.docker.internal:5021`（默认；同机后端见 override） |

复制 [`.env.example`](.env.example) 为 `.env.local` 后取消对应模式的注释。开箱默认走本地开发模式。home / tool 的本地能力不依赖后端；info / community 需可用的后端数据服务（经 `ServerPort` 契约消费；wonita 的 server 是其一个参考实现）。

## 构建与 Lint

```bash
pnpm build
pnpm lint
pnpm typecheck
```

## Docker

```bash
docker compose up -d --build
curl -I -sS http://localhost:5020
```

默认 `docker compose up` 即可独立运行：compose 会自建桥接网络 `myos_net`，主机端口由 `MYOS_PORT` 控制（默认 `5020`），后端地址由 `MYOS_SERVER_ADDR` 控制。若要与同机部署的后端共用一张网络，叠加 `docker-compose.override.example.yml`（见该文件注释）即可接入既有外部网络。

## App（桌面 / 移动）

myos 同一套代码经 **Tauri 2.0** 打包为跨平台客户端（Linux / Windows / macOS / iOS / Android），工程在 [`src-tauri/`](src-tauri)。App 用 Next.js 静态导出（`output: export`）+ 客户端直连后端（`NEXT_PUBLIC_SERVER_ADDR`）。

```bash
pnpm app:dev        # 桌面开发壳（加载 pnpm dev 的 localhost:5020）
pnpm app:export     # 静态导出 → out/（BUILD_TARGET=app；需数据层客户端化，见路线图）
pnpm app:build      # 多平台打包（需平台工具链 + 图标 pnpm tauri icon）
```

完整方案、平台矩阵与分阶段路线图见 [docs/app.md](docs/app.md)。

## 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `SERVER_ADDR` | 后端 API 基址（官方信息服务或自托管） | 见 `.env.example` |
| `MYOS_PORT` | Docker 宿主机映射端口 | `5020` |
| `MYOS_SERVER_ADDR` | compose 注入的后端地址 | `http://host.docker.internal:5021` |
| `MYOS_NETWORK` | compose 自建桥接网络名 | `myos_net` |

## API 类型同步 (codegen)

myos 调用后端数据服务的类型来自 OpenAPI schema（经 `ServerPort` 契约消费；wonita 的 server 是其一个参考实现），**不手写 DTO**：

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

欢迎 Issue 与 PR（UI、home 本地能力、插件等）。发布前清单见 [OPEN_SOURCE.md](OPEN_SOURCE.md)。

## 赞助

myos 客户端免费开源；赞助用于支持客户端开发与社区维护（**不包含**官方信息服务订阅）。

<!-- TODO: 启用 .github/FUNDING.yml 或填入链接 -->
<!-- [GitHub Sponsors](https://github.com/sponsors/YOUR_USERNAME) · [爱发电](https://afdian.com/a/YOUR_ID) -->

## 许可与商标

- 源码：[Apache License 2.0](LICENSE)
- 商标：[TRADEMARK.md](TRADEMARK.md)（**Wonita** 名称与官方 logo 不随源码许可转让）
