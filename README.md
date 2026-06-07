# peer/inode

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
bash peer/inode/run.sh
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
| `INODE_PORT` | Docker 宿主机映射端口 | `3000` |
| `INODE_SERVER_ADDR` | compose 注入的 super/server 地址 | `http://server:3001` |
| `WONITA_NETWORK` | Docker 共享网络名 | `wonita_net` |

## API 类型同步 (codegen)

inode 调 `super/server` 的所有 fetch 请求都基于 server 的 OpenAPI schema 生成 TypeScript
类型, **不再手写 DTO**。契约真相源是**私有仓库 [`jinziyou/wonita`](https://github.com/jinziyou/wonita)** 的
`super/server/openapi.json`；本仓库 (inode 已迁出 wonita monorepo 独立成此仓库) 维护一份镜像副本作为 codegen 的源:

```
openapi/server.json          ← 从 wonita 的 super/server/openapi.json 同步的镜像副本
src/lib/api/server.d.ts      ← openapi-typescript 生成的类型
scripts/sync-server-openapi.mjs
```

### 日常工作流

1. server 改了 router / domain model → 在 wonita 仓库跑 `cargo run --bin export-openapi`
2. inode 这边同步 + 重新生成类型:

```bash
# wonita 与本仓库同级目录时, sync 自动找 ../wonita/super/server/openapi.json
pnpm sync:api      # 取上游 openapi.json 写入 openapi/server.json
pnpm gen:api       # openapi/server.json → src/lib/api/server.d.ts
pnpm gen:api:check # CI 卡点: 校验生成结果与 schema 一致 (改了 schema 忘了重生成会在此失败)
```

3. `git add openapi/server.json src/lib/api/server.d.ts && git commit`

取源优先级 (见 `scripts/sync-server-openapi.mjs`):
- `SERVER_LOCAL=/abs/path/openapi.json pnpm sync:api` — 强制使用指定本地文件
- `WONITA_ROOT=/path/to/wonita pnpm sync:api` — 指定本地 wonita 仓库根
- `../wonita/super/server/openapi.json` — 默认同级目录探测
- 远端: `WONITA_TOKEN=ghp_xxx pnpm sync:api` (wonita 私有, 需对其有 `contents:read` 的 PAT);
  `SERVER_REF=feat-x` 可指定分支/tag/commit

### CI

- `.github/workflows/ci.yml` — lint + test + build
- `.github/workflows/contract-check.yml`:
  - `inode-codegen` (每 PR): `pnpm gen:api:check`，校验 `server.d.ts` 与本仓库镜像一致 (无需网络)
  - `openapi-drift` (每周一 + 手动): 检出 wonita 的 `openapi.json` 比对镜像是否落后
    > 因 wonita 私有，需在本仓库 **Settings → Secrets and variables → Actions** 新增
    > secret **`WONITA_OPENAPI_TOKEN`** (对 `jinziyou/wonita` 有 `contents:read` 的 fine-grained PAT)。
    > 未配置时该 job 优雅跳过 (warning)，不阻断。
