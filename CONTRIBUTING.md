# 贡献指南

感谢你对 **ideall** 的兴趣！ideall 是 Wonita 生态面向用户的开源客户端（[Apache 2.0](LICENSE)）。本指南说明贡献范围、开发流程与提交规范。

## 贡献范围

ideall 仓库只包含**客户端**代码。请将 PR 限定在以下范围：

- ✅ UI / 交互、`home` 本地能力、`info` / `community` / `tool` 展示层
- ✅ 插件（`plugins/agent` AI 助手、`plugins/sync` 跨端同步）
- ✅ 文档、简体中文文案、构建与 CI、Tauri App 壳
- ❌ **信息采集 / NLP / 知识图谱 / 鉴权后端** —— 由官方信息服务（闭源）提供，不在本仓库范围内，相关 PR 无法合并
- ❌ 手改 `openapi/server.json` 契约源 —— 由维护者随后端导出同步；贡献者只需 `pnpm gen:api`

不确定是否在范围内？先开 Issue 讨论再动手。

## 开发环境

```bash
pnpm install
pnpm dev          # 开发服 (SSR) http://localhost:5020，也是 Tauri 壳的加载源
pnpm app:dev      # Tauri 桌面开发壳（加载上面的 dev 服）
```

`info` / `community` 需要可用的后端（`NEXT_PUBLIC_SERVER_ADDR`，见 [README](README.md#连接后端-next_public_server_addr)）；`home` / `tool` 的本地能力无需后端。ideall 仅以 App 形态分发，详见 [docs/app.md](docs/app.md)。

## 提交前检查

PR 必须通过以下检查（CI 同样会跑）：

```bash
pnpm lint           # 含 protocol 纯度强制
pnpm typecheck
pnpm format:check   # Prettier 格式（CI 强制）
pnpm test
pnpm gen:api:check  # OpenAPI 契约与生成物一致
```

约定（详见 [CLAUDE.md](CLAUDE.md)）：

- 用户可见文案与代码注释一律**简体中文**
- 跨模块交互经 `@protocol`；`protocol` 层不得 import UI / 页面
- 所有 fetch / 数据访问 `try-catch` + `res.ok` 检查
- 复用 `src/components/ui` 的 shadcn 原语，不引入并行 UI 库

## 分支与提交信息

- 基于 `dev` 开分支，PR 提交到 `dev`（`main` 为发布分支）
- 提交信息遵循 Conventional Commits：`feat:` / `fix:` / `chore:` / `docs:` / `test:` 等

## 贡献授权与 DCO

ideall 当前**不使用 CLA**。你的贡献以项目相同的开源许可（Apache 2.0）纳入（inbound = outbound），**版权归你本人所有**。

为保证代码来源可追溯，每个提交须带 **DCO**（[Developer Certificate of Origin](https://developercertificate.org/)）签名：

```bash
git commit -s      # 自动追加 Signed-off-by: 你的名字 <你的邮箱>
```

`Signed-off-by` 表示你确认拥有提交该代码的权利，并同意以项目许可贡献。请使用真实姓名与可用邮箱。

> **维护者承诺**：ideall 开源客户端不会被重新授权为非开源许可。若未来需要引入 CLA，仅在合并首个实质性外部贡献前公示，并保持本承诺。

## 商标

代码可自由 fork，但 **Wonita / ideall 商标不随源码许可转让**。fork 须改用自己的名称、不得冒充官方网络，详见 [TRADEMARK.md](TRADEMARK.md)。

## 行为准则

请保持友善、就事论事；重大分歧由维护者裁定。

## 报告安全问题

**请勿在公开 Issue 中提交安全漏洞**，见 [SECURITY.md](.github/SECURITY.md)。
