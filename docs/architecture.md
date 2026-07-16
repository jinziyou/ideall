# ideall 架构

> 本文是 ideall 的架构权威说明，面向贡献者与集成方。产品定位与上手步骤见 [README.md](../README.md)；App（桌面/移动）打包细节见 [app.md](app.md)；开发约定见 [development.md](development.md)。

## 1. 概览

ideall 是**开源、本地优先的个人信息终端**：把分散的他人、信息、资源、工具，从你自己的视角聚合到一处。它**仅以 App 形态分发**——同一套 Next.js 代码经 Tauri 2.0 静态导出后打包为跨平台客户端。

三条核心理念贯穿全部设计：

- **本地优先**：home（笔记/书签/资源/关注/对话）与 tool 的能力存于设备 IndexedDB，离线、无账号即可用；不会作为中央账户备份被自动整库上传。启用联网能力后的接收方与数据范围见[数据出站矩阵](../.github/SECURITY.md#数据出站矩阵)。
- **后端可换 / 可自建**：所有后端取数经 `ServerPort` 契约消费。wonita 服务只是默认与参考实现，ideall 不被任何单一后端绑死。
- **本地核心不依赖后端**：home / tool 本地能力与 BYO-key agent 可离线使用；无账号端到端同步只传密文，但同步动作仍需要可用的 Sync 服务。info / community 是连接数据服务后的增强。

**设计思想：一切皆文件，一切皆标签页**（完整五层契约见 [file-system-engine-architecture.md](file-system-engine-architecture.md)）：

- **五层模型**：Storage 保留各来源的物理语义，FileSystem 负责逻辑挂载，`IdeallFile` 提供稳定身份，Engine 解释文件，Display 负责活动栏、文件树、标签和独立窗口。
- **一切皆文件**：本地 Node、远端资源、系统能力和 App 数据都以 `FileRef` 寻址；目录项与文件身份分离，同一文件可出现在多个子树。`/home/...` 等路径只是从隐藏根出发的 link 投影，不进入身份。
- **一切皆视图**：默认引擎在主窗口标签页显示；用户选择其他引擎时为同一 `FileRef` 创建另一个 Engine 标签，只有文件和 Engine 策略同时允许时才另开独立窗口。标签身份为“文件 + 引擎”。
- **五分区统一导航**：隐藏合成根汇总本机与联网来源；Display 始终展示“我的 / 活动 / 浏览 / 应用 / 设置”五个一级分区，不因来源不同而隐藏入口，也不改变文件身份、挂载或已打开标签。
- **AI 是环境层**：AI 经 `fs.*` 工具面（与嵌入页共用同一条 Grant→MCP 能力链路）读写这些节点——文件是它的记忆与工作产物，标签页是它为你物化的视图；个人正文默认不进 AI 上下文（隐私三道闸，见 §6）。

**设计风格：现代 · 面板 · 留白**——面板化的标签工作区（活动栏 / 二级侧栏 / 标签条 / 状态栏 / 命令台），克制的留白与现代质感，不堆砌、让信息呼吸。这套 IDE 式标签工作区是 ideall 自有的设计语言：以「文件 + 标签页」为骨架，把发现、阅读、笔记、对话统一进同一个面板化外壳。

## 2. 领域模型

ideall 的领域类型分两类：**本地拥有**（存 IndexedDB，本机即权威）与**后端供给**（经 `ServerPort` 取数，ideall 用自己的领域词汇定义，见 `src/protocol/server-port.ts`）。

### 2.1 统一 Node 模型（一切皆文件）

`ideall.core` 拥有的领域内容收敛为单一可辨识联合 `Node`（`protocol/node.ts`），由 `kind` 区分六类，共存于同一个 IndexedDB 对象仓 `STORE_NODES`。音频、数据库、Agent 配置与第三方 App 等其它 Storage 不强行写入 Node 仓，而是通过各自 FileSystem 投影到同一命名空间：

| kind | 域类型（投影后） | 说明 |
| --- | --- | --- |
| `note` | `Note`（+`blockMeta?`） | 笔记；正文为 Plate 块数组，并发合并经块级 sidecar（§6 / [历史设计](design/archive/ai-native-redesign.md) §7） |
| `bookmark` | `Bookmark` | 书签；`folderId` 投影为节点 `parentId` |
| `folder` | `BookmarkFolder` | 收藏夹（书签命名空间内的目录节点） |
| `file` | `StoredFile` | 资源；轻量元数据存节点，原始 Blob 旁存独立 `STORE_BLOBS`（节点持 `blobRef`，不进同步） |
| `feed` | `Subscription` | 关注偏好；**确定性 id** `feed:type:key`，同步边界投影回旧 `"subs"` wire |
| `thread` | `Thread` | AI 对话线程；`messages` 在协议层为不透明 `unknown[]`，本地独占、默认不同步 |

所有节点共用同一套基座字段（`id`/`kind`/`parentId`/`sortKey`/`createdAt`/`updatedAt`/`deletedAt?`）与同一套**树 / LWW 同步 / 软删墓碑**原语。

**投影封在仓库边界**（关键不变量）：每个 kind 有一个 `*-store` 门面（`notes-store`/`bookmarks-store`/`files-store`/`subscriptions-store`/`threads-store`），对内读写 `STORE_NODES` 并按 `kind` 过滤/打标，对外仍暴露原有域类型（`Bookmark`/`StoredFile`/`Subscription`…）。UI、agent 与 embed 等消费方继续使用这些稳定领域类型，不直接依赖对象仓形状。`nodes-store` 是跨 kind 协调层（`listNodeSummaries`/`listNodesRaw`/`getNodeRaw` + create/update/move/delete 按 kind 分派），AI `fs.*` 层即建于其上。

### 2.2 领域类型一览

| 领域概念 | 归属 | 定义位置 | 说明 |
| --- | --- | --- | --- |
| 统一节点 `Node`（note/bookmark/folder/file/feed/thread） | 本地 core | `protocol/node.ts` | `ideall.core` 领域内容的单一可辨识联合；存 `STORE_NODES`，按 kind 投影为下列域类型 |
| 资源 `StoredFile` / 书签 `Bookmark` / 收藏夹 `BookmarkFolder` / 笔记 `Note` | 本地 | `protocol/files.ts` | 「我的」的本地优先实体（节点投影）；文件原始 Blob 旁存 `STORE_BLOBS` |
| 关注 `Subscription` | 本地（偏好）+ 后端（内容） | `protocol/subscription.ts` | 类型为 `publisher`/`entity`/`tool`/`search`/`peer`；**仅关注偏好**存为 `feed` 节点，内容实时拉取 |
| AI 对话线程 `Thread` | 本地 | `protocol/files.ts` | BYO-key AI 智能体；消息内联存于线程节点，经 `FilesPort` 读写（不再由 agent 插件自存） |
| 信息 `Info` / 事件 `InfoEvent` / 实体 `EntityDetail` / 发布者 `Publisher` | 后端 | `protocol/server-port.ts` | info 模块的资讯数据，由后端的采集/NLP/图谱产出 |
| 社区发布者 `PeerPublisher` / 发布 `Publication` | 后端 | `protocol/server-port.ts` | community 的用户发布层 |
| 同步块 `SyncBlob` | 本地派生密文 ↔ 后端不透明存储 | `protocol/sync.ts` | `{ iv, ciphertext, updated_at }`，后端只存密文 |
| 登录会话 `AuthBody` / 当前用户 `CurrentUser` | 后端（账号身份） | `protocol/server-port.ts` | 公开发布身份；与无账号同步码是两套独立身份 |

**两套独立身份**（务必区分）：

- **账号**（公开发布身份）：登录后可在 community 发布，他人关注；走后端 X25519 登录方案。
- **跨端同步码**（无账号）：高熵随机串，在浏览器派生 `storageId` + AES 密钥，只上传密文。

## 3. 模块与边界

> `home/apps/info/community/tool` 仍是业务实现与旧路由的代码边界，不直接等同于桌面导航分区。Display 从合成文件系统根生成五个固定一级入口；业务模块通过系统文件、`filesystem/resource-sources` 中的 Resource 兼容适配器或 App 文件系统被打开。

### 3.1 三种工作区与五分区导航

工作区与视图是同一个概念，由 `WorkspaceKind` 表达。用户通过全局命令面板切换工作区：桌面端可按 `⌘K` / `Ctrl+K` 或点击顶栏搜索入口，移动端由移动顶栏唤起同一面板。工作区不进入活动栏、目录树或移动导航抽屉：

| 工作区 | Display 组合 | 默认 Engine 行为 |
| --- | --- | --- |
| **文件**（默认） | 文件树、标签页、文件渲染与 AI Agent | 通用预览优先；AI 对话栏是基础能力 |
| **音频** | 文件工作区 + 保持挂载的音频播放区 | 音频文件优先使用音频 Engine，其他文件仍使用通用预览 |
| **开发** | 文件工作区 + 保持挂载的 Git / 数据库 / Shell 工具区 | 通用文本文件优先使用 Code Engine |

桌面活动栏的五个一级分区始终同时可见，选中后由二级侧栏展示分区内入口。活动栏读取 `ideall.root`，二级侧栏读取 `ideall.navigation` 的对应目录；移动抽屉消费相同数据源：

| 一级分区 | 二级入口 |
| --- | --- |
| **我的** | 关注、书签、资源、文件 |
| **活动** | 空间、任务、删除 |
| **浏览** | 新闻、社区、浏览器 |
| **应用** | 搜索、本地应用 |
| **设置** | 基本、AI |

其中“关注 / 书签 / 资源 / 删除 / 本地应用”直接链接到真实 FileSystem 目录，并由专用 Engine 复用现有管理 Display；四个活动/设置入口也已经链接到真实能力文件：

| 规范路径 | 真实 FileRef | 语义 Engine → Display |
| --- | --- | --- |
| `/activity/spaces` | `app.agent-config / config:workspaces` | `ideall.agent-spaces` → `AgentSpaces` |
| `/activity/tasks` | `app.agent-config / config:tasks` | `ideall.agent-tasks` → `AgentTaskList` |
| `/settings/basic` | `app.settings / root` | `ideall.settings` → `SettingsPage` |
| `/settings/ai` | `app.agent-config / config:settings` | `ideall.agent-settings` → `AiSettings` |

`app.settings / root` 下提供 appearance、device、data、connections、runtime-extensions 五个 JSON 快照；data section 还通过 specialized action 提供数据健康、持久化申请和工作区归档导入导出。基本设置与 Agent 配置分别由 `ideall.settings`、`ideall.agent-config` 两个随包 builtin runtime extension 原子安装 provider/mount 与成对的 Engine descriptor/Display renderer；任一贡献失败会整体回滚。路径只是符号链接位置，标签身份仍是 `FileRef + Engine`。活动栏、侧栏、移动底栏、命令面板、Home 卡片/最近动态和操作后的回流若有目录位置就直接打开规范 FileSystem path，无目录位置的能力直接打开 FileRef 或宿主命令，不再先生成 Next 路由。旧管理 panel、旧静态标签以及 `/home/settings`、`/ai` 等旧 URL 仅在打开/水合边界作为兼容别名，统一归一后不会与真实文件形成双标签。

`SettingsPage`、`AiSettings`（含 MCP、Skills、Rules）、`AgentSpaces` 与 `AgentTaskList` 的读取、写入和订阅均经 FileSystem registry，不再从 Display 直连 provider 背后的 store。普通 JSON 状态通过带版本的 CAS 文档更新；连接撤销、运行时扩展管理、工作区创建/激活、MCP 创建/连接测试与凭据管理通过 specialized action 保留各自的事务和权限语义。MCP 连接测试只传 server id，由 provider 使用未公开的本机参数并返回脱敏诊断。API key 只写入安全存储，公开文件正文与 action 结果都不会返回 secret；全局 settings UI 只能读取 `configured` 布尔状态，并用显式设置/清除 action 修改凭据。Workspace 本机可信配置器可在内存中持有 secure-backed key 以编辑密码草稿，但不会把它投影到公开文件。不含密钥内容的持久单调 credential revision 同时参与 settings section version，成功 set/clear 都推进，确保已配置状态下换钥也遵守 CAS。任务文件另提供版本绑定 cursor 的目录投影，Display 每页最多读取 64 项及其 thread metadata；当前页共享一个 collection watcher，精确变更只重取命中项。thread metadata 使用覆盖索引读取，不会把消息正文从 IndexedDB 克隆到内存；空间任务数是 provider 派生投影。任务轻索引位于与 thread node 相同数据库的独立 `agent_tasks` store，其 state 在事务内原子维护单调 revision 与全局 count；创建、挂接、更新、保存与删除的高频路径只点读 state、目标 task 和目标 thread，完整列表扫描仅保留给 list/migration/replace。数据库 v16 的非唯一 `[kind,sortKey]` 覆盖索引由统一的 Storage 尾键原语使用：默认追加 folder、bookmark、file、feed、note、普通 Thread 与 Task Thread 时，在包含 `nodes` 的 readwrite 事务中反向读取一个 kind 全局上界并 `add` 新节点，不扫描或克隆节点正文。全局上界一定晚于目标 parent 的全部 siblings，因此不改变“追加到目录末尾”的可见语义；显式插入位置仍读取 sibling 快照，但读取与写入保持同一事务。笔记和书签树的移动也在一个 `nodes` readwrite 事务内完成活跃源/目标校验、候选拓扑循环检查、跨类型同级键计算与节点写入；收藏夹保持根级，不能被通用写接口绕过为嵌套结构。删除收藏夹则把回收站快照、直属书签迁回根级和收藏夹 tombstone 放进同一个 `[nodes,trash_snapshots]` 事务，任一写入失败都会整体回滚。创建与恢复非根节点时重新校验父节点仍然活跃且类型正确，恢复目标父节点已经缺失或删除时安全降级到根级。文件的 Blob、任务索引以及关注同步批次各自与节点写入原子提交；跨窗口重叠事务由 IndexedDB 串行化，tombstone 继续保留在高水位中。旧 v15 state 缺少 count 时会惰性扫描并回填一次；旧 `ideall:agent:tasks:v1` 只作为幂等迁移输入，提交迁移 marker 后移除。窗口间只广播脱敏失效事件，各窗口通过 O(1) 索引头探针从 IndexedDB 校验真值；读取期间到达的新失效会触发尾校验，页面恢复时也会主动补查，从而收敛丢失或合并的广播。

Agent workspace 的公开 state 与内部十进制 `_revision` 位于同一份 localStorage JSON，并由一次严格 `setItem` 提交；旧文档缺少 revision 时按 `0` 读取。正文损坏但仍可独立解析的合法 revision 会保留为单调 floor，任何覆盖写均使用 `max(memory, rawFloor)+1`。64 位 revision 空间耗尽时，真实 mutation/rewrite 在任何 secure/public 写入前拒绝；纯 no-op 仍成功且不请求下一 revision。Workspace 凭据使用 `{version:2,target,apiKey,revision}` secure record，清除时写 `{target:null,apiKey:""}` 墓碑；record revision 绑定 secure-first 写入预期提交的公开 envelope revision。target 是清除 userinfo/query/fragment 后的 canonical HTTP(S) baseURL，水合只接受 target 精确匹配且 revision 不超前的记录，旧 endpoint 的 key 不会按 workspace id 回绑。若 record 超前，说明公开提交中断；当前进程与重载后的新进程都 fail closed，并在双锁内写墓碑、完成该 intended revision。旧 v1/bare secure 值也只在该锁域迁移。secure 写入会先 await，成功后才写公开 state、更新内存快照并通知订阅者；公开提交失败时尝试回滚，无法证明回滚成功则保持 fail closed，这仍不把 secure-store 与 localStorage 宣称为跨后端原子事务。runtime mutation 统一经 `agent-workspace-write-adapter` 按 `config:tasks -> config:workspaces` 获取锁，在锁内刷新耐久 workspace 后调用无锁 Raw；UI updater 基于 fresh workspace 合并字段，避免陈旧整对象覆盖另一窗口的新值。文本控件使用 workspace 绑定的 generation 草稿与串行 debounce tail，并以正文值加 source revision 识别远端 ABA；`keep` 失败项只在后续显式 flush/cleanup 重试，新输入优先。跨 await 的提示生成使用 `workspaceId + generation` token，切换、卸载或后续编辑都会使旧操作失效。模型直接选择先等待 baseURL/model/API key 草稿全部 settle，再以 selection generation 串行应用，保证最后意图胜出。API key 提交先 flush baseURL，再在锁内校验捕获的 canonical target，变化或无效时拒绝。workspace revision 与 tasks 依赖共同进入 `agent-config-v2` 语义摘要，因此公开正文相同的 ABA 和隐藏凭据变化仍会使旧 CAS 冲突。workspace 的 `stat/read/write` 将 prepare 与快照放在同一双锁临界区；provider/importer 已持锁时直接调用 Raw，不重入 runtime adapter。Local Data 对 `agent.workspaces` 的修复也通过 owner `repairMutation/applyRepair` 进入同一锁域，并经 force Raw store 推进 revision、发布失效；即使公开正文相同也能覆盖 malformed/ABA token，不能直接 patch Storage。成功提交后发布专用脱敏失效 scope，远端窗口重读耐久快照；页面 focus、pageshow 和恢复可见时也会检查 revision，补偿丢失或合并的广播。使用全局模型的 runtime 在解析前等待全局 secure settings 水合，避免 Tauri 冷启动把临时空 key 当成最终配置。

本地树结构变更遵循“校验快照就是提交快照”：笔记子树删除与单书签删除把活跃记录重读、回收站快照和 tombstone 放进同一个 `[nodes,trash_snapshots]` 事务，和 move 并发时只能形成可串行化的先后关系。笔记/书签的 `fs.write` 同时包含父节点与字段时只执行一次事务；父节点未变化会保留原 `sortKey`，失败也不会留下“位置已变但字段未写”的半完成状态。通知只在事务 complete 后发出。

回收站继承同一规则：单项恢复、purge、empty 以及文件删除都在覆盖 `nodes` / `blobs` / `trash_snapshots` 的单一事务内完成。笔记恢复以整棵当前删除子树为事务单元；回收站 FileSystem 将列表项的 `{kind,updatedAt,deletedAt}` 作为 expected revision 传入 Storage，防止旧 action 命中恢复后再删除的新墓碑。清空确认固定整个目录的语义版本，并把确认时精确的 `{id,kind,updatedAt,deletedAt}` 集合送入同一事务比较，因此不会顺带永久删除确认后才进入回收站的项目。任何 abort、revision conflict 或 no-op 都不会改变三个 store，也不发布失效通知。

同一 CAS 基线现已覆盖普通 Node mutation：FileSystem 预读得到的 `{kind,updatedAt,deletedAt}` 会继续传入各 Storage 的 readwrite 事务，关闭“外层 expectedVersion 校验通过、事务提交前却被另一窗口夹写”的窗口。Display 捕获的 `IdeallFile.version` 也会通过 `FileSystem.invoke` 的独立 options 贯穿到 Resource source，操作确认与实际提交使用同一基线。`edit/move/write-blob/restore` 返回事务实际 Node 并直接投影响应，`delete` 返回实际 changed receipt；成功后不再二次读取，避免响应混入后续写入或把已提交操作误报为 not-found。预读后的 missing、tombstone、kind 替换或版本变化统一为 conflict，不再对已删节点修改 metadata 或报告假成功。生成式菜单、Node 文件工具栏与 specialized `FileDocumentClient` 共用这一 options 通道；Audio、Database、Git、Settings 和 Agent provider 对其 versioned mutation 在 FileRef 写锁内重新读取目标版本，旧确认在任何后端副作用前返回 conflict。没有单实体版本语义的集合新增/导入以及只读探测不会伪装成 CAS。

绕过 provider 的 manifest data-port 导入同样会让已打开 Display 收敛：Database、Audio、Git 与 Agent adapter 只在 Storage 成功提交后发布 FileSystem scope 失效，失败不通知。`plugins/shared/plugin-mutation-channel` 在同一 realm 的全部 watcher 间复用一条跨窗口 transport，最后一个订阅释放时关闭；Tauri 窗口间的消息严格只有 `{sender,fileSystemId}`，接收窗口必须重新读取 Storage，不能把广播当数据或授权。Database、Audio、Git 同时接收本地与远端失效；Agent 的同窗口整包导入已经由 section store 精确通知，因此忽略通道的 local echo，只用 broadcast 补齐其它窗口。Workspace runtime 另用专用 scope：本窗口提交已由 store 精确通知，远端 source 才触发带锁 revision 重读，且刷新本身不再次广播。provider 内部 mutation 不发布整包通道，保留既有 hub/store 的单次增量通知；偶发重复 `changed` 仍按幂等失效处理。

本机内容、远端资源、系统能力与 App 挂载共享同一导航体系。音频和开发工具显示在工作区 Dock 中，关闭 Dock 会返回文件工作区。切换工作区不改变当前 `FileRef`、既有标签或脏草稿；活动项是文件时，会激活同一 `FileRef` 在新场景下的默认 Engine 标签，旧 Engine 标签保留。旧的 AI `workspace` 目录只为 FileRef、深链和持久化兼容保留，并标记为导航隐藏；AI 对话从文件工作区的右侧 Agent 面板到达，MCP、Skills 与规则从“设置 > AI”内的管理入口打开。

### 3.2 五模块（「我的」/「应用」+ 三个发现模块）

home（即「我的」）是本机数据区，apps（应用）是本机已安装应用的启动器；info / community / tool 是三个**发现**模块——它们发现的内容经**关注汇入「我的」**的 `/home/following` 关注流（旧 `/home/subscriptions` 继续作为深链别名）。

| 模块 | 路由 | 角色 | 是否需后端 |
| --- | --- | --- | --- |
| **home（「我的」）** | `/home`（笔记 / 书签 / 资源 / 关注 / 对话；工作区标签页 + places 侧栏） | 「我的」：本机数据区，本地内容工作区，统一 Node 库 + 一切皆标签页 | 否（本地优先） |
| **apps（应用）** | `/apps/local-apps`（兼容 `/apps`） | 本机已安装应用启动器：列举本机已装应用并一键启动（`src-tauri/src/installed_apps.rs` + `src/modules/apps/apps-page.tsx` + `src/lib/installed-apps.ts`） | 否（**Tauri 桌面专属**，零后端） |
| **info** | `/info`（含 search / entity / publisher / analysis） | 资讯聚合展示：信息流、实体与发布者、关联分析 | 是 |
| **community** | `/community` | 发布者地图、关注与发布（peer 发布层） | 是 |
| **tool** | `/tool`（含 search / ai / navigation） | 工具聚合（搜索 / AI / 导航） | 否（本地外链启动器，历史仅存本机） |

> info/community 的发现 UI 默认以 wonita 应用 iframe 嵌入（经 `ideall-embed-bridge` 协议可换源）；其 ServerPort 取数仍是关注流「汇入我的」的真实路径。home 的**发布（publications）**是本机数据区里的例外：发布为账号身份、依赖后端，与 home 其余本地优先数据（笔记/书签/资源/关注）不同。

> 路由分布：app 路由层只是「打开目标或执行工作区命令」的薄标记（`page.tsx` re-export `@/workspace/open-workspace-tab`），其中四条精确 legacy 路由只切换 Workspace Dock。实现各归其层——「我的」的本地数据层在 `src/files/*`、功能 UI 在 `src/modules/home/*`；info/community/tool 的实现在 `src/modules/<name>/*`，由路由薄 re-export。
>
> **浏览器**位于“浏览 > 浏览器”，打开 `browser:page:default` Resource。**AI** 的管理入口位于“设置 > AI”，打开 `app.agent-config / config:settings`；Agent 对话仍是三种工作区共享的右侧环境能力，旧 ai-* 文件和旧路由仅承载兼容输入。

**一切皆文件（工作区，`src/workspace/*`）**：打开任意内容目标都会先规范成 `FileRef`，再由 Engine registry 解析渲染器并落入统一文件标签。精确 `/audio`、`/git`、`/database`、`/shell` 是 Workspace Dock 命令而非标签目标；需要完整 App surface 时使用相应 `FileRef + Engine` 深链。目录树通过 FileSystem `readDirectory/stat/watch` 展示合成根子树；旧静态 tab、Resource tab、Node tab 只在深链解析或工作区水合边界迁移为 File + Engine，运行期不再维护第二套文件身份。专用目录 Engine 使用可读的规范路径作为标签 URL；同一根切换到其他 Engine 时回到含完整 `FileRef + engineId` 的深链，刷新不会丢失 Display 选择。异步文件打开采用按通道隔离的 last-request-wins，并在 `stat` 完成后按最新工作区解析默认 Engine，避免慢 provider 用旧场景抢回焦点。标签迁移、生命周期/LRU 策略和导航请求协调已从 store 副作用 facade 抽成纯模块。可序列化 dirty Engine 只有在有界、身份绑定的 session 快照成功后才允许被 LRU 休眠；失败时保持运行。工作区只改变 Display 组合和无显式偏好时的 Engine 默认选择，不复制文件或创建另一套导航。

### 3.3 本地能力 vs 需后端能力

- **本地能力（不依赖后端）**：home 的书签/资源/关注偏好、tool 的本地功能和 BYO-key agent。数据存本机，可离线、无账号使用。跨端同步无需账号且只传密文，但同步动作需要可用的 Sync 服务；当前同步关注、笔记、书签与收藏夹。
- **需后端能力**：info 的资讯/实体/分析、community 的发布者地图与发布、关注流的内容拉取、账号鉴权。全部经 `ServerPort` 消费。

### 3.4 抽象层：终端分层（`src/` 下）

`src/` 已按「个人信息终端」的语义分层重组——路由层只负责打开目标或执行工作区命令，外壳、工作区、数据层、功能模块、插件、契约各成一层，契约纯端口独立成 `protocol`。

| 层 | 别名 | 内容 |
| --- | --- | --- |
| **app** | `@/app/*` | Next 路由层——仅分发打开目标或工作区命令的薄标记：`page.tsx` 几乎全是 re-export `@/workspace/open-workspace-tab`（唯一例外 `app/auth/page.tsx`：独立登录页，直接渲染 `@/shell/auth-form`），外加根 `layout`/`error`/`loading`/`not-found` + `globals.css`（`@/app/globals.css`）。 |
| **shell** | `@/shell/*` | 终端外壳——命令台 / header / bottom-tab-bar / 主题（theme/theme-applier）/ account / mobile-nav / nav-config，加 `boot`（组合根，**唯一**允许 import 各 manifest 处）/ `boot-gate`（启动闸）/ `runtime-extensions`（宿主 verify/consent、严格 receipt 恢复、一次性 activation permit、原子安装、撤销与 quarantine 生命周期）。 |
| **workspace** | `@/workspace/*` | Display 编排——`workspace-shell` / `workspace-dock` 组合三种工作区，全局命令面板调用 store 切换工作区；活动栏、二级侧栏与移动抽屉读取同一导航 FileSystem；`tab-host` 保持挂载多标签并只休眠已有安全快照的 dirty Engine，`registry` 与 `file-engine-renderer` 渲染 File + Engine，`tree/file-system-sidebar-tree` 展示目录；`store` 是状态/副作用 facade。 |
| **filesystem** | `@/filesystem/*` | 多实例文件系统 registry、隐藏合成根、只读 `ideall.navigation` 路径命名空间、动态 App 挂载，以及 `resource-file-system` 对 `resource-sources/` 中 Node/连接数据 Resource source/provider 的 `ideall.core` 兼容投影。统一 `stat/statMany/readDirectory/read/readMany/write/actions/watch`；`path.ts` 逐级解析目录项且最终仍返回 target `FileRef`。批量 metadata/正文读取按 provider 分组并有限并发回退，provider generation 变化会拒绝迟到结果。 |
| **engines** | `@/engines/*` | 纯引擎描述、匹配/默认解析、按工作区隔离的单文件与 media type 偏好；具体 React renderer 仍由 workspace Display 注册。 |
| **files** | `@/files/*` | 一切皆文件——统一 Node 数据层。`stores/`（各 kind store + `nodes-store` 跨 kind 协调层）；顶层 Node 原语：`note-blocks` / `sort-key` / `notes-tree-util` / `note-write-queue` / `flowback` / `feed-node`（关注↔feed 节点投影）/ `files-port`（经 FileSystem registry 的兼容领域外观）/ `storage-sync-port`（仅同步可用的 tombstone + 原子 bulk 适配器）/ `bookmark-import`。 |
| **modules** | `@/modules/*` | 功能模块——`home`（「我的」：本机笔记/书签/资源/关注/对话的功能 UI = overview/notes/bookmarks/resources/publications/subscriptions）/ `info` / `community` / `tool` / `apps`（本机已安装应用启动器，Tauri 桌面专属）。 |
| **plugins** | `@/plugins/*` | 插件——`agent`（AI 环境层，BYO-key）/ `sync`（跨端 E2E 同步）/ `embed`（嵌入页 + AI 共用的 Grant→`createLocalMcpServer` 能力链路）/ `code` / `git` / `shell` / `audio` / `database`；公共插件数据能力在 `plugins/shared`。 |
| **protocol** | `@protocol/*` | 契约 / 端口（纯类型 / 纯函数，**不含 UI**）：新增 `file-system`（FileRef/IdeallFile/DirectoryEntry）与 `engine`，并保留 node/files/sync/server-port 等领域契约。 |
| **ui** | `@/ui/*` | shadcn 原语 + 块编辑器（`editor/`）。 |
| **shared** | `@/shared/*` | 跨层共享 UI；`feeders/` 仅保留工具固定按钮 `PinToolButton` 与统一回流提示 `flowbackToast`。 |
| **lib** | `@/lib/*` | 纯工具——utils / format / idb / id / sync-crypto / auth / api（wire DTO 生成物）/ server（HTTP 适配器）/ ui-actions / active-node / safe-url / theme / env / tauri / updater / installed-apps（本机应用 Tauri 命令封装）/ egress-guard（agent 出站 SSRF 守卫）/ acp-transport（ACP 传输桥）… |

> 别名：`@/*` → `src/*`；`@protocol/*` → `src/protocol/*`（其余层一律 `@/<layer>/...`；app 路由用 `@/app/*`、`@/app/globals.css`）。

`src/vfs` 已退休。`ResourceSourceProvider` 现在只是 `src/filesystem/resource-sources` 内部、由 `resource-file-system` 转换为统一 FileSystem 的兼容来源接口；旧 Resource/Node 标签不构成运行时并行模型。

**端口模式**：每个跨模块契约都是「端口 + register/get」。模块经 protocol 间接协作——逻辑与数据交互须经 protocol 端口，模块间不直连业务逻辑；视图挂载是显式例外：workspace/registry 与 viewers 会经白名单注册直接挂载 plugin 视图（EmbedHost、AgentPanel、thread-viewer 等）。

- **内容 feed**：关注流调 `@protocol/content` 的 `resolveSubscription`；info/community 在各自 `manifest.ts` 注册 resolver（info 管 publisher/entity/search，community 管 peer）。
- **「我的」数据**：反馈组件、agent 插件与 AI `fs.*` 层经 `@protocol/files` 的 `getFilesPort()` 使用兼容领域 DTO；该端口的普通 CRUD 全部经 FileSystem registry 分派，不直接依赖底层 store。FilesPort 提供节点级 `fsListNodes/fsGetNode/fsCreateNode/fsUpdateNode/fsMoveNode/fsDeleteNode/fsReadBlob` + 线程方法。
- **跨端同步**：同步面板调 `@protocol/sync` 的 `getSyncPort()`；sync 插件 manifest 注册 SyncPort。合并器需要包含墓碑的全量快照与跨记录原子写时，单独经 `@protocol/storage-sync` 的窄 `StorageSyncPort`，该端口以完整逻辑快照 CAS 落地并返回 Storage 规范化后的实际提交快照，不向普通插件暴露。
- **后端取数**：所有信息/发布/鉴权取数经 `@protocol/server-port` 的 `getServerPort()`（ServerPort）。
- **UI 动作 / 活动节点**（守 plugins↛shell/workspace 边界）：插件经 `@/lib/ui-actions`（`UiActions`：开/关标签）与 `@/lib/active-node`（当前激活标签→`NodeRef`）两个端口与工作区交互，外壳在 boot 注入实现、插件只消费。

### 3.5 AI `fs.*` 层（一切皆文件的 AI 侧）

AI 不再持专有工具，而是经一套**文件系统语义**的 MCP 工具面 `fs.*`/`ui.*` 读写统一 Node 库——与嵌入页（embed）共用同一条 **Grant→MCP** 能力链路（`src/plugins/embed/*`）：

- **能力链路**：`createLocalMcpServer(grant, ctx)` 据 `grant.permissions` 注册工具；权限位 `fs:read`/`fs:write`/`fs.notes:read`/`fs.notes:write`/`fs.blobs:read`/`agent.config:read`/`ui.tabs`/`web:search`/`web:fetch`（定义于 `src/plugins/embed/protocol.ts` 的 `PERMISSIONS`）。工具：`fs.list`/`fs.read`/`fs.readBlob`/`fs.create`/`fs.write`/`fs.move`/`fs.delete` + agent-only `agent.config.read` + `ui.openTab`/`ui.closeTab` + `web.search`/`web.fetch`（出站联网面），资源 `fs://nodes`。配置 tool 还要求 loopback 宿主注入 FileSystem adapter，普通 embed 即使携带伪造 permission 也不会注册。**web 出站**统一经 `@/lib/web-search` 的 `guardedFetch`，再经 `src/lib/egress-guard.ts` 的 SSRF/出站守卫（仅 https、拒私网/userinfo/伪协议、IP 字面量拦截；红队向量由 `egress-guard.test.ts` 锁死）。
- **agent→MCP 回环**：agent 插件经 `agentGrant`（`fs:read`/`fs:write`/`fs.notes:write`/`ui.tabs`/`web:search`/`web:fetch`，**默认无 `fs.notes:read` / `fs.blobs:read` / `agent.config:read`**——既存正文、上传文件二进制和 Agent 配置正文默认不可见）→ `createLocalMcpServer` → `createLoopbackTransports`（本进程 MessageChannel + 复用的 `MessagePortTransport`）→ `agent-mcp.ts`（`connectAgentMcp`：tools/list→OpenAI 工具、callTool、`summarizeTool` 中文回执）。`agent.config:read` 只允许 first-party 工作区显式开启；普通 `fs:read` 对配置文件只返回 metadata。即 agent 与嵌入第三方走同一套受限工具面，无特权旁路。
- **对话即文件**：当前激活标签经 `active-node` 端口注入为隐式上下文（`gatherReferencedContext`），宿主对激活 note/thread 的全量读 = 用户隐式同意，授权集不变。
- **隐私三道闸**：见 §6 第 9 条。

**ServerPort ↔ HTTP 适配器**：ServerPort 是 ideall 自有领域类型定义的端口（`src/protocol/server-port.ts`），**不依赖** wonita 服务的 wire DTO。默认实现是 `lib/server/http-adapter`（对接 wonita 服务的 HTTP API），是**唯一** import openapi 生成类型（`@/lib/api/server`）的地方——wire→domain 的映射与漂移门收敛于此。ServerPort 是**同构端口**（SSR 预渲染期也取数），故 `getServerPort()` 默认回退该 HTTP 适配器；App / 嵌入式 / 局域网节点 / 测试可经 `registerServerPort()` 覆盖——**这是后端可换 / 可自建的技术支点**。

**组合根**：`shell/boot.ts#registerAll()` 是唯一允许 import 各 manifest 的地方，由客户端启动闸 `boot-gate.tsx`（挂在根 layout）调用一次，幂等注册全部端口实现。

### 3.6 外部 agent（ACP）与外部 MCP / OAuth 子系统

除“BYO-key → OpenAI 兼容端点”和内部 loopback MCP（§3.5）外，agent 还包含 ACP 与外部 MCP 互操作子系统。ACP 当前完整接通的是“把 ideall 暴露给编辑器”的 agent 方向；反向把外部 CLI agent 作为对话后端仍只有探测、配置与纯消息折叠基础，尚未接入对话执行链路。

- **ACP 双向**（Agent Client Protocol，实现收于 `src/plugins/agent/lib/acp/`）：
  - **反向驱动外部 CLI agent（未接线）**：`acp-detect.ts` 可在 PATH 中探测并保存外部 agent 命令配置，`acp-chat.ts` 提供通知折叠纯函数；当前没有 ACP client 会话实现，设置项尚不会把聊天回合发送给外部 CLI agent。
  - **把 ideall 经 ACP 暴露给编辑器**：`acp-expose.ts`（把内核 `runAgent` 接成 ACP 智能体；headless，仅用 home 标题快照，不注入"当前查看节点"）；`shell/boot.ts` 在桌面 + 用户开启 `allowEditorConnect` 时**自启动监听**（`autostartAcpServerFromSettings`）。
  - **传输**：JS 侧 `src/lib/acp-transport.ts` ↔ Rust 侧 `src-tauri/src/acp_transport.rs`（TCP / 哑管道）；状态与设置见 `acp-status.ts` / `acp-settings.ts`（`AcpRunContext` 类型定义在 `acp-expose.ts`）。
- **外部 MCP**（`agent-mcp.ts` / `agent-mcp-registry.ts` / `agent-mcp-stdio.ts`）：除本进程 loopback MCP 外，还支持 `stdio`（本地命令）/ `SSE` / `Streamable-HTTP` 三种外部传输接外部 MCP server（`McpTransport`）。
- **OAuth 回调**：外部 MCP / agent 的 OAuth 授权码经本机 loopback 回调（`src-tauri/src/oauth_callback.rs`）落地，token 经 `agent-oauth` 持久化（仅存本机）。

> 经 ACP 连入 ideall 的编辑器与外部 MCP 都不会获得绕过 `fs.*`/`ui.*`/`web.*` 边界的特权。反向外部 CLI agent 尚未接线，不能视为现有聊天后端。这些外部子系统多为 Tauri 桌面能力，纯浏览器 dev 态降级或不可用。

## 4. 数据流

```
                          ┌─────────────────────────────────────────────┐
                          │            ideall App (Tauri webview)         │
                          │                                               │
   本地优先 (零后端)  ┌───┤  home/tool ─► FilesPort ─► FileSystem registry │
   ───────────────   │   │                  └─► ideall.core ─► IndexedDB  │
                     │   │   统一 Node 库 STORE_NODES + Blob 旁存 STORE_BLOBS│
                     │   │   (note/bookmark/folder/file/feed/thread, 明文不上传)│
                     │   │                                               │
                     │   │  agent (BYO key) ─fs.*/ui.* MCP→ Node 库       │
                     │   │     │ Grant→createLocalMcpServer→loopback      │
   BYO-key agent ────┘   │     ▼                                          │
                         │  agent ──► OpenAI 兼容端点 (key 仅存本地)       │
                         │     └─ App: tauri-plugin-http (Rust 侧) 绕 CORS │
                         │        web: 标准 fetch (受厂商 CORS 限制)       │
                         │                                               │
   需后端 (经契约) ──────┤  info/community ──► getServerPort()            │
                         │        │ 默认 HTTP 适配器 (唯一 import wire DTO) │
                         │        ▼                                       │
                         │   registerServerPort() 可覆盖 ◄─ 可换后端支点  │
                         │                                               │
   E2E 同步 (无账号) ────┤  sync 面板 ──► SyncPort ──► sync-crypto         │
                         │     同步码 ─派生→ storageId + AES 密钥          │
                         │     仅上传密文 SyncBlob {iv, ciphertext}        │
                         └───────────────┬───────────────────────────────┘
                                         │ HTTPS (NEXT_PUBLIC_SERVER_ADDR)
                                         ▼
                          ┌──────────────────────────────────────┐
                          │  ServerPort 实现 (默认 wonita 服务)    │
                          │  采集/NLP/知识图谱/鉴权/同步块存储      │
                          │  仅存同步密文 (读不到明文)             │
                          └──────────────────────────────────────┘
```

四条数据流：

1. **本地 IndexedDB（统一 Node 库）**：home/tool 的普通领域操作即使保留 FilesPort DTO，也先进入 FileSystem registry，再由 `ideall.core` provider 读写**单一对象仓 `STORE_NODES`**（六类 kind 节点）+ 旁存 `STORE_BLOBS`（`{key,blob}`，文件原始字节，不进同步）。跨多仓的原子写与墓碑同步由窄 `StorageSyncPort`/provider 存储层维持；`onupgradeneeded` 只声明仓与索引 schema，不执行应用层读写或数据迁移。明文不上传。
2. **经 ServerPort 直连后端**：info/community 经 `getServerPort()` 取资讯/发布/鉴权数据；客户端直连后端 API（`NEXT_PUBLIC_SERVER_ADDR`），需后端放行 CORS。
3. **E2E 同步只传密文**：同步码在浏览器派生 `storageId` + AES 密钥，本地 AES-GCM 加密后上传 `SyncBlob`，后端不透明存储、读不到内容。当前有三个独立 scope：关注（`subs`）按 LWW 并集合并；**笔记（`notes`）走块级合并**——整篇删除走 node 级 LWW，正文走块级 `mergeNoteContent`；书签与收藏夹（`bookmarks`）作为一个 Node 快照按 LWW 合并，保证父子结构在同一 CAS 事务落地。三个 scope 都使用软删墓碑、90 天 GC、独立 storageId/密钥和远端 409 有界重试。每次本地落地都 fresh 读取完整逻辑快照并执行 CAS，真实本地冲突不 PUT。文件 Blob 和对话仍不在同步范围内；`feed` 节点在同步边界投影回旧 `"subs"` wire，关注同步协议保持不变。
4. **BYO-key agent 经 fs.* MCP 读写 + Tauri 绕 CORS**：agent 经 `agentGrant`→`createLocalMcpServer`→loopback MCP 客户端（`agent-mcp.ts`）以 `fs.*`/`ui.*`/`web.*` 工具读写 Node 库 / 联网（与嵌入第三方同一受限工具面；web 出站经 `egress-guard` SSRF 守卫），再直连用户配置的 OpenAI 兼容端点。API key 只进入本机安全存储，公开配置正文和 action 结果不返回 secret；全局 settings UI 只读取 `configured`，Workspace 本机可信配置器只在内存中编辑 secure-backed 草稿。在 App（Tauri）内经 `tauri-plugin-http`（Rust 侧请求）绕过 webview CORS，可直连任意云厂商端点；纯浏览器调试时用标准 fetch，受厂商 CORS 限制（本地 Ollama / 放行 CORS 的端点可用）。**OpenAI 兼容端点只是当前已接通的后端之一**：agent 可把 ideall 经 ACP 暴露给编辑器，并可连接 stdio/SSE/Streamable-HTTP 外部 MCP；反向驱动外部 CLI agent 尚未接入对话执行链路（见 §3.6）。

## 5. 技术选型与权衡

| 选型 | 取舍 |
| --- | --- |
| **Next.js 静态导出（`output: export`）** | 生产构建一律静态导出到 `out/`，无 Node 运行时、无 SSR 生产服务端。`pnpm dev` 的 SSR 仅作开发服（供 Tauri 壳加载）。 |
| **Tauri 2.0 打包** | Rust 外壳包裹 Web 前端，单代码库覆盖 Windows/Linux/macOS 桌面 + iOS/Android 移动。`tauri-plugin-http` 让 App 内 agent 绕 CORS。 |
| **App-only、无 SSR 生产端** | iOS/Android 与离线桌面 App 不能跑 Node 服务器，故采用静态导出 + 客户端经 ServerPort 直连后端（CORS + JWT）。代价：路由不可用 Server Actions / Route Handlers / 请求时 `headers()` / 动态路径段——动态信息一律客户端取数，动态路由改查询参数（如 `/info/entity?label=&name=`）。 |
| **端口 + 组合根的依赖反转** | 模块互不直连，全部经 protocol 端口；新增 app/plugin 只需建 manifest 并在 boot 注册。代价：多一层间接。 |
| **wire DTO 与领域类型分离** | openapi 生成类型仅 HTTP 适配器可见，业务/protocol 用 ServerPort 领域类型。换后端只需换适配器，业务代码零改动。 |

## 6. 关键不变量与约束

这些不变量是产品主张的技术兑现，违反即破坏定位：

1. **后端可换 / 可自建**：业务代码只依赖 `ServerPort` 领域类型，绝不直连某个具体后端。`registerServerPort()` 是替换点。
2. **本地数据不自动整库上传**：home/tool 数据以 IndexedDB 为本机权威；主动同步、发布、模型对话、外部 MCP 与 web 工具各有独立出站边界，必须遵守[数据出站矩阵](../.github/SECURITY.md#数据出站矩阵)。同步只上传密文，服务端读不到明文。
3. **协议纯度**（ESLint 强制）：`protocol/` 只可依赖 `@/lib` 纯工具，**不得** import UI 或页面代码。
4. **wire DTO 边界**（ESLint 强制）：openapi 生成类型（`@/lib/api/server`）**仅** HTTP 适配器（`lib/server`）可 import；protocol 与业务代码一律用 ServerPort 领域类型。
5. **依赖方向**（惯例 + 部分 ESLint 强制）：app 路由层不可被反向 import；info/community/tool 三应用互不 import；跨模块交互一律经 `@protocol`。插件需触达工作区时只经 `ui-actions`/`active-node` 端口（外壳注入），不反向 import 外壳 / 工作区。
6. **两套身份隔离**：账号（公开发布）与无账号同步码互不耦合。
7. **本地核心离线可用**：home/tool/agent 不依赖后端可用性，必须始终能离线工作；跨端同步是可选网络能力，依赖可用的 Sync 服务，但无需账号且服务端只见密文。
8. **core Node 库的投影封边界**（一切皆文件）：`ideall.core` 领域内容存入单一 `STORE_NODES`，节点↔域类型投影只在 provider/storage 侧发生；其它 Storage 保留自己的物理语义并经 FileSystem 挂载。普通消费方经 FileSystem 或其 FilesPort 兼容外观访问，不能直接 import store。含墓碑快照与原子 bulk 的例外只向 sync 暴露为 `StorageSyncPort`。`onupgradeneeded` 只声明仓与索引 schema，**绝不执行应用层读写或迁移**。
9. **AI 隐私三道闸**（个人正文默认不进 AI 上下文）：(a) 自动注入上下文只取**标题**（`gatherHomeContext`/snapshot title-only）；(b) `fs.list` 一律经纯 `stripNode` 剥除 note 正文与 thread 会话；(c) `fs.read`/资源点 note/thread 须二次持有 `fs.notes:read`，否则返 `consent-required (-32003)`。agent 授权集（`agentGrant`）**不含 `fs.notes:read`**——正文仅在用户打开的活动标签（隐式同意）经 `gatherReferencedContext` 注入；写工具的回执经 `sanitize` 剥正文（防 write-only 消费方回读）。入站远端笔记经 `isValidRemoteNote` 校验（拒 null content 元素 / 脏 blockMeta，防一条投毒项瘫痪全端同步）。
10. **笔记块级合并的零丢数据**（不上 Yjs）：`mergeNoteContent` 为纯 join——交换/结合/幂等、不丢任何块 id、过期墓碑也不丢（GC 是独立一步）。块 id 确定性生成（两端独立迁移同一笔记得同 id）。**取舍**：`updateNote` 以「存量」而非编辑器 mount-base 为 diff base，故纯本地「AI+用户同笔记并发」未完全防夹击；跨端多设备（主场景）由 notes-sync 块级合并完整保障。两边都缺 `blockMeta`（旧端/旧记录）时回退整篇 LWW 兜底，绝不重建出空正文。

## 7. 部署 / 分发形态

ideall 仅以 App 形态分发（Tauri 工程在 `src-tauri/`）：构建期 `next build`（`output: export` → `out/`），再由 Tauri 打包。下表是工程目标矩阵，不等同于当前自动发布范围。

| 平台 | Tauri 目标 | 目标产物 | 当前自动化 |
| --- | --- | --- | --- |
| Linux | desktop | `.deb` / `.rpm` / `.AppImage` | CI 自动构建并进入 GitHub Release（x64） |
| Windows | desktop | `.msi` / `.exe`（NSIS） | CI 自动构建并进入 GitHub Release（x64） |
| macOS | desktop | `.dmg` / `.app` | CI 自动构建并进入 GitHub Release（arm64 / x64） |
| Android | mobile | `.apk` / `.aab` | tag / 手动任务仅生成 debug APK workflow artifact；release 签名与商店发布未接入 |
| iOS | mobile | `.ipa` | 需 macOS、Apple 证书与描述文件；未纳入 CI 或商店发布流程 |

当前桌面发布走 GitHub Releases（含 `tauri-plugin-updater` 自动更新）；移动端仍是目标覆盖，尚无 App Store / Google Play 发布流水线。完整方案、CI、签名与路线图见 [app.md](app.md)。

## 8. 文档导航

- [文档索引](README.md) — 全部文档按现行规范、操作手册、决策记录与历史归档分类。
- [README.md](../README.md) — 产品定位、模块表、快速开始、连接后端、App 打包、API 类型同步。
- [design/archive/ai-native-redesign.md](design/archive/ai-native-redesign.md) — 已落地的 AI 原生重设计历史稿：统一 Node 模型、四步折叠、墓碑、一切皆标签页 UI、`fs.*` AI 层与隐私三道闸、笔记块级合并的完整推导与雷区清单（本文 §2/§3.5/§6 已吸收落地结果）。
- [design/archive/resource-vfs-refactor.md](design/archive/resource-vfs-refactor.md) — 已落地的 Resource/VFS 重构历史稿：ResourceRef、Provider、OpenTarget、Engine、权限隐私与迁移兼容策略。
- [app.md](app.md) — App（桌面/移动）方案、平台矩阵、CI、签名与分阶段路线图。
- [scripts.md](scripts.md) — 本地验证、冒烟、API codegen、发布与脚本维护入口。
- [development.md](development.md) — 仓库结构与开发约定（贡献者必读）。
- [../.github/SECURITY.md](../.github/SECURITY.md) — 安全策略与漏洞报告（含同步加密关注点）。
