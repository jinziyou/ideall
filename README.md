# myos

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**本地优先的个人信息总控终端** — Wonita 生态的用户界面（客户端）。

以 **home（「我的」）为信息中枢**，`info`（资讯）/ `community`（社区）/ `tool`（工具）围绕并服务于 home：

| 模块 | 路由 | 角色 | 是否依赖远程后端 |
| --- | --- | --- | --- |
| home | `/home` | 信息中枢（个人资源 / 书签，本地优先） | 否 |
| info | `/info` | 信息聚合展示 | 是（super/server） |
| community | `/community` | 发布者地图、订阅与发布 | 是（super/server） |
| tool | `/tool` | 工具聚合（搜索 / AI / 导航） | 部分功能可选 |

## 开源范围与官方服务

本仓库（**myos**）是 **Apache 2.0** 开源的客户端。你可以自由使用、修改、自托管 UI。

| | myos（本仓库） | Wonita 官方信息服务 |
| --- | --- | --- |
| 内容 | Next.js 前端、本地 home、插件 | 采集、NLP、知识图谱、鉴权 API |
| 许可 | [Apache 2.0](LICENSE) | 闭源，由官方运营 |
| 商标 | 见 [TRADEMARK.md](TRADEMARK.md) | **Wonita** 品牌与官方数据 |

- **普通用户**：安装 myos，连接 [官方 API](#连接后端-server_addr) 即可使用完整能力。
- **极客 / 开发者**：fork 本仓库改 UI、写插件；自建后端需自行部署 super 级服务（官方不提供一键镜像）。
- **请勿**用 Wonita 商标对外提供竞争性信息服务；详见 [TRADEMARK.md](TRADEMARK.md)。

完整系统架构见 monorepo [`wonita/ARCHITECTURE.md`](https://github.com/jinziyou/wonita/blob/main/ARCHITECTURE.md)。

> myos 亦作为 [`wonita`](https://github.com/jinziyou/wonita) 的 `peer/` git submodule 挂载；**源码权威仓库为本仓库**。在 monorepo 内开发时，路径为 `peer/*`，命令在 `peer/` 下执行。

## 快速开始

```bash
git clone git@github.com:jinziyou/myos.git
cd myos
cp .env.example .env.local   # 按需选择官方或自托管 SERVER_ADDR
pnpm install
pnpm dev                     # http://localhost:3000
```

### 连接后端 (`SERVER_ADDR`)

| 模式 | 适用 | `SERVER_ADDR` 示例 |
| --- | --- | --- |
| **官方** | 使用 Wonita 官方资讯与图谱 | `https://api.wonita.example`（TODO: 替换为正式 URL） |
| **本地开发** | 本机联调 super/server | `http://127.0.0.1:3001` |
| **Docker** | 与 super 同 compose 网络 | `http://server:3001`（由 compose 注入） |

复制 [`.env.example`](.env.example) 为 `.env.local` 后取消对应模式的注释。home / tool 的本地能力不依赖后端；info / community 需可用的 super/server。

## 构建与 Lint

```bash
pnpm build
pnpm lint
pnpm typecheck
```

## Docker

```bash
docker compose up -d --build
curl -I -sS http://localhost:3000
```

`docker-compose.yml` 期望宿主机存在外部网络 `wonita_net`（与 wonita `super/` 共用）。单独部署时主机端口由 `MYOS_PORT` 控制（默认 `3000`）。

## 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `SERVER_ADDR` | super/server API 基址 | 见 `.env.example` |
| `MYOS_PORT` | Docker 宿主机映射端口 | `3000` |
| `MYOS_SERVER_ADDR` | compose 注入的 server 地址 | `http://server:3001` |
| `WONITA_NETWORK` | Docker 共享网络名 | `wonita_net` |

## API 类型同步 (codegen)

myos 调用 super/server 的类型来自 OpenAPI schema，**不手写 DTO**：

```
openapi/server.json                    ← 契约镜像
src/components/lib/api/server.d.ts     ← openapi-typescript 生成
scripts/sync-server-openapi.mjs
```

```bash
pnpm sync:api      # 优先 ../super/server/openapi.json，否则 GitHub raw
pnpm gen:api
pnpm gen:api:check # CI：schema 与生成物一致
```

在 wonita monorepo 内：`super/server` 改 router 后先 `cargo run --bin export-openapi`，再在 myos 执行上述命令。

## 参与贡献

欢迎 Issue 与 PR（UI、home 本地能力、插件等）。发布前清单见 [OPEN_SOURCE.md](OPEN_SOURCE.md)。

## 赞助

myos 客户端免费开源；赞助用于支持客户端开发与社区维护（**不包含**官方信息服务订阅）。

<!-- TODO: 启用 .github/FUNDING.yml 或填入链接 -->
<!-- [GitHub Sponsors](https://github.com/sponsors/YOUR_USERNAME) · [爱发电](https://afdian.com/a/YOUR_ID) -->

## 许可与商标

- 源码：[Apache License 2.0](LICENSE)
- 商标：[TRADEMARK.md](TRADEMARK.md)（**Wonita** 名称与官方 logo 不随源码许可转让）
