# Repository Guidelines

## 项目结构与模块组织

ideall 是基于 Next.js 与 Tauri 的本地优先个人信息终端。源码位于 `src/`：`app/` 是薄路由入口，`shell/` 是终端外壳与组合根，`workspace/` 负责 Display/标签页编排，`filesystem/` 管理挂载和 provider，并在 `src/filesystem/resource-sources/` 收口 Resource source/provider 兼容适配，`engines/` 负责文件到视图的匹配，`files/` 是本地 Node 数据层，`modules/` 放产品分区，`plugins/` 放 agent/sync/embed 等功能，`protocol/` 放纯契约，`ui/` 放基础组件，`shared/` 放共享 UI，`lib/` 放工具与适配器。Tauri 与 Rust 代码位于 `src-tauri/`。业务测试以 `*.test.ts` 形式就近放在 `src/`，维护脚本测试位于 `scripts/*.test.mjs`。文档入口是 `docs/README.md`，API schema 源文件是 `openapi/server.json`。

## 构建、测试与开发命令

- `pnpm install`：使用 pnpm 9 与 Node 22+ 安装依赖。
- `pnpm dev`：启动 Next 开发服务，地址为 `http://localhost:5020`。
- `pnpm app:dev`：启动 Tauri 桌面壳，并加载开发服务。
- `pnpm build` 或 `pnpm app:export`：生成用于 App 打包的静态导出。
- `pnpm app:build`：构建 Tauri App；需要 Rust 与平台工具链。
- `pnpm lint`、`pnpm lint:deps`、`pnpm lint:dead-code`、`pnpm lint:docs`、`pnpm typecheck`、`pnpm test`：分别运行架构边界、依赖使用、孤立文件、文档链接、TypeScript 与业务测试。
- `pnpm test:coverage`：为选定的核心源码生成 c8 text/lcov 报告，并执行仓库基线覆盖率门槛。
- `pnpm verify:checks`：运行不含生产构建的 CI 质量门禁，包含依赖与孤立文件 lint；`pnpm version:check` 校验四处项目版本一致。
- `pnpm verify:bundle`：检查已有 `out/` 中 JavaScript chunk 的 raw/gzip bundle 预算，应在生产构建后运行。
- `pnpm verify`：等同 `pnpm verify:base`，依次运行 `verify:checks`、生产构建和 `verify:bundle`。

## 代码风格与命名约定

使用 TypeScript strict 模式与 `@/*`、`@protocol/*` 路径别名。默认优先 Server Components；只有交互组件才添加 `"use client"`。UI 复用 `src/ui` 原语，并遵循 `docs/design/ui-style.md`。ESLint 会强制架构边界：`protocol` 保持纯净，`app` 路由不可被反向 import，功能模块保持隔离，`src/lib/api` 的 wire DTO 只供 HTTP 适配器使用。用 `pnpm format` 格式化，用 `pnpm format:check` 检查格式。

## 测试指南

业务测试通过 `scripts/run-tests.mjs` 使用 `node:test`，文件命名遵循 `*.test.ts`。运行全部业务测试用 `pnpm test`；也可传入子串过滤，例如 `pnpm test sort-key`。维护脚本测试运行 `pnpm test:scripts`。修改 protocol 逻辑、store、同步、安全守卫、provider 或部署脚本时，应补充聚焦测试。

## 提交与 Pull Request 指南

近期提交使用 Conventional Commit 前缀，如 `feat:`、`fix:`、`chore:`、`ci:`。标题保持简洁、动作明确，例如 `fix: guard workspace hydration`。日常开发面向 `dev`，`main` 用于稳定发布。PR 应说明行为变化，关联相关 issue，列出已运行的验证命令；涉及 UI 时附截图。

## 安全与配置提示

本地配置可复制 `.env.example` 为 `.env.local`；不要提交密钥或本地端点。schema 变更后用 `pnpm gen:api` 重新生成 API 类型，并确保 DTO 使用仍限制在服务端适配器边界内。
