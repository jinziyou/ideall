# freedesktop 对齐设计：数据、文件与显示的组织

> **状态：S1 / S1b / S2 / S3 / S4 / S5 全部落地。**
> **S1（已实现，commit `8cf0307`）**：`LocalDataSchema.storageClass` + IndexedDB 逐 store 分类（`src/plugins/shared/local-data-schema.ts`、各 manifest 注册点）。
> **S1b（已实现，commit `6192216`）**：5 个未注册键补登记 + `dynamicKeys` 动态家族 + secure 动态键入安全快照与遗留迁移（`src/lib/secure-store.ts`、各 owner 注册点）。
> **S2（已实现，commit `8d94420`）**：MIME subclass 表与父链上溯（`src/engines/media-type-tree.ts`、`matcher.ts`、`registry.ts`、`preferences.ts`）。
> **S3（已实现，commit `a9909cf`）**：Engine 关联文件化 `app.display/engines.json` + 偏好 v2 Removed Associations（`src/workspace/display/*`、`src/engines/preferences.ts`、`registry.ts`、`src/workspace/registry.tsx`）。
> **S4（已实现，commit `9186849`）**：Engine 描述符只读投影 `app.engines`（`src/workspace/display/engine-descriptors-file-system.ts`）。
> **S5（已实现，commits `f51c386` / `31bb223`）**：S5a recently-used 访问记录与「最近打开」面板（`src/workspace/recently-used.ts`、`src/modules/home/recently-opened.tsx`）；S5b 缩略图缓存（`src/lib/thumbnail-cache.ts`）。
>
> 缘起：ideall 的设计思想是「一切皆文件，一切皆标签页」（[file-system-engine-architecture.md](file-system-engine-architecture.md)）。freedesktop 标准族（XDG Base Directory、shared-mime-info、mimeapps.list、Desktop Entry、Icon Naming、recently-used 等）正是 Linux 桌面二十多年对「数据、文件、显示如何组织」的答案。本文逐条对照：哪些 ideall 已经同构、哪些值得补、哪些明确不借。

## 0. 范围与方法

- 本文只做**组织方式**的对齐：存储分类、类型系统、引擎关联与描述符的「文件化」。不改变同步协议、权限闸、CAS 事务等既有不变量。
- 方法：先以六路只读侦察建立事实底稿（全部结论带 `file:line`），再设计，再多视角对抗审查。S1/S2 的落码范围以 §9 切片表为准。
- 总原则：**借分类与语义，不借物理布局与路径身份**。ideall 的 `FileRef` 身份 + 路径投影严格优于 freedesktop 的 path/URI 语义；所有借鉴都重述为 `Storage → FileSystem → FileRef → Engine → Display` 五层语言。

## 1. 已有同构（不需要动）

侦察确认以下对应物已经存在，本文不重做，只命名：

| freedesktop | ideall 现状 | 证据 |
| --- | --- | --- |
| shared-mime-info（MIME 类型词汇） | `IdeallFile.mediaType` 开放词汇，`DIRECTORY_MEDIA_TYPE = "inode/directory"` 直接采用 xdg 值 | `src/protocol/file-system.ts:8` |
| mimeapps.list（默认应用关联 + per-desktop 覆盖） | Engine 偏好 `file → mediaType → priority` 解析，按工作区分 scope 键（`files` 裸键兼容、`audio`/`development` 后缀） | `src/engines/registry.ts:53`、`src/engines/preferences.ts:6-13` |
| Desktop Entry 的声明式匹配 | `EngineDescriptor` 纯声明（match/priority/layout/access/iconHint），白名单 fail-closed 校验 | `src/protocol/engine.ts:27`、`src/engines/registry.ts:195` |
| Icon Naming（标准图标名间接层） | 导航 `iconHint` → Lucide 静态映射，Engine descriptor 独立 `iconHint` 体系 | `src/workspace/navigation-sections.ts:67-96`、`src/engines/builtin.ts` |
| Trash（info 旁存 + 恢复） | 墓碑 + `trash_snapshots` + 事务 CAS 恢复（强于 spec 的路径记录） | `src/filesystem/trash-file-system.ts` |
| XDG Menu（菜单由数据派生） | 五分区固定，二级入口由 `ideall.navigation` **数据**生成，React 只留图标装饰 | `src/filesystem/navigation-file-system.ts:79-256` |
| xdg-user-dirs（well-known 目录：user-dirs.dirs 以 XDG_*_DIR key→路径映射；目录名本身按 locale 翻译创建） | 关注/书签/资源/文件为稳定 key 的 place 根；`pathName` 只是 link 名，重命名不伤身份（严格强于 xdg-user-dirs 的物理改名——物理改名会断硬编码路径引用） | `src/filesystem/navigation-file-system.ts` |
| Secret Service（凭据独立后端） | OS keyring + Web 版本化 fallback，桌面 fail closed | `src/lib/secure-store.ts`、`src-tauri/src/secure_store.rs` |

另有一个结构性巧合：五分区导航本身就是一张 XDG 投影——**我的 ≈ data、活动 ≈ 混合类（审计 = state、空间 = config、任务/删除 = data）、应用 ≈ applications、设置 ≈ config**；cache / runtime / secrets 三类**正确地不出现在导航里**。本文 §2 把这张隐含映射显式化。

## 2. S1：XDG Base Directory 分类法 → 每个存储点都有「存储类」（已落地）

### 2.1 问题

现状各存储点的归档/同步/清除策略是逐条散写在文档不变量里的（搜索索引不进归档、审计不导出、模型缓存可删……）。侦察（六路并行，全量枚举）确认这些策略**本质上已是 XDG 分类，但没有命名，也没有机器可读的单一登记表**：

- `LocalDataSchema.portable` 目前只是声明，**没有导出消费方**（仅 `schema-panel` 展示）；
- 存在未注册 schema 的存储键（`ideall:semantic-search:v1`、`ideall:device:v1`、`tool:search:history`、`ideall:runtime-extensions:v2`、`ideall:agent:oauth:{serverId}`），数据健康视图对它们不可见；
- `agent.tasks` schema 以整个 `wonita-home` 库为 key，但库内 7 个 store 策略不同（`local_search_index`/`local_semantic_index` 可重建、`agent_write_audit` 不导出），库级粒度表达不了。

### 2.2 设计：六类存储类

借 `$XDG_DATA_HOME / CONFIG_HOME / CACHE_HOME / STATE_HOME / RUNTIME_DIR` + Secret Service，定义：

```ts
export type LocalDataStorageClass =
  | "data"    // 用户内容权威副本：不可重建；归档必选；同步按 scope 决策
  | "config"  // 用户偏好与公开配置：可移植（portable）候选；归档经 DataPort
  | "cache"   // 可重建派生：绝不进归档/同步；配额压力下可清除
  | "state"   // 跨会话状态与历史（快照/审计/最近使用）：持久但非内容
  | "runtime" // 会话级（sessionStorage/内存/广播/锁）：会话结束即弃
  | "secrets" // 凭据材料本体：secure-store（桌面 fail closed）或其 Web 版本化 fallback（设计内后端）；永不导出
```

### 2.3 落码点

- `LocalDataSchema` 增加必填 `storageClass`；`LocalDataSchemaInspection` 透传（`src/plugins/shared/local-data-schema.ts`）。
- IndexedDB 条目增加可选 `storeClasses: Readonly<Record<string, LocalDataStorageClass>>` 逐 store 分类。`wonita-home`（agent.tasks 条目承载）：`nodes/blobs/trash_snapshots/agent_tasks = data`，`agent_write_audit = state`，`local_search_index/local_semantic_index = cache`；`ideall:audio`：`tracks = data`、`state = state`（播放状态）；`ideall:database`：`tables/rows = data`。
- 构造期硬不变量（`assertLocalDataSchema` fail-closed）：`cache` / `runtime` / `secrets` 不得 `portable: true`；`secrets` 必须同时 `sensitive: true`。现有全部注册条目天然满足，不变量以类型 + 测试锁死。
- 既有 schema 归类（S1 落地时 23 条：core 10 + agent 9 + audio/database/git/sync 各 1；S1b 与 S5a 后现共 31 条）：config = theme、engine-preferences×3、startup-target、agent.settings、agent.acp、mcp、rules、skills、secrets 索引、workspaces、git.repos、semantic-search 开关、runtime-extensions 安装记录、recently-used 启用开关；state = file-tree-expanded、capture.onboarding、workspace.local、credential-revision、device id、tool 搜索历史、agent.oauth 动态家族、recently-used 记录与暂停标记；runtime = workspace.session；secrets = auth.token、sync.code（secure fallback）；data = agent.tasks、audio.db、database.db。
- 文档回写：[app-data-navigation.md](app-data-navigation.md) 的存储表增加存储类列。

### 2.4 策略派生（描述性，不新增行为）

| 策略 | 派生规则 | 现状核对 |
| --- | --- | --- |
| 工作区归档 | ⊆ `data` + `config` + `state`；`cache`/`runtime`/`secrets` 永不进入 | 现状一致：归档 = nodes+blobs+trash_snapshots(data) + 标签快照(state) + DataPort(config/data)；索引、审计、密钥均不在内 |
| 跨端同步 | 只在 `data` 内按 scope 逐块决策 | 现状一致：notes/bookmarks/subscriptions 三加密块 |
| 可清除/可重建 | 仅 `cache` | `local_search_index`、`local_semantic_index`、语义模型 Cache Storage |
| 健康视图可修复 | 与类无关，仍由 `repair` 决定 | 不变 |

### 2.5 已知盲区（S1b 已收口前两项，余一项）

1. ~~5 个未注册键补登记~~ **已落地（S1b）**：semantic-search 开关（config）、device id（state）、tool 搜索历史（state）、runtime-extensions 安装记录（config）入 core schema；`agent.oauth` 动态家族（state/sensitive）经新增的 `dynamicKeys` 机制（validate-only）逐项展开；
2. ~~secure-store 动态键脱离安全快照~~ **已落地（S1b）**：`registerSecureStoreDynamicItems` 把 `agent:secret:*`、`agent:workspace:*:apiKey`、`agent:oauth:*:tokens/:codeVerifier`、`runtime-extension-consent:*` 全部纳入快照与遗留明文迁移；
3. 主 webview 与内嵌浏览器子 webview 的站点数据物理落点未在仓库钉死（Tauri/WebKit 默认目录），Linux 上按惯例在 `$XDG_DATA_HOME/org.wonita.ideall`，需实测写入文档。

## 3. S2：shared-mime-info subclassing → Engine 匹配沿父链上溯（已落地）

### 3.1 问题

`matchMediaTypePattern` 只有精确/类型通配/片段通配（`src/engines/matcher.ts:36-48`），**没有类型层级**。后果：第三方来源（MCP connector 资源、用户上传）带来未登记类型（如 `application/yaml`、`application/ld+json`）时，没有任何语义/编辑引擎声明它们，只能落到兜底的通用预览（priority -1000，只读文件卡片 + 下载，无高亮无编辑，`src/engines/builtin.ts:267-277`、`src/workspace/viewers/generic-preview-engine.tsx`），体验等同不可打开；shared-mime-info 的答案是 `<sub-class-of>`——`application/json` 是 `text/plain` 的子类，父类型声明的引擎应能打开子类型文件。

### 3.2 关键约束：不引入任何 suffix 推导规则

freedesktop shared-mime-info spec（§2.11 Subclassing）的隐式 subclass 规则只有两条——所有 `text/*` 类型是 `text/plain` 的子类、所有 streamable 类型（除 `inode/*` 外）是 `application/octet-stream` 的子类；spec 对 `+xml` 与 `+json` suffix **均无明文推导规则**，现实中 `image/svg+xml → application/xml`、`application/ld+json → application/json` 这类父类关系全部来自数据库里逐条显式 `<sub-class-of>` 声明。**本文与 spec 一致：subclass 关系只来自显式表**——真正要防的是「自行发明」suffix 推导：`builtin.test.ts:94` 锁死「语义 panel JSON 不被 code 引擎捕获」——ideall 的 `application/vnd.ideall.*+json` 语义类型一旦被任何 suffix 推导挂上 `application/json` 父类，code 引擎（声明 `application/json`）将捕获全部语义 JSON 文件。因此：

- subclass 关系**只来自显式表**，不做任何 suffix 推导；
- `application/vnd.ideall.*` 语义类型**不进表、无父类**，隔离性保持不变。

### 3.3 设计

新文件 `src/engines/media-type-tree.ts`：

```ts
/** 显式 subclass 表（借 shared-mime-info 的 sub-class-of，仅标准内容类型）。 */
export const MEDIA_TYPE_PARENTS: Readonly<Record<string, readonly string[]>>
// text/markdown、text/csv、text/uri-list、application/json、application/javascript、
// application/typescript、application/xml → text/plain；image/svg+xml → application/xml；
// application/yaml、application/toml → text/plain；application/ld+json → application/json …

/** BFS 父链（近→远、环安全、深度封顶），不含自身。 */
export function mediaTypeAncestors(mediaType: string): readonly string[]
```

表只覆盖**标准内容类型**（仓库实际产出 + MCP/上传高频第三方类型）。不引入 freedesktop 的默认父类规则（spec §2.11 的两条隐式全称规则：所有 `text/*` 皆为 `text/plain` 子类；所有 streamable 类型——即除 `inode/*` 外的一切——皆为 `application/octet-stream` 子类，与显式声明叠加、不以未登记为条件）：ideall 引擎面里没有任何引擎声明 `application/octet-stream`，而 `text/*` 通配已直接覆盖全部 text 类型，ideall 自采用的 `inode/directory` 恰是 spec 明文排除的类型——默认规则对 ideall 无匹配增益，只会扩大匹配面。

匹配计分（`matcher.ts`）：直接命中保持原分值（精确 400 / 片段 300+len / 类型通配 200+len / 全通配 1；len = `matcher.ts:46` 的 literalLength，含斜杠，如 `text/*` → 205、`audio/*` → 206）；直接未命中时沿父链找**折损后最高**的命中：

```ts
score = directScore - SUBCLASS_DISTANCE_PENALTY * distance   // PENALTY = 150，score ≤ 0 视为不匹配
```

- 距离 1 的精确父类命中（250）低于任何直接精确（400）；与直接类型通配（205-206）相比，父链精确更高——这是**有意**的：语义上更近的父类比顶层通配更贴切。父链的类型通配（≈55+）仅高于全通配（1）；类型通配的字面量是有界的（顶层类型名），距离 ≥2 时折损恒为负 → 不匹配。**效果：父链只提供「兜底可打开」，抢不过任何直接精确声明；priority 主导排序的事实不变。**
- 候选排序仍是 priority → specificity → engineId（`registry.ts:28-34`），语义引擎 priority 远高于 code/preview，父链匹配不改变现有文件的默认引擎。
- 默认解析的 media type 偏好查找同样沿父链上溯（近亲优先——与 mime-apps spec §4 的默认应用解析同语义：沿类型层级「most specific to least specific」回退，GIO `g_app_info_get_default_for_type` 同此行为）：用户为 `text/plain` 设置的默认引擎对 `text/markdown` 生效，除非该类型另有偏好。失效偏好静默下落的既有语义不变。

### 3.4 行为保全论证（测试锁死）

- 对当前仓库实际产出的 mediaType 语料（§侦察清单：vnd.ideall.*、inode/directory、octet-stream、text/*、application/json 等），内建 20 个引擎（`builtin.ts` 的 `BUILTIN_ENGINES` 共 20 条 descriptor）的完整匹配清单**逐项不变**——因为表内类型的父类指向 `text/plain`，而这些类型本来就已被 code 的显式模式（`text/*`、`application/json`…）直接覆盖；
- 新增能力只对**未来/第三方类型**生效：`application/yaml` → code（经 `text/plain` 距离 1，得分 55）、`application/ld+json` → code（经 `application/json` 距离 1，得分 250）；
- `vnd.ideall.panel.*+json` 等语义类型无父类，`builtin.test.ts:94` 原样通过。

## 4. S3：mimeapps.list → Engine 关联成为 config 类文件（已落地）

### 4.1 问题

Engine 偏好已具 mimeapps.list 的完整形状（默认关联 + per-workspace scope ≈ per-desktop），但存在三点差距：

1. 存于 localStorage，**不是文件**——不能用通用预览查看、不能经 FileSystem CAS 编辑、不进任何导出（`portable` 仅声明）；
2. 缺 freedesktop 的 **Removed Associations**（当前只能「选」不能「屏蔽」某引擎）；
3. 读取是打开时同步直读 localStorage（`src/workspace/store/navigation.ts:188-191`），写入唯一入口是 EnginePicker（`src/workspace/registry.tsx:403-412`）。

### 4.2 设计

**物理真相不变，文件是投影**——与 settings appearance section 同一模式（theme store 持有 localStorage，`app.settings` provider 投影 JSON + CAS）：

- 新 FileSystem `app.display`，root 下挂 `engines.json`（FileRef `{app.display, engines}`，`application/json`）。读 = 三个 scope 的偏好合并为单文档：
  ```json
  { "version": 2,
    "scopes": {
      "files":       { "mediaTypes": {…}, "files": {…}, "removed": {…} },
      "audio":       {…}, "development": {…} } }
  ```
- 写 = `withFileWriteLock(engines ref)` 锁内重读快照 → `assertExpectedVersion` CAS → 全量 schema 校验 → 经 `EnginePreferenceStore` **按 scope diff 提交**（单 scope 变更 = 单一 `setItem`，与现状同级；localStorage 无事务，跨 scope 原子性不做承诺）→ 失效通知。版本 = `display-engines-v1:<sha256>`（语义版本 namespace 规则，`src/lib/semantic-version.ts`）。
- watch = `storage` 事件过滤三个偏好键 + provider 自身写后的精确通知；跨窗口收敛。
- 同步读路径**不改**（`navigation.ts:188` 仍直读 localStorage，零时序风险）。**EnginePicker 写路径改经 write-adapter**（与 `settings-write-adapter` 同模式：经 registry 回到 provider，与文件写共用同一把 FileRef 锁）——否则 picker 直写与文件 CAS 写会跨窗口互相覆盖。
- 权限：读 = `ui` / `fs:read` / engine activeFile 精确匹配；写 = `ui` / engine activeFile / 新权限位 `display.engines:write`（**不在 `agentGrant`**——与 `agent.config:write` 同先例：配置写默认不授给 agent；引擎关联决定文件由哪个 renderer 解释，不应成为普通 fs:write 的旁路面）。
- 打开入口：先经通用预览 / code 引擎可达（`application/json` 自然匹配），不新增导航项；后续可在「应用」分区加入口（S3b）。

### 4.3 Removed Associations（格式 v2）

- `EnginePreferences` 增加 `removed: Record<mediaType, engineId[]>`；`ENGINE_PREFERENCES_VERSION` 1→2：读兼容 v1（升级为空 `removed`），写一律 v2。旧构建读到 v2 回退空偏好——偏好可重建，接受该代价（文档记录）。
- 解析时先从候选中剔除 `removed` 命中项（沿与偏好查找相同的父链遍历）；**守卫：不得移除最后一个候选引擎**（至少保留通用预览兜底），移除已卸载引擎的条目为惰性无效（与失效偏好静默下落的既有语义一致）。
- EnginePicker 增加「不再用此引擎打开该类型」菜单项（写 `removed`）；「设为默认」自动清掉同类型同引擎的 removed 项。

### 4.4 登记与边界

- `app.display` 经新的随包 runtime extension factory `ideall.display` 注册（与 S4 同一批次），`navigationHidden` 挂载；dep 接线以**值传递** `window.localStorage`（与 `navigation.ts:188` 同形），不触发 `lint:storage` 冻结清单扩张。
- 旧三个 localStorage 键保留为物理存储（不迁数据）；`local-data-schema` 三条 engine-preferences 条目维持登记，`storageClass: "config"` 已由 S1 落地。

## 5. S4：Desktop Entry → Engine 描述符自托管为只读文件（已落地）

### 5.1 问题

「一切皆文件」目前有一个自指缺口：**Engine 本身不是文件**。20 个内建 descriptor + 运行时扩展注册的 descriptor 只活在注册表内存里，用户与 AI 都无法以文件方式检视「这台机器上有什么引擎、各自声明了什么匹配」。

### 5.2 设计

借 Desktop Entry 的双层模式（系统层 `/usr/share/applications` 只读 + 用户层 `~/.local/share/applications` 可写覆盖），但按 ideall 信任边界改造：

- **系统层 = `app.engines` FileSystem（只读投影）**：root 目录 `readDirectory` 按注册表当前内容列出 `<engineId>.json` 条目；`read` 返回该 descriptor 的 JSON（engineId/label/match/priority/layout/access/suspension/supportsStandaloneWindow/iconHint——全部为公开元数据，**不含 renderer 代码**）；版本 `display-engines-v1:<sha256>`；`watch` 由 `engineRegistry.subscribe` 驱动（runtime extension 装卸即触发 `changed`）；`write`/`invoke` 一律 `unsupported`。
- **用户层 = S3 的 `engines.json`**：可写的只有「关联与屏蔽」这种纯偏好数据。
- **Exec 等价物留在签名管线**：`.desktop` 的 `Exec=` 是代码，ideall 的对应物是 renderer 注册——继续只能经组合根 / 签名 runtime-extension 管线（`registerFileEngineContribution` 白名单校验 + 原子成对注册），**绝不**因为描述符可被文件读取/编辑就开放。文件投影 ≠ 可写注册。
- 权限：读 = `ui` / `fs:read` / engine activeFile 精确匹配（descriptor 是无敏感元数据）；agent 经普通 `fs:read` 即可枚举引擎面，符合「AI 经文件系统认识环境」的定位。
- 与 S3 合并为一个 `ideall.display` 随包 runtime extension：`fileSystems: [app.display, app.engines]` 同批挂载，失败整体回滚。

## 6. S5：显示层两处补齐（已落地，经用户拍板解除停放）

- **recently-used.xbel → 最近打开记录（S5a，`f51c386`）**：打开路径（`openFileTarget`）在成功解析后记录 `{refKey, name, mediaType, engineId, openedAt}`，去重置顶、100 条封顶。隐私契约按设计执行：**默认关闭**（Home 概览「最近打开」面板给发现式启用入口）、隐身暂停、可清空、逐条移除、逐条 XBEL private 标记（保留文件但不展示）；`state` 存储类、不进同步；水合恢复的标签不经 `openFileTarget`，不会被误记。实现：`src/workspace/recently-used.ts`（领域 store）+ `src/modules/home/recently-opened.tsx`（面板）+ 打开路径钩子（`navigation.ts`）。**收集面收窄（审查修订 `b812257`）**：`ideall.core` 只记录 `node` 资源（笔记/书签/文件/关注/对话），排除 panel/place 应用 Chrome 与 browser/info/community/tool 外链资源页（其 name 为完整 URL、可含搜索词，超出「文件」语义）；冷启动启动页与工作区切换传 `record=false`，`openedAt` 保持打开语义；持久化失败时内存缓存升格为本会话权威。
- **Thumbnail spec → 缩略图缓存（S5b，`31bb223`）**：借 spec 的「key = 身份 + 失效版本」形状，**不借** `file://` URI + mtime——key = `(FileRef, version)`。`createImageBitmap` + canvas 降采样（最长边 320）→ dataURL 内存 LRU（200 条、在途去重、失败不缓存）；会话级 `cache` 语义，不进持久层/同步/归档。实现：`src/lib/thumbnail-cache.ts`；`ActiveThumbnail` 先查缓存、解码失败回退原图 ObjectURL。**格式细则（审查修订 `b812257`）**：GIF 短路回退原图（降采样丢动画且 JPEG 黑底化透明区）；默认解码统一 PNG 输出保留全部格式 alpha。

## 7. 明确不借鉴

1. **路径即身份**：Trash info 记原路径、Thumbnail 按 URI key——ideall 的 `FileRef` 身份 + link 投影严格更好；只借形状。
2. **suffix 推导 subclass**：spec 本无此类规则（隐式规则仅 `text/*`→`text/plain` 与 streamable→`application/octet-stream` 两条，§3.2），本文亦不自行发明任何 suffix 推导——subclass 关系只来自显式表，以保 `vnd.ideall.*` 语义类型隔离。
3. **DBus / activation / FileManager1**：ideall 已有 Grant→MCP 能力链路与 FileSystem registry，不引入第二套 IPC。
4. **`.desktop` 的 `Exec`**：renderer（代码）注册留在签名 runtime-extension 管线（§5.2）。
5. **freedesktop 的宽松一致性**：spec 普遍 best-effort 扫描；ideall 的事务 CAS 不变量更强，绝不为对齐放松。
6. **字面物理布局**：不把 IndexedDB/localStorage 拆成 `~/.local/share` 目录树——映射是**分类策略**，不是物理路径（Rust 侧 `app_data_dir` 本已落在 XDG 目录，天然合规）。
7. **默认父类规则**（所有 `text/*` 隐式 subclass `text/plain`；除 `inode/*` 外一切 streamable 类型隐式 subclass `application/octet-stream`）：无匹配增益，只扩大匹配面（§3.3）。

## 8. 不变量保全表（对照 [architecture.md](architecture.md) §6）

| 不变量 | 本设计如何保持 |
| --- | --- |
| 1 后端可换 | 不涉及 ServerPort |
| 2 本地数据不自动整库上传 | S1 把「不进归档/同步」从散落条款变成类派生，方向是收紧而非放宽 |
| 3 协议纯度 | S2 的 subclass 表与匹配逻辑在 `src/engines/`，不进 `@protocol`；`EngineMatcher` 契约字段不变 |
| 4 wire DTO 边界 | 不涉及 |
| 5 依赖方向 | S1 字段在共享 schema 类型（plugins/shared），注册点仍在各 manifest；S3/S4 经 runtime extension 批次挂载，无反向 import |
| 6 两套身份隔离 | 不涉及 |
| 7 本地核心离线可用 | 全部改动本地纯函数/本地投影 |
| 8 core Node 库投影封边界 | S1 不改 store；S3 的偏好文件是 owner store 的投影，与 settings appearance 同模式；S4 只读 |
| 9 AI 隐私三道闸 | S4 的 descriptor 是无敏感元数据；S3 偏好文件不含正文；不新增 `fs.notes:*` 面 |
| 10 AI 产物写入用户提交 | 不涉及 |
| 11 笔记块级合并 | 不涉及 |

## 9. 切片计划与验收

| 切片 | 内容 | 验收 | 状态 |
| --- | --- | --- | --- |
| **S1a** | schema 加 `storageClass`（+`storeClasses`）+ 全部既有注册归类 + 构造期不变量 + 测试；`app-data-navigation.md` 加存储类列 | `pnpm typecheck && pnpm lint && pnpm test` 全绿；新增不变量单测 | 已落地（`8cf0307`） |
| **S2** | `media-type-tree.ts` + matcher 父链折损计分 + 偏好查找上溯 + 测试（语料保全 / 新类型降级 / 偏好继承 / vnd 隔离） | 全绿 + 语料保全真项断言 | 已落地（`8d94420`） |
| S1b | 5 个未注册键补登记 + `dynamicKeys` 动态家族 + secrets 动态键登记进安全快照与迁移 | 健康视图可见 + 快照/迁移含动态键 | 已落地（`6192216`） |
| S3 | `app.display` provider（engines.json 投影 + CAS + watch）+ 偏好格式 v2（`removed`）+ EnginePicker 屏蔽菜单 | 全绿 + CAS/守卫/迁移测试 | 已落地（`a9909cf`） |
| S4 | `app.engines` 只读投影 + `ideall.display` extension 批次 + 投影一致性测试 | 全绿 | 已落地（`9186849`） |
| S5a | recently-used 访问记录（显式开关默认关、隐身暂停、可清空、XBEL private）+ 「最近打开」面板 | 全绿 + store/schema 测试 | 已落地（`f51c386`） |
| S5b | 缩略图缓存（key=(FileRef,version)、降采样、内存 LRU）+ ActiveThumbnail 接入 | 全绿 + 缓存行为测试 | 已落地（`31bb223`） |

每切片独立提交（Conventional Commits + `Co-Authored-By`），门禁 `pnpm verify:checks`（构建在沙箱外补跑）。

## 10. 开放决策与拍板记录

| 决策 | 结论 | 备选（为何否决） |
| --- | --- | --- |
| 分类挂在哪 | `LocalDataSchema.storageClass` + IndexedDB `storeClasses` | 拆库按 store 分 IndexedDB（迁移成本与事务原子性破坏，否决） |
| subclass 关系来源 | 仅显式表 | suffix 推导（§3.2）、默认父类规则（§3.3）、完整导入 shared-mime-info XML 数据库（几千类型对引擎面无增益，否决） |
| 折损计分 | 线性 `−150×distance`，≤0 不匹配 | 分级档位（不可解释）、不降分（父类抢直接声明，否决） |
| S3 物理存储 | localStorage 保持真相，文件为投影 | 迁移到 IndexedDB/文件为真相（同步读路径全部要改异步，时序风险大，否决） |
| S3 归属 | 新 `app.display` FS（与 S4 同 extension） | 塞进 `app.settings` 第六 section（SettingsPage 五 section 结构与本机数据语义被打乱，否决） |
| 偏好 v2 迁移 | 读兼容 v1、写 v2 | 双版本并行写（复杂度无收益，否决） |
| S4 只读投影内容 | descriptor 全量公开元数据 | 含 renderer 信息（代码边界，否决） |

## 11. 文档关系

- 现行五层契约权威：[file-system-engine-architecture.md](file-system-engine-architecture.md)；S2 的 subclass 语义已回写其「Engine 与 Display」节（`8d94420`），S3/S4 的关联投影与描述符投影已回写其「当前文件系统」节（`a9909cf`/`9186849`）。
- 存储落点权威：[app-data-navigation.md](app-data-navigation.md)；S1 的存储类列已回写其存储表（`8cf0307`）。
- 历史设计方法样板：[design/archive/ai-native-redesign.md](design/archive/ai-native-redesign.md)。
- 侦察副产（已另行修复）：`file-system-engine-architecture.md` 与 `app-data-navigation.md` 的「我的」二级入口清单曾漏收件箱（实际五项，`navigation-file-system.ts:86-94`）、`panel:inbox` 例外未声明、规范 URL 清单缺 `/home/inbox`——已在本轮文档修正中补齐；`overview.tsx` 两处陈旧注释仍待顺带清理。
