# 脚本与维护入口

本文集中说明 `package.json` 暴露的维护命令与 `scripts/` 下的 Node 脚本。产品架构看 [architecture.md](architecture.md)，App 打包与发布看 [app.md](app.md)。

## 入口分层

| 类型 | 入口 | 用途 |
| --- | --- | --- |
| 日常开发 | `pnpm dev` / `pnpm app:dev` | Next 开发服与 Tauri 桌面开发壳 |
| 基础门禁 | `pnpm verify` / `pnpm verify:base` | format、lint、workflow lint、typecheck、test、API drift、build |
| 生产冒烟 | `pnpm verify:smoke:static` | 静态导出后启动 `out/` 预览服并跑浏览器冒烟 |
| 开发服冒烟 | `pnpm verify:full` / `pnpm verify:smoke` | 启动 Next dev server 后跑 notes/files/plugins/trash 冒烟 |
| API 契约 | `pnpm gen:api` / `pnpm gen:api:check` / `pnpm sync:api` | OpenAPI schema 与生成类型维护 |
| App 发布 | `pnpm app:export` / `pnpm app:build` / `pnpm bump` | 静态导出、Tauri 打包与版本号同步 |

常用维护脚本支持 `--help`，例如：

```bash
node scripts/verify-static-smoke.mjs --help
node scripts/verify-full.mjs --help
node scripts/run-tests.mjs --help
```

## 验证命令

```bash
pnpm verify:base
```

本地基础门禁。执行顺序为：

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm lint:actions`
4. `pnpm clean:next`
5. `pnpm typecheck`
6. `pnpm test`
7. `pnpm gen:api:check`
8. `pnpm build`

`pnpm clean:next` 只删除 `.next/`，用于清掉 Next 生成类型与缓存，避免脏产物影响 `tsc --noEmit`。

```bash
pnpm verify:smoke:static
node scripts/verify-static-smoke.mjs --no-build smoke:notes
```

生产形态冒烟。默认先 `pnpm build`，再检查 `out/`，随后启动 `scripts/serve-out.mjs` 并运行 notes/files/plugins/trash 冒烟。已有 `out/` 时可加 `--no-build`，也可只传指定 smoke 脚本。

```bash
pnpm verify:full
pnpm verify:smoke
```

开发服冒烟。`verify:full` 先跑 `verify:base`，再自动从 5020-5023 选择可用端口启动 Next dev server；`verify:smoke` 只跑开发服冒烟。

## 测试与冒烟

```bash
pnpm test
pnpm test sort-key
```

`scripts/run-tests.mjs` 运行 `src/**/*.test.ts`。传入子串时只运行路径包含该子串的测试；少数会启动真实 SDK server 或子进程的 MCP 测试会在并发批次后串行运行。

浏览器冒烟脚本：

| 脚本 | 覆盖 |
| --- | --- |
| `pnpm smoke:notes` | 笔记主链路 |
| `pnpm smoke:files` | 资源管理与文件 IDE 链路 |
| `pnpm smoke:files:preview` | 资源预览类型扩展覆盖 |
| `pnpm smoke:plugins` | 内置插件入口 |
| `pnpm smoke:trash` | 回收站链路 |

冒烟实现集中在 `scripts/smoke/`，插件子场景在 `scripts/smoke/plugins/`。冒烟脚本默认读取 `BASE` 环境变量；未设置时脚本内部会使用各自默认地址。CI 的生产冒烟通过 `verify-static-smoke.mjs` 注入 `BASE`。

## API 与发布

```bash
pnpm gen:api
pnpm gen:api:check
SERVER_LOCAL=/abs/path/to/openapi.json pnpm sync:api
```

`openapi/server.json` 是提交到仓库的契约源；`src/lib/api/server.d.ts` 是生成物，只允许 HTTP 适配器消费。普通开发通常只需要 `pnpm gen:api`，维护者拿到后端新 schema 时才运行 `sync:api`。

```bash
pnpm bump <x.y.z>
pnpm app:build
```

`pnpm bump` 会同步 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 与 `Cargo.lock` 版本。App 签名、自动更新和平台矩阵见 [app.md](app.md)。

## 新增脚本约定

- 新增对外命令时先在 `package.json` 暴露清晰名称，再把实现放到 `scripts/`。
- 需要启动子进程、探测端口、等待 HTTP 就绪或清理进程时，优先复用 `scripts/script-utils.mjs`。
- 长流程脚本应支持 `--help`，并在失败时输出可定位的脚本名前缀。
- 冒烟脚本应支持 `BASE`，避免把端口写死在脚本内部。
- 不要在 npm script 中使用平台专属 shell 命令；需要文件清理或路径处理时用 Node 脚本。
