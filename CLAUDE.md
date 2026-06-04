# CLAUDE.md

## Repository

`peer/inode` 是 [Wonita](https://github.com/jinziyou/wonita) monorepo 中的用户节点 (Inode) 前端。
全局布局与 API 契约同步见根目录 [`CLAUDE.md`](../../CLAUDE.md)。

## Positioning

inode 是 Wonita（**本地优先的个人信息总控终端**）面向用户的**用户界面**: 从个人视角出发,
把分散的他人、信息、资源、工具聚合到一处。

**home 是信息中枢, info / community / tool 三个模块都为 home 服务** (hub-and-spoke):
info / community / tool 在导航上统一归到「**发现**」之下 (Next.js 路由组 `src/app/(discover)/`,
共享 `(discover)/layout.tsx` 顶部分区导航), 作为面向 home 的聚合/获取入口 ——
**路由组用括号目录, URL 不含 `/discover`, 三者路由仍为 `/info`、`/community`、`/tool`**。

home 通过**订阅**把「发现」里的来源 (发布者 / 实体 / 工具 / 搜索 / 社区发布者 peer) 回流到 `/home/subscriptions` 订阅流 ——
订阅偏好本地优先 (IndexedDB `subscriptions` 仓库, 见 `home/lib/subscriptions-store.ts`)。
发布者/实体内容实时拉取 (复用 `(discover)/info` 的 `fetchLatestInfo`: 发布者按 domain、实体按 label/name);
**搜索订阅本地优先**: 偏好 (关键词 + 可选域名) 存本地, 拉取窗口后**客户端按标题子串过滤**
(服务端无关键词搜索, 与 `/info/search` 现有前端过滤口径一致); 工具是快捷启动项 (无内容流, 点开即跳)。
订阅入口: info 发布者页/实体页的「订阅」按钮 (组件 `home/subscribe-button.tsx`, prop `sub: NewSubscription`)、
`/info/search` 的「订阅此搜索」、community「社区发布者」列表就地订阅 peer (`GET /peers`)、
tool 各卡角标「钉到 home」(组件 `home/pin-tool-button.tsx`);
订阅流 `/home/subscriptions` 顶部为「已钉工具」, 下方为发布者/实体/搜索/社区发布者的最新条目卡
(peer 拉 `/peer/{id}/publications`)。

**跨端同步 (端到端加密, 无账号)**: 订阅流顶部「跨端同步」面板。用一段高熵「同步码」在浏览器
(WebCrypto, `home/lib/sync.ts`) 派生 storageId (服务端查找键) + AES-GCM 密钥; 订阅列表只在浏览器内
加密, 经 server action 中转 (`home/lib/sync-action.ts`) 存到 super/server `PUT/GET /sync/{id}`
(一个不透明密文键值存储, **服务端读不到内容**, id 即能力凭证, 无需登录)。同步逻辑见
`home/lib/subscription-sync.ts`: 拉远端→解密→与本地按 id 并集→写本地→加密→推远端;
同步码存 localStorage; 合并为并集, **删除为尽力** (会被另一端带回)。

**社区 = 用户/peer 发布层 (账号)**: 用户登录后在「我的空间 · 我的发布」(`/home/publications`) 发布内容
(`Publication`), 成为社区发布者; 他人在 community「社区发布者」订阅 (`type:"peer"`, key=用户 id),
其发布进订阅流。登录复刻 server 的 X25519 方案 (`lib/auth/*` + `/auth` 页 + header 账户菜单);
peer 端点对接 `super/server` 的 `/peers`、`/peer/{id}(+/publications)`、`/me/publications` (`lib/peer-action.ts`)。
**账号 (公开发布身份) 与跨端同步的无账号同步码是两套独立身份**。

| 模块 | 路由 | 角色 | 说明 |
| --- | --- | --- | --- |
| **home** (我的空间) | `/home` | **信息中枢** | 订阅流 (`/home/subscriptions`, 默认页)、我的发布 (`/home/publications`)、资源 (`/home/resources`)、书签 (`/home/bookmarks`) |
| **发现** (discover) | — (路由组) | 聚合入口 | `(discover)/layout.tsx` 把下列三者归到「发现」分区导航之下, 不改各自 URL |
| **info** (资讯) | `/info` | 信息聚合展示 | 消费 super 聚合的资讯/实体/发布者, 喂给 home |
| **community** (社区) | `/community` | 社区发布者 + 地图 | 浏览/订阅社区发布者 (用户/peer, `GET /peers`) + 信息来源地理分布 (IP 定位) |
| **tool** (工具) | `/tool` | 工具聚合 | 搜索 (`/tool/search`)、AI (`/tool/ai`)、导航 (`/tool/navigation`) |

**本地优先 (local-first) + 混合 P2P** 架构: inode 为对等节点 (peer), super 为超级节点 (super-node)。
个人数据默认留在本机浏览器 (localStorage / 本地存储), 不上传服务器 —— 如「我的空间」的文件/链接、
`/tool/search` 的「最近搜索」历史; 仅跨节点同步/协调时才经 super 节点。新增个人向聚合功能时,
默认本地优先、对等视角, 并思考它如何回流服务于 home 中枢。

## Common commands

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build
pnpm lint

# API codegen (改了 super/server 的 schema 后跑)
pnpm sync:api     # 从 super/server/openapi.json 同步
pnpm gen:api      # openapi/server.json -> src/lib/api/server.d.ts
pnpm gen:api:check  # CI 卡点
```

## Conventions

- 默认 Server Component, 仅交互组件加 `"use client"`
- UI 复用 `src/components/ui` 的 shadcn 原语, 禁止引入并行 UI 库
- TypeScript strict, 跨后端 DTO 一律从 `src/lib/api/server.d.ts` 派生
- 所有 fetch / Server Action 必须 `try-catch` + `res.ok` 检查
- URL 参数构造用 `URLSearchParams`, 客户端跳转用 `encodeURIComponent`
- 用户可见文案与代码注释均使用简体中文
- 共享工具放 `src/lib/` (`id.ts` / `format.ts` / `env.ts` 等); 模块内领域类型放 `model.ts`
- info/community 用 `action.ts` (Server Action) + `model.ts`; 本地优先模块 (home) 无后端 DTO, 用 `model.ts` + `lib/` 本地存储 (IndexedDB)
