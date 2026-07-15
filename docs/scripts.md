# 脚本与维护入口

本文集中说明 `package.json` 暴露的维护命令与 `scripts/` 下的 Node 脚本。产品架构看 [architecture.md](architecture.md)，App 打包与发布看 [app.md](app.md)。

## 入口分层

| 类型 | 入口 | 用途 |
| --- | --- | --- |
| 日常开发 | `pnpm dev` / `pnpm app:dev` | Next 开发服与 Tauri 桌面开发壳 |
| 质量门禁 | `pnpm verify:checks` | format、代码/工作流/依赖/文档 lint、版本一致性、typecheck、test、API drift |
| 完整门禁 | `pnpm verify` / `pnpm verify:base` | `verify:checks` 后复用 `app:export` 检查构建、静态入口与 bundle 预算 |
| 覆盖率门禁 | `pnpm test:coverage` | 为选定核心源码生成 c8 text/lcov 报告，并检查覆盖率基线 |
| 生产冒烟 | `pnpm verify:smoke:static` | 静态导出后启动 `out/` 预览服并跑浏览器冒烟 |
| 开发服冒烟 | `pnpm verify:full` / `pnpm verify:smoke` | 启动 Next dev server 后跑 notes/files/plugins/trash 冒烟 |
| API 契约 | `pnpm gen:api` / `pnpm gen:api:check` / `pnpm sync:api` | OpenAPI schema 与生成类型维护 |
| App 发布 | `pnpm app:export` / `pnpm app:build` / `pnpm bump` | 经验证的静态导出、当前宿主平台的 Tauri 打包与版本号同步；跨平台矩阵由 CI 执行 |
| Git 维护 | `pnpm git:setup` / `pnpm git:pull` | 配置移动发布标签 refspec；执行仅快进的安全 pull |
| 静态预览 | `pnpm verify:static-export` / `pnpm serve:out` | 检查已有 `out/`，或在本地启动无 Node 生产运行时的预览服 |

常用维护脚本支持 `--help`，例如：

```bash
node scripts/verify-static-smoke.mjs --help
node scripts/verify-full.mjs --help
node scripts/run-tests.mjs --help
node scripts/run-script-tests.mjs --help
node scripts/check-docs.mjs --help
node scripts/git-setup.mjs --help
node scripts/git-pull.mjs --help
node scripts/check-version.mjs --help
node scripts/bump-version.mjs --help
node scripts/release-preflight.mjs --help
node scripts/release-artifacts.mjs --help
node scripts/release-publish.mjs --help
```

## 验证命令

```bash
pnpm verify:base
```

本地基础门禁。执行顺序为：

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm lint:actions`
4. `pnpm lint:deps`
5. `pnpm lint:docs`
6. `pnpm version:check`
7. `pnpm clean:next`
8. `pnpm typecheck`
9. `pnpm test:coverage`
10. `pnpm test:scripts`
11. `pnpm gen:api:check`
12. `pnpm build`
13. `pnpm verify:static-export`
14. `pnpm verify:bundle`

前 11 步也可单独运行 `pnpm verify:checks`，供 CI 质量 job 和发布 preflight 复用；其中 `lint:deps` 使用 Knip 检查未使用、多余和未声明依赖。`pnpm clean:next` 只删除 `.next/`，用于清掉 Next 生成类型与缓存，避免脏产物影响 `tsc --noEmit`。后 3 步由 `pnpm app:export` 统一承载：先构建静态导出，再确认关键路由和 `_next` chunk 已生成，最后检查 JavaScript raw/gzip 总量与最大单 chunk 预算。Tauri 打包与 CI build job 都复用同一入口。

已有生产构建时可单独运行：

```bash
pnpm verify:bundle
```

该命令依赖已有 `out/`，不负责触发构建。

```bash
pnpm verify:smoke:static
node scripts/verify-static-smoke.mjs --no-build smoke:notes
```

生产形态冒烟。默认先运行 `pnpm app:export`，随后启动 `scripts/serve-out.mjs` 并运行 notes/files/plugins/trash 冒烟。已有且已自行检查的 `out/` 可加 `--no-build`；runner 仍会执行静态入口检查，也可只传指定 smoke 脚本。

```bash
pnpm verify:full
pnpm verify:smoke
```

开发服冒烟。`verify:full` 先跑 `verify:base`，再自动从 5020-5023 选择可用端口启动 Next dev server；`verify:smoke` 只跑开发服冒烟。

## 测试与冒烟

```bash
pnpm test
pnpm test sort-key
pnpm test:coverage
```

`scripts/run-tests.mjs` 运行 `src/**/*.test.ts`。传入子串时只运行路径包含该子串的测试；少数会启动真实 SDK server 或子进程的 MCP 测试会在并发批次后串行运行。

`pnpm test:coverage` 运行同一组业务测试，并为 protocol、filesystem、engines、shell 启动/运行时扩展、workspace store 和 plugins/shared 等选定核心路径生成 c8 text/lcov 报告。门禁要求 statements/lines ≥ 80%、branches ≥ 75%、functions ≥ 78%，并作为 `verify:checks` 的业务测试步骤；普通开发仍可用 `pnpm test [过滤串]` 快速运行聚焦测试。

`pnpm test:scripts` 自动发现 `scripts/*.test.mjs`，并使用隔离子进程运行原生 `node:test` 维护脚本测试；可像 `pnpm test:scripts -- release-artifacts` 一样用路径子串聚焦。它与业务测试分开，便于脚本保持纯 Node、跨平台且不依赖应用别名。runner 复用业务测试的超时、进程树回收和有限日志能力，并避免依赖 `node --test` CLI 的 glob 实现。

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
pnpm version:check
pnpm app:build
```

`pnpm bump` 会先完整校验四个版本文件和替换计划，再同步 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 与 `Cargo.lock`；结构漂移或当前版本不一致时不会开始写入。`pnpm version:check` 是对应的只读门禁。`pnpm app:build` 只构建当前宿主平台；App 签名、自动更新和跨平台 CI 矩阵见 [app.md](app.md)。

`release-preflight.mjs`、`release-artifacts.mjs` 与 `release-publish.mjs` 是 `app-build` 的内部 artifact-first 发布链：依次验证构建配置和签名密钥、暂存/聚合四平台资产、通过 staging draft 发布并可回滚切换 `app-edge`。它们依赖 GitHub Actions 注入的环境变量，不作为日常手动发版入口；纯函数与失败回滚由 `pnpm test:scripts` 覆盖。

## 新增脚本约定

- 新增对外命令时先在 `package.json` 暴露清晰名称，再把实现放到 `scripts/`。
- 需要启动子进程、探测端口、等待 HTTP 就绪或清理进程时，优先复用 `scripts/script-utils.mjs`。
- 长流程脚本应支持 `--help`，并在失败时输出可定位的脚本名前缀。
- 冒烟脚本应支持 `BASE`，避免把端口写死在脚本内部。
- 不要在 npm script 中使用平台专属 shell 命令；需要文件清理或路径处理时用 Node 脚本。
