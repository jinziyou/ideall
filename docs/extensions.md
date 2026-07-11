# ideall 扩展模型（Extension Model）

> 本文是 ideall「可添加的扩展」的权威概念模型：用户/三方能往终端里加什么、各落在哪条轴、与现有架构如何挂钩。
> 落地机制（动态注册 / 安装路径）见 [extension-registry-design.md](extension-registry-design.md)。
> 关联：[architecture.md](architecture.md)（终端分层）、[ideall-embed-bridge.md](ideall-embed-bridge.md)（嵌入桥 + MCP 能力契约）。

## 0. 两条公理（一切扩展都挂在它们上）

ideall 已把扩展性因式分解成两条既有轴，**不要另起平铺的「扩展类型」清单**：

1. **一切皆文件 / 一切皆标签** —— 内容收敛为统一命名空间的可寻址 Resource（本地文件是 `node` scheme 的 `NodeKind`），打开任意资源即经 `OpenTarget` 进入工作区标签；标签内容由 `resource-engines` / `node-kind-ui` / `registry.tsx` 分派。
2. **MCP 是统一能力总线** —— 一切「可被调用的能力」收敛为本地 MCP server 上的 tool/resource/prompt。唯一工厂 `createLocalMcpServer`（`src/plugins/embed/local-mcp-server.ts:20`）同时被 **agent**（进程内 loopback，`agent-mcp.ts`）和**嵌入页**（iframe MessagePort，`host.tsx`）消费，共用同一份 `tools.ts` 注册面与 `PERMISSIONS` 联合（`src/plugins/embed/protocol.ts:56`）。

## 1. 扩展的三条一等轴 + 一条横切轴

| 轴 | 是什么 | 挂在哪个现有原语 | 有无 viewer |
| --- | --- | --- | --- |
| **A. 能力源 Capability** | 给 agent / 嵌入页经 MCP 调用的能力 | `createLocalMcpServer` + `PERMISSIONS` + `Grant` | 无（不开标签） |
| **B. 表面 Surface** | 用户打开成工作区标签来看的视图 | `NodeKind→viewer`（文件）/ `REGISTRY`（应用面板） | 有 |
| **C. 端口后端 Port** | 换掉某个后端实现（同步 / 存储 / 鉴权 / 取数 / feed） | `@protocol/*` 的 `register*/get*` 端口 | 无 |
| **（横切）信任层 Trust** | 叠在能力/表面之上，**永不进类型枚举** | `GrantTier`（`grant.ts:14`）first-party / verified / any-origin | — |

> 决策（2026-06）：轴 A/B/C **均对外可添加**。轴 C 端口后端按端口分信任档——`ServerPort`/`SyncPort` 用户可换（可换/可自建核心；`SyncPort` 仅见密文），`FilesPort`（全部本地数据明文）默认仅自托管/高级项。详见 [extension-registry-design.md §2.4](extension-registry-design.md)。

**轴 A「能力源」有三个 MCP 原语面，别只暴露其一：**

| 能力面 | = 用户口中的 | 现状 | 落地 = |
| --- | --- | --- | --- |
| **Tools**（确定性 handler） | `tool`（如 JSON 格式化） | 已实现（`tools.ts`；近纯例 `host.toast`） | 加一个 Permission + 一条 `server.tool` |
| **Prompts**（AI 工作流 / 模板） | `skill` | **agent 侧前身已落地**（`src/plugins/agent/lib/agent-skills.ts` `BUILTIN_SKILLS`，agent 面板「技能」入口）；MCP-Prompts 形态仍未实现 | MCP 形态待跨进程消费方（iframe/出站 MCP）时补 `server.prompt`，与前身共享数据源 |
| **Resources**（只读可枚举数据） | （6 类完全漏了） | 已实现（`identity://me`、`hub://*`、`fs://nodes`） | 加一个 Permission + 一条 `server.resource` |

> 能力面再叠一条**传输/方向**子轴：进程内 loopback（agent）/ iframe（嵌入页）/ **外部 MCP server**（= 用户的 `mcp`，ideall 作 client 反向消费，需新出站 transport，**未实现**）。`mcp` 不是一个并列类型，而是能力总线上的一个**外部来源方向**。

**轴 B「表面」有两类，按「文件 vs 应用」分，冻结程度不同：**

| 表面 | = 用户口中的 | 承载 | 冻结程度 |
| --- | --- | --- | --- |
| **应用面板**（无数据落库） | `plugin`（嵌入应用）+ `webpage` | `REGISTRY`（字符串键，`registry.tsx:42`）；嵌入应用 = `EmbedHost + Manifest + Grant`；纯网页 = `bookmark` 节点 / `BrowserView` 原生 webview | **软**（字符串键 + 优雅兜底） |
| **文件类型**（可寻址 / 可同步） | （新 `NodeKind`，如日历 / 看板） | `NodeKind` 闭合联合（`node.ts:9`）+ `stripNode` 隐私分类 + SyncRecord | **硬**（动一个 kind 牵动守卫 / 净化 / 同步 / 迁移） |
| 原生应用 | `application` | 无现成原语，**唯一真新表面** | 需新机制（launcher + 安装） |

## 2. 你提的 6 类如何归位

| 你的类型 | 裁定 | 映射到现有 | 动作 |
| --- | --- | --- | --- |
| **mcp** | 🔴 层级错位 | 是**能力总线本体**（`createLocalMcpServer`），非清单一项 | 不作类型；外部源称「远程能力源」 |
| **tool** | 🟠 归并 + 改名 | MCP Tools 的纯 handler 子集 | 折叠进能力轴（确定性端）；**改名**（`utility`/`transform`） |
| **skill** | 🟠 归并（且未实现） | MCP Prompts（`bridge §5.3`） | 折叠进能力轴（AI 端）；先补 `server.prompt` |
| **plugin** | 🔴 已存在 + 改名 | 现有 `EmbedHost` 嵌入应用（info/community 即两实例，`registry.tsx:58-59`） | 沿用「**嵌入应用**」；与 webpage 合一条谱系 |
| **webpage** | 🟠 归并 | 嵌入表面降级端 / `bookmark` / `BrowserView` 三处已覆盖 | 并入「嵌入站点」+ `connected` 布尔 |
| **application** | 🟢 保留 + 改名 + 需新机制 | 无对应原语，唯一真新表面 | 改名 `native-app`；需 launcher + 新 kind |

## 3. 两个反直觉但硬性的约束

1. **`plugin` 与 `webpage` 不能在「添加时」预选。** 一个站点**是否实现 ideall 协议，只有运行期 `ideall:init` 握手才知道**（`host.tsx` + `bridge §14`）。所以用户应只添加「一个嵌入站点」，由 ideall 探测落档 `connected = true(嵌入应用) | false(独立网页)`。「先选类型再加」对这条谱系不成立。
2. **「能力」与「表面」不是干净二分。** 三类扩展同时落两边，模型必须显式允许「一个扩展既是能力又是表面」：
   - 双向嵌入应用（既开标签、又向 agent 暴露 tools —— 文档「双向」意图，今天的桥是单向：ideall 永远是 server）；
   - 带 UI 面板的确定性工具（JSON 格式化器要 textarea + 输出视图）；
   - 本地原生应用同时暴露 MCP（Ollama / 本地 DB via stdio）。

## 4. 命名保留字（避免撞名，实证）

| 禁用作类型名 | 因为已占用 | 改用 |
| --- | --- | --- |
| `tool` | ① `src/modules/tool` 发现模块（搜索/AI/导航，link-out）② `SubscriptionType 'tool'`（关注类型）③ MCP `server.tool` 动词 ④ `/tool/*` 路由 + `tool-*` kinds | `utility` / `transform` / 算子 |
| `plugin` | `src/plugins/*`（agent/sync/embed 内部机器，boot 硬编码）+ 中文「插件」 | 「嵌入应用 / embed app」 |
| `application` | `src/app/` Next 路由层 + 「嵌入应用」+「三应用」 | `native-app` / 原生应用 |
| `mcp`（作类型） | 与「MCP = 统一总线」同名打架 | 「远程能力源 / external capability」 |

## 5. 已存在 vs 仍需宿主集成（详见设计文档）

- **已落地**：嵌入应用（`EmbedHost`）、外部 MCP client、Skills、bookmark/BrowserView 轻量网页、MCP 总线、Resources 面、`GrantTier` 信任轴，以及本机应用的 FileSystem + Engine + `launch` action 链路。
- **运行时信任与生命周期闭环已落地**：`RuntimeExtensionCatalog` 对 package 强制执行宿主注入的 `discover -> verify -> consent/restore -> activate`，再用一次性内存 permit 调用 `RuntimeExtensionRegistry` 原子安装 FileSystem 与成对的 Engine descriptor/renderer。卸载、撤销和 factory 移除会 abort 在途激活、等待生命周期 disposer、逆序注销贡献；失败资源进入可诊断、可重试的 quarantine。
- **持久化不是代码加载器**：严格 v2 快照只保存 `{ id, version, digest, permissionDigest, consentReceipt }`；hydrate 不执行 factory，receipt 必须由宿主恢复并重新绑定当前 descriptor。设置页可查看来源、权限、健康度、失败和待清理资源，并对 package 执行启用/重试、撤销与确认卸载；mandatory builtin 不显示不可持久兑现的卸载动作。
- **仍属于发行/宿主层**：扩展包发现、平台签名/来源验证、consent authority 与实际 connector 进程。缺少这些注入边界时 package fail closed；任意第三方 App 的内部数据仍必须由对应 provider 在平台授权范围内暴露。

落地路径见 **[extension-registry-design.md](extension-registry-design.md)**。
