# 动态注册 / 安装机制设计（Extension Registry）

> 落地 [extensions.md](extensions.md) 推荐模型所需的**唯一净新机制**：把「编译期硬编码的注册」解冻为「运行期可添加」。
> 设计原则：**最大复用既有原语**（MCP 总线 / NodeKind+REGISTRY / Grant），**最小解冻**，**信任优先**。
>
> **本稿经三视角对抗式红队审查（安全/信任 · 同步/迁移/类型安全 · 可行性/自洽）修正。** 方向（复用既有原语、最小解冻、分期）经审查成立；但初稿把多处**尚未实现的净新机制**误述为「已有不变量」，并有数处对代码的事实性误判。下文已纠正，并在 §0 汇总红队结论，让「已成立 / 须新建 / 事实纠错」一目了然。
>
> **状态更新（2026-07）：两项「须新建」已落地** —— ① tier 门：`grant.ts` 已有 `TIER_RANK`/`tierAtLeast`/`PERMISSION_MIN_TIER`/`effectivePermissions`，`grant.tier` 已被强制读取执行（`local-mcp-server` 走 `effectivePermissions`，并有「低信任档剥 `web:*`」的测试锁定）；② kind 单源：`node.ts` 的 `NODE_KINDS` 已是唯一真相源，`tools.ts` zod enum 与 `nodes-store` 均从其派生。文中 `文件:行号` 锚点是红队审查时的快照、可能已漂移，以符号名为准。

## 0. 红队结论速览（先看这条）

**总体裁定：方向成立，但落地工作量被严重低估——许多「安全/同步执行点」在代码里根本不存在或默认方向相反。**

| 初稿断言 | 红队实证 | 纠正 |
| --- | --- | --- |
| ext 节点免费搭车现有 LWW，跨端不丢 | **不存在通用 Node 同步层**：`SyncScope = "subs"\|"notes"`（`sync-crypto.ts:13`），`sync/manifest.ts:14` 只同步 subs/notes；bookmark/file/folder/thread **今天就完全不同步** | ext 跨端是**净新工作量**，或显式声明 ext 本地-only（§4） |
| `grant.tier ≥ spec.minTier` 按信任层挂载 | `GrantTier` 是无序字符串联合，全仓 `grant.tier` **从不被读取**；能力层只看 `permissions.includes` | minTier 是**净新门**，须建 `TIER_RANK` 偏序（§2.1）**（✅ 已落地，见顶部状态更新）** |
| 未知 extKind「默认剥离」 | `stripNode`（`node.ts:100`）是闭合 switch，ext 走 `return n` = **默认泄漏**；且**永不剥 meta/title/tags** | stripNode 对 ext **fail-closed** 剥 content+meta（§2.3） |
| `ext:` 命名空间把三方爆炸面关进 ext | **进程内 handler 有 ambient authority**：可 `import getSession/getFilesPort` 单例直接取 token/全量节点，命名空间对进程内代码无隔离 | 三方代码**仅限进程外** external MCP；进程内能力仅一方（§2.1） |
| 撤销/过期即时断 | `isGrantActive` 只在建 server 时判**一次**（`local-mcp-server.ts:25`），长连接撤销后工具仍可调 | 撤销须**主动 teardown** + 调用期 recheck（§3） |
| 平面2a「只差 registerTab + 持久化」 | Tauri CSP `frame-src` 写死仅 wonita 四源、**烘焙进二进制**（`tauri.conf.json:26`），静态导出无运行时 CSP 下发 | 还需 CSP 运行时可注入/原生 webview 路径 + Manifest 信任链（§2.2） |
| 闭合联合「只解冻一次加 ext」 | kind 真相源**不止一处**：`tools.ts:29` 另有 zod enum、`nodes-store.ts:42` 另有 ALL_NODE_KINDS、createNode switch 需 ext 臂 | 列「加 ext 联动清单」+ 从单一 `NODE_KINDS` 派生（§2.3）**（✅ 单源派生已落地）** |

**经审查仍成立（design holds）**：① core `PERMISSIONS` 闭合联合对一方仍「拼错即编译失败」（只要类型层分叉 core/ext）；② 「越权=工具不存在」最小权限默认；③ 每消费方独立 server+Grant 互不可见（隔离基座，`local-mcp-server.ts`）；④ `agentGrant` 不含 `fs.notes:read` 是真实最小权限默认（被破坏的是下游 stripNode/端口闸，非该集合）；⑤ `REGISTRY` 字符串键 + 优雅兜底；⑥ 平面3 端口后端已是 register/get；⑦ ext 作单一逃生舱 kind 方向合理（须认其真实联动成本）；⑧ 分期 P0→P3 排序合理。

## 1. 现状：编译期硬编码（实证）

| 注册点 | 文件 | 形态 | 冻结程度 |
| --- | --- | --- | --- |
| 能力（tool/resource） | `tools.ts` `registerGrantedTools/Resources` | 一串 `if(has(perm)) server.tool(...)` 字面量，含按 kind 的**运行期二次 gate**（`tools.ts:171-177` notes、`:188` 写分流） | **硬**（且非纯权限位映射） |
| 授权位 | `protocol.ts:53` `PERMISSIONS` `as const` | 闭合联合，三处单一事实源，防孤立能力漂移 | **硬**（闭合，价值即编译期防漂移） |
| 应用面板 | `registry.tsx:37` `REGISTRY` | 字符串键 + `React.lazy`，`TabContent` 有「未知标签类型」兜底 | **软**（字符串键） |
| 文件查看器 | `node-viewers.ts:24` `KIND_VIEWER` | `NodeKind→viewer`，`resolveViewer(kind)`→null 兜底（**只拿 kind，拿不到 Node 本体**） | **软查 / 硬 kind** |
| 数据类型 | `node.ts:9/88` + **`tools.ts:29` zod enum** + **`nodes-store.ts:42` ALL_NODE_KINDS** | 三份手抄的 kind 真相源 + `stripNode` 隐私分类 + createNode switch | **最硬**（多源、无 exhaustiveness 检查） |
| 同步范围 | `sync-crypto.ts:13` `SyncScope` | **仅 `"subs"\|"notes"`**；其余 kind 不同步 | **最硬**（无通用 Node 同步层） |
| 组合根 | `boot.ts` `registerAll()` | 硬编码 manifest 列表，一次性幂等 | **硬** |

`grant.ts` 已为动态化铺路（注释明写「为未来 native-messaging / 『已连接的应用』consent 面板铺路」「持久 Grant 存储是 P2」）；能力层 `createLocalMcpServer` 已与 transport 解耦、据 Grant 起 server。

## 2. 三个注册平面的解冻方案（已按红队修正）

### 2.1 能力注册（最便宜，但有硬边界）

把 `tools.ts` 字面量换成**能力注册表**，但必须区分两类来源——这是红队最关键的纠正：

> **铁律：进程内 handler = 可信代码，仅限一方注册。三方代码一律进程外（external MCP），经 IPC 边界。**
> 原因：进程内 `CapabilitySpec.handler` 是宿主进程任意 JS，可 `import { getSession }`(`tools.ts:7`)、`getFilesPort()`(`tools.ts:10`) 直接拿 token / 全量节点，**与它声明的权限位无关**——`ext:` 命名空间对进程内代码毫无隔离作用。

```ts
// 设计草图
type CoreCapability = { permission: CorePermission; ... }   // 仅一方/随包，内部 registerCoreCapability
type ExtCapability  = { permission: ExtPermission;  ... }   // 仅进程外 external MCP，对外 registerExtCapability
type CapabilitySpec = {
  id: string
  kind: "tool" | "resource" | "prompt"
  minTier: GrantTier
  // handler 不再 import 模块单例：经 ctx 注入「按 Grant 收窄过」的句柄
  handler: (ctx: ScopedHostCtx, args) => Promise<unknown>
}
```

落地要点 / 红队修正：
- **`createLocalMcpServer` 注册门 = 两条都过**：`permission ∈ grant.permissions` **且** `TIER_RANK[grant.tier] ≥ TIER_RANK[spec.minTier]`。`TIER_RANK = {first-party:2, verified:1, any-origin:0}` 是**净新偏序**（红队审查时 `grant.tier` 全仓不被读取；✅ 现已落地于 `grant.ts`）。敏感 core 位 `fs.notes:read`/`identity.publish`/`fs:write` 的 `minTier` **钉死 first-party**，T2 即便在 `grant.permissions` 里携带也不挂载。
- **句柄注入而非单例**：`handler(ctx)` 的 `ctx` 是按 Grant 收窄过的 `ScopedHostCtx`（如只读、已 stripNode 的 FilesPort 视图），杜绝 handler 经 ambient 单例越过 `fs.notes:read` 闸门拿正文（红队证实 `getFilesPort().getNodeRaw` 返回完整 content，绕过 `tools.ts:174` 唯一的手写闸）。**正文净化须下沉到端口**：FilesPort 暴露 `getNodePublic`（已 stripNode）与 `getNodeRaw`（须显式 notes 能力），raw 不再是 ambient 依赖。
- **`fs.*` 家族保持手写 handler**：红队证实「一 spec 一 permission」装不下 `fs.read` 按 kind 二次 gate notes、`fs:write` 按 kind 分流、ui.* 依赖 `ctx.openTab`(非 permission)、`host.toast` 无授权位。`CAP_REGISTRY` 主吃**纯 handler / 外部**能力；`fs.*`/ui.*/host.* 内置面继续手写，只是改用同一注册 API 录入。
- **`mcp`（外部 server）** = 进程外 MCP **client** 出站连接（stdio/ws，**净新 transport**），把对端 `tools/list` 适配成命名空间化 `ExtCapability`（`ext.<serverId>.<tool>`），挂在一个**专属消费方身份 `ext:<serverId>` + 专属持久 T2 Grant** 下，`CAP_REGISTRY` 按命名空间过滤——确保 ext 能力**只对该 server 的 server 实例可见，不污染 agentGrant / iframe Grant**（守不变量3）。

#### `PERMISSIONS` 闭合联合的解冻（红队修正：类型层分叉 + 严格正则）

```ts
type CorePermission = (typeof PERMISSIONS)[number]               // 仍闭合，编译期校验
type ExtPermission  = `ext:${string}:${"read"|"write"|"invoke"}` // 命名空间
type Permission     = CorePermission | ExtPermission
```

- **类型层必须分叉**：对外只暴露 `registerExtCapability(只收 ExtPermission)`；core 走内部 `registerCoreCapability(只收 CorePermission)`。否则 `spec.permission` 的类型放宽含全部 `CorePermission`，三方可注册 `permission: "identity.publish"`，TS 不再拦截（`protocol.ts:51-52` 的防漂移对三方失效）。
- **严格正则**：`ext:${string}` 的 `${string}` 含冒号，`ext:foo:bar:read` 能绕「前缀一致」校验。注册期强制 `id` 段匹配 `^[a-z0-9-]+$`（禁冒号），permission 必须 `=== ext:${spec.id}:${verb}`。
- ext 命名空间内「孤立能力」无法靠运行期校验补回闭合联合的完备性——这是动态化不可逆的代价，用命名空间把它**关进 `ext:` 且仅进程外**。

### 2.2 应用表面注册（红队修正：CSP 是真正的拦路虎，不是「只差 registerTab」）

`registerTab(kind, entry)` 写入 `REGISTRY` 本身是小改动，但红队证实**运行期加任意三方 URL 会被 WebView CSP 直接拒绝、握手根本不发生**：
- `tauri.conf.json:26` 的 `frame-src` 写死仅 `wonita.link` 四源，**烘焙进二进制**；
- `next.config.ts:8` `output:"export"` 无 SSR/Node 运行时动态下发 CSP；
- `host.tsx:60` 还有 `manifest.origins` 第二道编译期白名单。

因此平面2a 实际需要：
- **(a) 突破 CSP**：要么由 Tauri 后端**运行时注入/放宽** `frame-src`（需原生侧支持），要么三方站点走**原生 webview 路径**（`browser-view.tsx` 的 `BrowserView`，无 MCP 桥 = 只能是 webpage，不能是 plugin）。**结论：运行期加的三方 plugin（带 MCP 桥）受 CSP 根本限制；纯 webpage 可走 BrowserView。**
- **(b) Manifest 信任链**：定义运行期 Manifest 的来源/签名/`origins` 准入（谁能声称 first-party？三方默认 any-origin）。
- **(c) 重放时序**（红队 medium）：`boot.ts` `registerAll` 同步且一次性 `booted` 守卫，标签水合是同步 `sessionStorage`，而动态 app 清单存**异步 IndexedDB**。重启后恢复的动态标签首帧会命中「未知的标签类型」兜底甚至永久卡住。须：存储支持**启动期同步重放**或 **gate 渲染**直到重放完成；`registerTab` 写后 `store.emit()` 触发重渲染。
- **plugin vs webpage 仍由运行期 `ideall:init` 握手探测 `connected`**——但注意上面 (a)：能不能握手本身先受 CSP 限制。

### 2.3 新文件类型（ext 逃生舱，红队修正：联动面比「一次」大，stripNode 须 fail-closed）

加一个逃生舱 `kind:"ext"` + `meta.extKind` 二级分派，**但「只解冻一次」是假象**——加 ext 的真实联动清单：

1. `node.ts` `NodeKind` 联合 + `NODE_KINDS`；
2. `tools.ts:29` 独立的 zod `nodeKind` enum（fs.* 能力面的实际门，不随 NodeKind 自动更新）；
3. `nodes-store.ts:42` `ALL_NODE_KINDS` + `createNode/updateNode/moveNode/deleteNode` 的 switch（`:185` default 抛「未知 kind」需 ext 臂）；
4. `stripNode`（见下）；
5. `KIND_VIEWER` / `resolveViewer`（见下）。
→ **消除多源**：让 `tools.ts` 的 zod enum 与 `nodes-store` 的 ALL_NODE_KINDS **从单一 `NODE_KINDS` 派生**（`z.enum(NODE_KINDS as [...])`），加 exhaustiveness 守卫 + 漂移锁定测试。**（✅ 已落地：`node.ts` `NODE_KINDS` 为唯一真相源，两处均已派生）**

**`stripNode` 必须 fail-closed（红队 high）**：现状 `node.ts:100-104` 闭合 switch 仅剥 note/thread 的 content，ext 走 `return n` = **泄漏**；且**永远透传 `meta`**（连 note 也只剥 content 不剥 meta）。修正：
- ext 节点一律剥 **content + meta**，除非其 `extKind` 在**已加载注册表**中显式 `sensitive:false`；
- 为保 `stripNode` 纯函数，把「是否敏感」做成**显式参数**（调用点 `tools.ts:165/351` 传入已解析的扩展元数据；注册表未就绪时传 `conservative=true` 全剥）；
- 显式规定 ext **不得把私密数据放 title/tags**（这两者 stripNode 永不剥）；meta 默认全私密。

**`resolveViewer` 修正**：`node-viewers.ts:33` 签名是 `resolveViewer(kind)`，调用点（`registry.tsx:85`）只有 `{kind,id}`、**拿不到 Node 本体**，故「按 `meta.extKind` 二级分派」不能在此发生。改为：`resolveViewer("ext")` 固定返回一个 `ExtViewerShell`，由它用 `nodeId` 取 Node 后读 `meta.extKind`，再查 `registerExtViewer(extKind→{viewer,sensitive,validator})` 二级分派；未注册走兜底 + 默认剥离。

> 权衡（红队 low）：`meta.extKind` 二级分派**重新引入了 `content:unknown` 的运行期不可检分派面**（正是 `NodeKind` 可辨识联合当初要消灭的）。这是「用类型安全换动态性」的自觉取舍，用注册表驱动的运行期 validator 补偿。

### 2.4 端口后端（决策 #8：升级为一等用户可添加扩展）

`registerServerPort`/`registerSyncPort`/`registerFilesPort` 已是运行期 register/get（`boot.ts`），是最易解冻面。本轮决策把它**升格为对外一等可添加扩展类型**（兑现「后端可换 / 可自建」：换同步/存储/鉴权/取数后端）。但三种端口的**数据暴露面差异极大，须按端口分信任档**：

| 端口 | 后端能看到什么 | 默认可添加档 |
| --- | --- | --- |
| `ServerPort`（取数/鉴权） | 你的查询/搜索/发布请求（明文经其转发） | **用户可换**（可换/可自建核心；≈ 改 API 端点，类比换 DNS） |
| `SyncPort`（跨端同步） | **仅密文 + storageId**（E2E 加密，读不到内容） | **用户可换**（最低风险；只触及可用性/完整性，不触机密性） |
| `FilesPort`（本机「我的」数据层） | **全部本地数据明文** | **默认不开放**，仅自托管/高级项（换它 = 换你所有本机数据的归宿） |

落地：换后端 = 运行期再 `register*Port(custom)` + 持久化所选 + 设置 UI；`FilesPort` 替换走「高级 / 自托管」闸，不进普通「加扩展」面板。

## 3. 信任与安全（红队重写）

| 来源 | 信任层 | consent |
| --- | --- | --- |
| 随包内置 | `first-party`(T0) | 自动、不过期、不可撤（`firstPartyGrant`） |
| 签名/已验三方 | `verified`(T1) | 首次一次性同意，可在「已连接的应用」面板撤销 |
| 用户手加（任意 URL / 外部 MCP server） | `any-origin`(T2) | 逐源配对 + 逐权批准 |

**必守不变量（及其当前缺口——均为净新执行点，非既有）：**
1. **token 永不出宿主**：现状靠 handler 内取 token 的约定；动态化后须靠 §2.1 的 `ScopedHostCtx` 句柄注入**强制**，不让 ambient 单例可达。
2. **私有正文默认不暴露**：`agentGrant` 不含 `fs.notes:read`（真实），但闸门只在 `tools.ts:174` 一个手写分支、不在端口——须把净化下沉到 FilesPort（§2.1），否则任一过 `fs:read` 的新能力即可绕过。
3. **每消费方独立 server + 独立 Grant**（真实既有，`local-mcp-server.ts`）——但 ext 能力的消费方/Grant 归属须新定义（`ext:<serverId>` + 专属 T2 Grant，§2.1）。
4. **撤销/过期即时断 —— 当前不成立（TOCTOU）**：`isGrantActive` 只在建 server 时判一次（`local-mcp-server.ts:25`），handler 闭包捕获 perms、无调用期 recheck。撤销/过期对**已建立的长连接**（agent loopback、常开嵌入页）无效，工具持续可调直到会话被 teardown 重建。**修正**：撤销时主动遍历该 `consumerId` 活动 transport 调 `server.close()`（`host.tsx:143` 的 cleanups 须外部可触发）；expiry 走定时主动断连；handler 入口加 `isGrantActive` recheck。
5. **不把私有数据传给外部 server —— 当前无执行机制**：外部 MCP 的 `tools/list` **description 是攻击者可控文本**，进 agent 上下文可做 **tool-poisoning / prompt-injection**，指挥 agent 把 `@` 引用 consent 注入的私有正文（`agent-context.ts:41`）当**出站参数**喂给对端。token 不作参数，但**正文作参数才是更现实的 exfil 面**。**修正（净新）**：出站前对参数做**污点扫描 / schema 白名单**，默认禁止 note/thread content、identity token 作 ext 工具参数；外部 description 进上下文前注入消毒 + 可信度标注；「可出站数据类别」纳入逐能力 T2 consent。
6. **「敏感位每次调用二次 consent」是净新，非既有**（红队修正）：代码无 per-call consent（`tools.ts:174` 持位即直接回正文），且与 MCP「据 Grant 静态注册工具」语义冲突——需 handler 包**异步 consent gate**（pending→批准），会改现有同步 handler 形态。列为 P1 前置。

## 4. 同步 / 迁移（红队重写：没有通用 Node 同步层）

**初稿最大事实错误已纠正。** 现状 `SyncScope = "subs"|"notes"`（`sync-crypto.ts:13`），`sync/manifest.ts:14` 只 `allSettled([syncSubscriptions, syncNotes])`——**bookmark / file / folder / thread 今天就完全不同步**。所以「ext 作不透明 BaseNode 走现有 LWW、数据仍同步保全」**不成立**：ext 节点**根本不进任何同步块**。

两条路，二选一并显式声明：
- **(A) ext 本地-only**（与现有非 note/subs kind 一致）：P3 起点，**不承诺跨端**，最省。
- **(B) ext 跨端 = 净新工作量**：新增 `SyncScope` 第三项 `"ext"` + 独立加密块 + `syncExt` 编排（拉/解密/合并/GC/加密/推）+ 信封校验。

**并发可编辑的 ext 用 opaque LWW 是静默丢数据**（红队 medium）：`sync.ts:55` `unionMerge` 同 id 取 `updatedAt` 较新者**整条胜、忽略 content**；note 正是为此弃整篇 LWW、改块级合并（`notes-sync.ts:27 mergeNoteContent`）。calendar/kanban 类 ext 两端各改一处 → 一端被无声覆盖。若走 (B)，富内容 ext 须提供 **per-extKind merge 钩子**（默认 LWW，富内容自带块级/CRDT）。

**跨端缺扩展**：B 端没装某扩展 → `resolveViewer` 落「暂不支持」（已实现），但**前提是 ext 数据真的同步到了 B 端**（见上，仅 (B) 成立）；且 B 端不知该 extKind 是否敏感 → `stripNode` 必须 `conservative=true` fail-closed（§2.3）。

## 5. 分期路线（按成本/风险递增，已标注真实代价）

| 期 | 内容 | 真实净新机制（红队校准） |
| --- | --- | --- |
| **P-（先行）** | `skill` = 补 `server.prompt` + `agent.run` 模板 | Prompts 实现 |
| **P0** | 能力注册表（§2.1），内置能力改数据驱动 | 注册 API + **TIER_RANK 偏序门** + **ScopedHostCtx 句柄注入**（非「字面量改 Map」那么轻；`fs.*` 仍手写） |
| **P1** | 应用表面运行期注册 + 持久化 + **持久 Grant** + **consent/撤销面板** + **撤销主动 teardown** | consent UI + 持久层 + **重放时序 gate** + **撤销 teardown**（不变量4 前置） |
| **P2** | 外部 MCP server（`mcp`） | **出站 MCP client transport** + `ext:<serverId>` 专属消费方/Grant + **出站参数污点扫描**（不变量5 前置） |
| **P3** | `native-app` 表面 + `ext` 逃生舱 kind | `NodeKind\|="ext"` **联动 5 处** + `stripNode` fail-closed + 原生 launcher + 同步决策 (A)/(B) |

## 6. 已定决策（本轮拍板）

| # | 问题 | 决策 | 落在 |
| --- | --- | --- | --- |
| 1 | add-time 选型 vs 运行期探测 | **运行期探测**：用户加「一个站点 URL」，`connected` 由 `ideall:init` 握手落档；plugin/webpage 不是 add-time 选项。对外 UI 选的是大类「加站点 / 加外部 MCP / 加原生应用」 | §2.2 |
| 2 | 能力 vs 表面非二分 | **显式允许「一个安装产出多条注册」**：一份 manifest 可同时写 `CAP_REGISTRY`（能力）+ `registerTab`/ext kind（表面）。两张注册表，一个安装可同时写 | §2.1 / 2.2 |
| 3 | 扩展数据存哪 | **拆两层**：安装/注册记录 + Grant 存专用 IndexedDB（启动期 gate 渲染至重放完成）；扩展产生的**内容**才是 `ext` kind 节点 | §2.2(c) / 2.3 |
| 4 | ext 跨端同步 | **本地-only 优先**（取 §4 的 (A)，与现有非 note/subs kind 一致，不承诺跨端）；某 extKind 确需跨端再单建同步块 + per-extKind merge 钩子 | §4 |
| 5 | 三方信任档 | **三方 = webpage（BrowserView，无桥）或 进程外 MCP server（IPC 沙箱）**；带 MCP 桥的 iframe plugin **仅限一方 / 签名源**（与 §2.2 CSP 现实 + 进程内 ambient 权限红队结论一致） | §2.2 / §3 |
| 6 | ext 隐私粒度 | **两级**：extKind 可声明「公开元数据子集」（如标题/日期，进列举 + agent 上下文），其余 content/meta 默认私密 fail-closed | §2.3 |
| 7 | 外部 MCP 沙箱 | **保守默认**：只读 + 禁出站网络 + 进程隔离（stdio 子进程）；写 / 联网 / 敏感数据出站一律逐能力 T2 显式批准 | §3 不变量5 |
| 8 | 端口后端是否对外可添加 | **进，作一等扩展类型**（兑现「后端可换 / 可自建」）；但按端口分信任档：`ServerPort`/`SyncPort` 用户可换、`FilesPort` 默认仅自托管/高级项 | §2.4 |

> 据此，**§4 取 (A) ext 本地-only**、**§2.2 三方带桥 plugin 仅一方/签名**、**§2.3 两级隐私 + fail-closed**、**§2.4 端口后端按端口分档** 已为定稿方向。剩余纯实现细节（`TIER_RANK` 常量值、`ScopedHostCtx` 句柄面、ext-viewer 注册表签名）进 P0 工单时定。
