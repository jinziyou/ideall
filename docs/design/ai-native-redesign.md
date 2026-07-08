# ideall 总体重构设计 — 个人信息终端 · 一切皆文件 · 一切皆标签

> **状态**:设计稿(2026-06-24 起多轮对话 + 多代理对抗验证产出),**已全部落码**(P2→P5,统一 Node 库 / 一切皆标签 UI / `fs.*` AI 层 / 笔记块级合并)。本文是该重构的权威设计依据。
> 代码已按终端分层重组(shell/workspace/files/modules/plugins/ui/shared/lib),文中 `文件:函数` 路径锚点为重组前位置,现行结构见 [architecture.md](../architecture.md) §3.3。
> **关系**:现行架构见 [architecture.md](../architecture.md);本文是在其之上的下一代方向,**落地结果已回写** architecture.md §2(统一 Node)/§3.4(fs.* AI 层)/§6(不变量 8–10)。本文保留为完整推导与雷区清单。
> 所有用户可见文案与代码注释用简体中文。文中 `文件:函数` 锚点指向现有代码的改动点。

---

## 0. 范围与方法

把 ideall 重新定位为开源、本地优先的 **个人信息终端**,用两条统一隐喻贯穿(AI 原生是贯穿其中的设计思想之一):

- **一切皆文件**(功能组织,借 Linux VFS):所有内容收敛为单一命名空间里的可寻址节点。
- **一切皆标签**(UI):打开任意「文件」即开一个标签,标签是通用查看器/编辑器。

设计分四块,每块都经"映射真实代码 → 设计 → 独立怀疑者对抗验证 → 综合"流程,验证抓出的 `fix-breaks` 已改对(本文各处标 ⚠️ 验证修正):

1. 数据层:统一 `Node` 库 + 四步折叠 + 墓碑
2. UI 层:一切皆标签
3. AI 层:`fs.*` 工具面 + 隐私
4. note 块级并发合并(跨层)

---

## 1. 定位与产品不变量

**一句话主张**:你的一切内容都是命名空间里可寻址的「文件」节点,打开任意文件即开一个标签;AI 是横跨本地/连接两态的环境层——文件是它的记忆与工作产物,标签是它为你物化的视图。诚实保留:**开源 / 本地优先 / 后端可换·可自建**。

architecture.md §6 各条产品不变量逐条保全(下表对应 §6 当时的 7 条;§6 现已扩至 10 条):

| 不变量 | 本重构如何保持 |
|---|---|
| 后端可换 / 可自建 | `NodeRef`/`Node`/viewer 注册表/`fs.*` 契约在 `protocol`/`embed`;AI 经 `LocalMcp`(基于 `FilesPort`)读写;BYO-key 直连任意端点。无新后端依赖。 |
| 个人数据默认不上传 | 寻址/`fs.*` 全走本地 IndexedDB;笔记正文默认**不进** AI 上下文(§6.3);同步仍走既有 E2E 密文块。 |
| 协议纯度(ESLint) | `node-ref.ts`/`node.ts` 纯类型;viewer 注册表的组件是 `()=>import()` thunk;`content` 的 `note`/`thread` 分支用 `unknown[]` 不依赖 platejs。 |
| wire DTO 边界 | 不触碰 HTTP 适配器;`/discover` 远程内容仍经 `ServerPort` 领域类型。 |
| 两套独立身份 | `identity.publish` 独立权限位,token 宿主持有,**不被** `fs:write` 覆盖(§6.2)。 |
| 零后端可用 | `note/bookmark/file/thread/tool` + agent(BYO-key)全离线;`thread` 归 local 视图,`MODE_OF` 移除 agent 的 connected 归属。wonita 是默认且经 `ServerPort` 可换/可自建的后端。 |
| 跨端同步 LWW + 墓碑 | `Node` 满足 `SyncRecord`,`unionMerge`/`pruneExpiredTombstones`/`expiredTombstoneIdsToDelete` 逐字复用;按 kind 分区(§8)。 |

---

## 2. 统一 Node 模型(北极星 + 既定终局)

**核心认知**:`notes-store.ts` 已是统一 Node 库的胚胎——`Note = {id,title,content,parentId,sortKey,tags,createdAt,updatedAt,deletedAt?}` 就是 `Node` 减 `kind/mime/blobRef`,已有递归树 / fractional sortKey / 原子 RMW / 级联软删墓碑 / LWW 同步。

**用户锁定决策**:物理统一到单一 `STORE_NODES` 是**既定终局**(非"按需")。

### 2.1 类型(`@protocol/node.ts`,新建)

```ts
export type NodeKind = "folder" | "note" | "bookmark" | "file" | "feed" | "thread"
export interface NodeRef { kind: NodeKind; id: string }
export interface BlobRef { store: "blobs"; key: string; size: number; mime: string }

interface BaseNode {
  id: string
  parentId: string | null   // 复用 Note 树语义; 单根树下 null 只属唯一根
  sortKey: string           // fractional index (sort-key.ts)
  title: string
  tags: string[]
  createdAt: number
  updatedAt: number         // LWW
  deletedAt?: number        // tombstone
  meta?: Record<string, unknown>
}

export type Node = BaseNode & (
  | { kind: "folder";   content?: null }
  | { kind: "note";     content: unknown[] }                                   // Plate Value (协议不依赖 platejs)
  | { kind: "bookmark"; content: { url: string; description: string; favicon: string } }
  | { kind: "file";     blobRef: BlobRef; content?: null }                     // Blob 旁存 STORE_BLOBS, 不进同步
  | { kind: "feed";     content: { type: SubscriptionType; key: string; favicon: string; entityLabel?: string; entityName?: string; searchKeyword?: string; searchDomain?: string } }
  | { kind: "thread";   content: { messages: unknown[] } }
)
```

要点:`kind` 主辨识(不要顶层 `mime`,file 用 `blobRef.mime`);可辨识联合杀掉 `content: unknown` 的类型逃逸;`note` 的 `unknown[]` 是协议纯度被迫且合理的妥协。

### 2.2 合成单根树(用户锁定决策)

`ROOT_ID="root"` + `NS_ROOT`(`root:notes/root:bookmarks/root:resources/root:feeds/root:threads`)。合成根是**确定性 id 的本地脚手架**:`isRootNode(id)` 判定;**本地确定性重建、不进同步**(`createdAt/updatedAt=0` 字节一致);`parentId=null` 只属唯一根,内容节点一律挂在命名空间根之下。`nodePath` = 沿 `parentId` 链回溯的真实树位置(派生视图,可变),`id` 才是寻址真相。

### 2.3 各实体归位

| 实体 | 现状 | 归位 |
|---|---|---|
| Note | 树+sortKey+同步 | `kind:"note"`,播种 `STORE_NODES`,逻辑零改 |
| Bookmark | 随机 id,硬删,未同步 | `kind:"bookmark"`,补 `sortKey/updatedAt/deletedAt`,硬删→软删 |
| BookmarkFolder | 独立 store | `kind:"folder"` 节点 |
| StoredFile | Blob 内联,未同步 | `kind:"file"`,Blob→`STORE_BLOBS`,节点存 `blobRef` |
| Subscription | **确定性键** `type:key`,已同步 | `kind:"feed"`,**保留确定性 id `feed:type:key`**,同步边界投影回旧 wire |
| AgentThread | 随机 id,无树/无同步 | `kind:"thread"`,最后折叠,同步默认关 |

---

## 3. 折叠现状(clean-slate)

**已采用 clean-slate**:旧数据(本地 IndexedDB + 服务端 DB)一次性清空、重新跑,故**不做增量数据迁移**——迁移机制(`*-migrate.ts`/`migrateNotesTreeOnce`/`seed*Once`/drain、legacy per-kind 旧库)已全部删除。`onupgradeneeded` 只 `createObjectStore`(`STORE_NODES` + `STORE_BLOBS`,零 I/O → 升级安全),所有 kind 一律在统一库里全新落地。

各 kind 在 `STORE_NODES` 的落地形态(节点↔域类型投影只在各 `*-store` 门面内发生):

| kind | 落地形态 |
|---|---|
| **note** | 树 + sortKey + 同步,逻辑零改;`Note` 域类型无 `kind`,写路径按 `kind==="note"` 投影 |
| **bookmark / folder** | `sortKey/updatedAt` + 软删(`deletedAt`,非硬删) |
| **file** | Blob 旁存 `STORE_BLOBS`,节点存 `blobRef`;软删 |
| **feed** | **确定性 id `feed:type:key`,绝不 genId**;同步边界 `feed 节点 ↔ 旧 Subscription wire` 投影,`"subs"` scope 零改;含墓碑 |
| **thread** | 跨 plugin/core 边界,agent 插件经 `FilesPort` 消费(修依赖反转破例);同步默认关(对象 LWW 会截断 `messages[]`);本机软删进入统一回收站 |

`nodes-store` 读写主体见独立实现(`listNodes(kind)/listChildren/getNode/readBlob/getAncestors/createNode/updateNode(RMW)/moveNode/deleteNode({soft})/restoreNodes`),三处按 kind 分叉:`nodeText`(全文摘要)、file 的 Blob 旁存、content 归一化。树工具(`effectiveParentId/buildParentOf/cmpSibling`)、`computeSortKey`、`collectSubtreeIds` 逐字复用。

---

## 4. 墓碑机制(复用,三层一致)

删除以墓碑(`deletedAt` + **bump `updatedAt`** + 压缩正文)而非物理删,使删除沿 `unionMerge` 跨端传播;读路径 `.filter(isLive)`;级联整棵子树(防孤儿重挂到根);复活/撤销 = 写更新版本清 `deletedAt`。GC:90 天 TTL,`pruneExpiredTombstones`(合并后)+ `expiredTombstoneIdsToDelete`(落地按真实库 + keep 集),`idbBulkPutDelete` 原子落地。

**关键纪律**:合并(纯 join,不丢元素)与 GC(单独一步)**分离**——这条在 §7 块级合并里被违反过(`fix-breaks`),修法就是照搬本节架构。

---

## 5. UI 层:一切皆标签(已对抗验证)

### 5.1 registry → viewer 泛化
`node-viewers.ts:resolveViewer(kind)`:`kind→查看器`,file 的 mime 二次分派**下沉到 `FileViewerDispatch` 叶子**(tab-host 保持纯同步渲染)。`registry.tsx:TabContent` 加 `tab.kind==="node"` 分支 + `ViewerBoundary` 错误边界(节点被同步删时兜底)。`tabLayout(kind)`→`tabLayout(tab)`(`tab-host.tsx:29` 必改)。

**NoteViewer 包装**:`NoteEditor` 是 5-prop 受控组件,新建 `viewers/note-viewer.tsx` 自取数(`getNode`)+ 渲染受控 NoteEditor + `onSaved` 乐观回填标签标题。NoteEditor 维持 5-prop 零侵入。

### 5.2 查询参数路由(不能用动态段)
`?resource=node:kind:id` 收敛到单一静态壳 `out/home/notes.html`——Tauri `output:export` 下动态段刷新 404,query 不参与 asset 寻址,桌面/移动冷启动深链/刷新均不 404(雷1 `fix-holds`,已对照真实产物核实)。`resource.ts` 单点编解码(`encodeURIComponent` 封死含 `&/=` 的 id);`modules.ts:descriptorForResource` 解析 Resource 深链并兼容旧 `?node=`;`open-workspace-tab.tsx` 有 `?resource=` 或旧 `?node=` 时**只开资源标签并 return**(防列表页 descriptor 覆盖刚激活节点);`useSearchParams` **必须包 `<Suspense>`**(output:export 编译期硬约束)。

### 5.3 LRU keep-alive + 写队列(⚠️ 关键验证修正,雷2 `fix-breaks`)
entity 级标签全挂载会 OOM。三池:`fill`≤8 / iframe≤2 / `padded` 不限。
**原 `flushRef`+`await` 卸载前落库是 no-op**(React effect 晚一拍 + cleanup 置 null)。正解两条叠加:
- **修法A**:`evicting` 从 ref 提升为 **render 可见 state**,被挤出 LRU 的重型标签先进 `evicting`,挂载判定 `aliveSet ∪ evicting` → victim 在掉出的同一次 render 仍挂载;`await flushNode` 完成后才 dispatch 移除 → 才卸载。
- **修法B**:`note-write-queue.ts` **同步写队列**——`enqueueNoteDraft` 同步入队(读 live ref),独立 worker 串行 `updateNote` 消费;组件卸载/逐出/关窗后队列项仍在内存,worker 继续 → 草稿不随卸载丢。`installVisibilityFlush`(`visibilitychange:hidden`/`pagehide`)兜关窗。

### 5.4 标签去重 + 侧栏文件树 + places
`resourceTab(ref,title)` 单一去重构造器 + `openTab` 基于 id 去重 + ESLint 禁新增 `kind:"node"` 字面量,三重保证;`tabKey` 不含 title 故零碰撞。`secondary-sidebar` 复用泛型化的 Resource 文件树。活动栏 home 子项重释为根命名空间(places)切换。

---

## 6. AI 层:fs.* 工具面 + 隐私(已对抗验证)

**核心**:agent 与 iframe 共用同一条 `Grant → createLocalMcpServer → Transport` 能力链路,agent 只是换 `LoopbackTransport`(MessageChannel 本进程)的消费方。`fs.*` 是**净新建**(不是合并旧 `agent-tools`)。

### 6.1 工具契约(映射 `nodes-store` API)

| 工具 | 入参 | 权限位 | 映射 |
|---|---|---|---|
| `fs.list` | `{kind?,parentId?}` | `fs:read`(note 只回标题元数据) | `listNodes/listChildren` |
| `fs.read` | `{kind,id}` | note→`fs.notes:read`;余→`fs:read` | `getNode` |
| `fs.readBlob` | `{kind:"file",id}` | `fs:read` | `readBlob` |
| `fs.create/write/move/delete` | … | note→`fs.notes:write`;余→`fs:write` | `createNode/updateNode/moveNode/deleteNode` |
| `ui.openTab/closeTab` | `{kind,id,title}` | `ui.tabs` | `openTarget({type:"resource"})`；`openNodeTab` 仅兼容旧端口 |
| `host.openExternal` | `{url}` | `host.external` | 改用 `safeHref` 共用单函数(消除与 `embed/tools.ts:149` 的白名单漂移) |

### 6.2 权限模型
`embed/protocol.ts:PERMISSIONS` 加 `fs:read/fs:write/fs.notes:read/fs.notes:write/ui.tabs`。`createLocalMcpServer` 逻辑不改(透传 `grant.permissions`)。**`note` 的读写在共用 handler 内二次 gate 到 `fs.notes:*`**(防 `fs:write` 绕过 notes 专属位)。`identity.publish` if 块与 `fs:write` 块**平行不合并**。`agentGrant`(本应用 agent,不复用 `firstPartyGrant`,无 manifest)默认集含 `fs:read/fs:write/fs.notes:write/ui.tabs`,**默认不含 `fs.notes:read`**。

### 6.3 隐私三道闸(用户锁定:概览含标题、正文须 @ 引用)
雷1 `fix-holds`,穷举十条泄漏路径全 gate。关键陷阱:**`NoteMeta` 的 `excerpt`+`search` 是正文/全文纯文本**(hub-data.ts:91-95)——
1. **概览**(`gatherHomeContext`):新增笔记一路**只取 `m.title`,绝不取 `excerpt/search`**;
2. **`fs.list`**:对 `kind==="note"` 节点**剥 `content/excerpt/search`**,只留标题元数据(即便持 `fs.notes:read` 也不批量回正文)——`strip(n)` 抽共用单函数,`fs://nodes` 资源 handler 同点复用防漂移;
3. **`fs.read(note)`**:无 `fs.notes:read` → `fail(-32003,"consent-required")`;`@` 引用单条单次临时注入 `fs.notes:read`,拒绝则不注入。
工具结果回传:能进 `role:"tool"` 消息发给模型的正文只有 `fs.read(note)` 一条,已被 consent gate;`fs.create` 回的是 AI 自己刚写的内容,非既存私密正文。iframe manifest 永不含 `fs.notes:read`。

### 6.4 LoopbackTransport + runAgent→MCP(雷2 `fix-holds`)
`LoopbackTransport` 照 `MessagePortTransport` 用 `MessageChannel` 本进程实现;agent 启动 `agentGrant` → `createLocalMcpServer` → `server.connect(loopback)`;`runAgent` 把 `AGENT_TOOLS`→MCP `tools/list`、`executeTool`→`callToolSafe`,保 8 轮循环 / `toolEvents` / BYO-key(现有 `executeTool` 本就是 async+await,异步往返无破坏;`fail()` 的 `isError:true` 不抛)。退化点:`summarize(name,data)` 要按工具名映射中文文案,否则 `toolEvents` 退化成原始 JSON。

### 6.5 对话即文件
`thread` 已是节点(步 D),`@上次的方案讨论` → 解析 NodeRef → `fs.read`(gated)→ 注入上下文 → 跨线程记忆,无需向量库。AI 栏关注 `activeId` 作隐式上下文(经只读端口,不让 agent 直 import workspace store)。

---

## 7. note 块级并发合并(跨层,已对抗验证)

把 §4 的三件套(稳定 id + LWW + sortKey + 墓碑 + 纯 join/GC 分离)**下沉到 note 内顶层块**,**不引入 Yjs/Automerge**。合并粒度 = 顶层块:同块并发 LWW 一方胜(§7.5 声明的可接受代价),跨块并发无损。同时解决:① AI 与用户并发写笔记不丢;② 笔记跨端并发同步无损;③ 块级 v 支撑"只传变更块"增量上传。

### 7.1 块数据模型(sidecar,不 inline)
`Note.blockMeta: Record<BlockId, {v,by,sk,del?}>` 与 `content` 并列(不往 Plate 块写 `_v/_sk/_del`):隔离 normalize(`JSON.stringify` 比对不被版本号污染)、墓碑不必渲染、版本号不污染渲染层。`content` 数组就是 Plate 直接吃的 Value,零改造。

### 7.2 稳定块 id(platejs v53 已核实)
`note-editor.tsx` 启用 `NodeIdPlugin`:`idCreator:()=>genId("blk")`、`initialValueIds:"always"`(全量补 id,修"中间块缺 id")、`reuseId:true`(undo/redo 保 id)。分裂(回车)上半留 id、下半发新 id;合并(退格)前块留 id、后块 id 消失 → `diffBlocks` 产 delete。嵌套块(code_line/list-item)严格**只取 `editor.children` 顶层项,不下钻**。

### 7.3 写路径 = 块级 patch(雷A `fix-holds`)
编辑器记 mount-time `base` 快照,flush 时相对 base 算 `BlockPatch{upsert,delete}`:**`del = [...base.keys()].filter(id => !curIds.has(id))`** —— delete 被 `base.keys()` 严格上界,**AI 追加的 B4 从不进 base ⇒ 永不入 del**。`updateNote` 的 `applyBlockPatch` 只 set/delete 被点名的块,未点名块(B4)原样保留 → 雷3 反例的精确解(拆掉整 record 覆盖根因)。RMW 同事务原子。

### 7.4 跨端合并(⚠️ 关键验证修正,雷B `fix-breaks`)
**原设计把墓碑 GC 折进 `mergeNoteContent` 逐块循环**(过期墓碑 `continue` 丢掉)→ 非结合 + 已删块复活。**修法 = 照搬 node 级合并/GC 两段分离**:
1. `mergeNoteContent` 改**纯 join**:不接收 `now`、不丢任何 id,per-block `(v,by)` 取 max + `(sk,id)` 排序,**过期墓碑照样保留**(`del` 原样带出)→ 墓碑始终以更高 v 压制陈旧活跃副本 → 交换/结合/幂等成立;
2. 块墓碑 GC **单独一步**,合并后对权威全集统一应用(对称 `pruneExpiredTombstones`),物理删只在落地侧按真实库 + keep 集(对称 `expiredTombstoneIdsToDelete`),合并阶段块墓碑**只增不减**;
3. **空块归一化堵漏**:`emptyNoteContent` 注入的空段落必须带稳定 id + blockMeta,补 id 只经数据层**唯一入口**——否则两端各发不同 genId 的空段落,union 当两块**永不收敛**。

### 7.5 同块并发取舍
块为粒度 → 同块并发取 `(v,by)` LWW 一方胜,另一方该块改动整块丢失。这是"不上 Yjs"的代价:同段落同时编辑罕见,跨段落并发(常态)无损。

---

## 8. 同步与传输(为何不上 CRDT 库)

- **身份**:稳定不透明 id,**绝不用 path/content/hash**(path 可变 → 改名/移动=删+建,破坏 LWW move 传播)。
- **冲突**:per-record LWW + 墓碑(已上线、已验证)。整块替换会丢并发改不同记录的编辑,故保留 per-record 粒度。
- **传输**:hash/`updatedAt` 水位只用于**增量上传**(只传变更记录/块),修 notes 整库全量重传;不进身份层、不替代冲突解决。
- **per-kind 分区**:一个 `nodes` 库,按 kind 切独立加密块,各 kind 可有独立合并函数(`feed` 投影旧 wire;`thread` 默认不同步;`note` 走块级合并)。
- **结论**:不上 Yjs/Automerge 全局库。三层(记录 / 节点树 / note 块)用**同一套原语**:稳定 id + `(v/updatedAt)` LWW + fractional sortKey + 墓碑 + 纯 join/GC 分离。CRDT 的需求被 LWW-Element-Set 机器的分层复用满足,note 块层是粒度最细的一层。

---

## 9. 实现期隐患清单(各验证阶段 ⚠️ 汇总)

落地前必须逐条收口:

**UI 层**
- [ ] `tab-host.tsx:29` `tabLayout(t.kind)` → `tabLayout(t)`,否则编译失败。
- [ ] `useSearchParams` 必须包 `<Suspense>`(output:export 硬约束)。
- [ ] LRU `evicting` 用 render 可见 state(非 ref);`note-write-queue` 同步入队;`installVisibilityFlush` 挂载时调一次。
- [ ] `MAX_ALIVE_FILL=8 / IFRAME=2` 拍脑袋,需实测调参;`computeOverflow`/`flushNode` 等待粒度实现期定。

**AI 层**
- [ ] `strip(n)` 抽共用单函数,`fs.list` 工具与 `fs://nodes` 资源同点复用(防净化漂移)。
- [ ] `summarize(name,data)` 按工具名映射中文,保 `toolEvents` 可读。
- [ ] 补单测锁:`fs:read` 列 note 不回正文 / `fs.read(note)` 无 grant 报 consent / `agentGrant` 不含 `fs.notes:read` / iframe manifest 不含 `fs.notes:read`。
- [ ] `callToolSafe` 注释更正(应用级 `isError` 不抛,只协议/传输级抛)。

**note 块级合并**
- [ ] `flowback` 的 `FILES_UPDATED` 加 `{kind,id}` payload(否则 live-merge 分不清哪条笔记变更 + 任何节点写都触发重读)。
- [ ] `baseBlocksRef` 取"首次 onChange 规范化后"的值,非原始 `initialContent`(防加载期 normalize 伪脏 → 伪 v bump 污染 LWW)。
- [ ] sk 只对"物理顺序相对前块变了"的块重算,未移动块沿用 `blockMeta[id].sk`。
- [ ] `applyBlockPatch` upsert 加 v 守卫:`v = max(u.v, curMeta[id].v+1)`,仅 `u.v >` 现有才覆盖(防 live-merge 并入的高版本块被陈旧 base 低版本 upsert 复活)。
- [ ] `diffBlocks`/`applyBlockPatch` 严格只取顶层块,不下钻嵌套块。
- [ ] block id 用**确定性 hash**(noteId+块序+内容指纹)而非随机 genId(两端独立生成得同 id,消跨端竞争)。

**数据层**
- [x] ~~每个 `planXFold` 配 `*.test.ts` 锁"零丢数据 + 幂等"~~ —— clean-slate 后迁移机制删除,无 fold 步骤;`onupgradeneeded` 只建仓零 I/O。
- [ ] 写队列 vs `notes-manager` 同 noteId 双挂载并发协调。

---

## 10. 开放决策与拍板记录

**用户已锁定**:
1. 物理统一到单一 `STORE_NODES` 是既定终局(非按需)。
2. AI 读私密笔记 = 折中:概览含标题,正文须 `@` 引用 + 确认才外发。
3. 合成单根树(`ROOT_ID` + `NS_ROOT`,脚手架不进同步)。
4. 同步身份必须稳定不透明 id,不用 path/content/hash;不上 Yjs 全局库,note 用轻量块级合并。

**仍开放(实现期/后续定)**:
- `thread` 删除:已拍板为本机软删 + 统一回收站快照; 同步仍默认关闭。
- peer 关注(关注)归属:全挂 `/feeds` + 按 type 分组(倾向)vs `root:following` 保两位置心智。
- feed 是否按 type 建确定性子目录(倾向先扁平)。
- `thread` 同步若开启:消息级 append-merge(独立 scope)。
- Blob 大文件 E2E 同步:独立通道,远期。
- places 的 `activePlace` 是否持久化。

---

## 11. 文档关系

- [architecture.md](../architecture.md) — 架构权威说明(本设计的落地结果已回写其 §2/§3.4/§6)。
- [sync-lww-tradeoff.md](../sync-lww-tradeoff.md) — LWW 取舍记录(块级合并沿用同纪律)。
- [local-data-provider.md](../local-data-provider.md) — `FilesPort`/embed MCP/Grant(AI 层地基)。
