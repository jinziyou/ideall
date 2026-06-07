# peer

Wonita（**本地优先的个人信息总控终端**）的**用户界面**。从个人视角聚合信息、资源、工具与社区。

模块以 **home（我的空间）为信息中枢**，`info`（资讯）/ `community`（社区）/ `tool`（工具）三者围绕并服务于 home：

| 模块 | 路由 | 角色 |
| --- | --- | --- |
| home | `/home` | 信息中枢（个人资源 / 书签，本地优先） |
| info | `/info` | 信息聚合展示 |
| community | `/community` | 发布者地图（信息来源地理分布） |
| tool | `/tool` | 工具聚合（搜索 / AI / 导航） |

> 项目全貌见根目录 [`README.md`](../../README.md)，开发约定见 [`CLAUDE.md`](CLAUDE.md)。

## 本地开发

```bash
pnpm install
pnpm dev    # http://localhost:3000
```

或在仓库根目录：

```bash
bash peer/run.sh
```

## 构建与 Lint

```bash
pnpm build
pnpm lint
```

## Docker

```bash
docker compose up -d --build
curl -I -sS http://localhost:3000
```

`docker-compose.yml` 期望宿主机存在外部网络 `wonita_net`（与 `super/` 共用），方便容器间互联。
生产环境通过 [`scripts/prod.sh`](../../scripts/prod.sh) 统一编排，主机端口默认 `13000`（开发端口 + 10000）。

## 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `SERVER_ADDR` | super/server 地址 | `http://127.0.0.1:3001` (本地) / `http://server:3001` (容器) |
| `myos_PORT` | Docker 宿主机映射端口 | `3000` |
| `myos_SERVER_ADDR` | compose 注入的 super/server 地址 | `http://server:3001` |
| `WONITA_NETWORK` | Docker 共享网络名 | `wonita_net` |

## API 类型同步 (codegen)

peer 调 `super/server` 的所有 fetch 请求都基于 server 的 OpenAPI schema 生成 TypeScript
类型, **不再手写 DTO**。monorepo 内维护一份镜像副本作为 codegen 的源:

```
openapi/server.json          ← 从 super/server/openapi.json 同步的副本
src/lib/api/server.d.ts      ← openapi-typescript 生成的类型
scripts/sync-server-openapi.mjs
```

### 日常工作流

1. server 改了 router / domain model → 在 super 那边跑 `cargo run --bin export-openapi`
2. peer 这边同步 + 重新生成类型:

```bash
pnpm sync:api      # 优先用本地 ../../super/server/openapi.json, 找不到时退化到 GitHub raw
pnpm gen:api       # openapi/server.json → src/lib/api/server.d.ts
pnpm gen:api:check # CI 卡点: 校验生成结果与 schema 一致 (改了 schema 忘了重生成会在此失败)
```

3. `git add openapi/server.json src/lib/api/server.d.ts && git commit`

环境变量覆盖:
- `SERVER_REF=feat-x pnpm sync:api` — 拉 super 仓库的特定分支 / tag (远端模式)
- `SERVER_LOCAL=/abs/path/openapi.json pnpm sync:api` — 强制使用本地路径
