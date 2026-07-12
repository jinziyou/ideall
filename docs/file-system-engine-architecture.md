# 文件系统与引擎架构

本文记录 ideall 五层模型当前的实现约定：

```text
Storage -> FileSystem -> IdeallFile -> Engine -> Display
```

## 身份与挂载

- Storage 是物理来源和 provenance，包括本地 Node/Blob、插件 IndexedDB、ServerPort、本机 App 与第三方数据。来源保留自己的事务、同步和权限语义，不强行实现一套通用 CRUD。
- 一个 `FileSystemProvider` 对应一个可独立挂载的文件系统实例。registry 按 `fileSystemId` 分派，允许注册多个同类来源。
- `FileRef { fileSystemId, fileId }` 是文件身份；名称、路径和父目录不参与身份。`DirectoryEntry` 独立引用 `FileRef`，同一文件可出现在多个目录中；删除 link 或 mount 不等于删除源文件。
- `ideall.root` 是隐藏的合成根。它以“我的 / 活动 / 浏览 / 应用 / 设置”五个核心目录作为固定导航根，并接纳运行期 manifest 挂载；动态来源不会改变一级分区集合。
- `mountFileSystem()` 原子注册 provider 并向合成根贡献 mount；失败时回滚，卸载时只注销 provider 和目录项，不删除来源数据。运行时扩展可把多个 mount 与成对的 Engine descriptor/renderer 放在同一批次安装，任一贡献失败都会逆序回滚，观察者只在最终状态确定后刷新。
- `ideall.core` 的 Resource 兼容投影由 `src/filesystem/resource-file-system.ts` 实现；Node 与连接数据的 `ResourceSourceProvider` 收口在 `src/filesystem/resource-sources/`，只作为该 FileSystem provider 的内部来源接口。现行代码不再有 `src/vfs` 并行挂载层。

## 文件系统访问契约

- `IdeallFile.kind` 只表达 `file | directory`；业务含义由开放的 `mediaType`、`properties` 和 `capabilities` 表达。metadata 与目录项不得携带需要额外授权的正文或二进制。
- provider 统一暴露 `stat/readDirectory/read/write/actions/invoke`，并可选实现 `readMany/watch`。`readMany` 的结果必须与输入 `FileRef` 一一对应且保持顺序：只有不存在用 `null` 表达，授权、consent、离线等错误继续抛出；registry 按 provider 分组，缺少原生 batch 时使用默认 4、最大 32 的有限并发 fallback。`readDirectory({ recursive:true })` 是可选的扁平后代投影，目录项仍保留稳定目标 `FileRef`，供兼容批量读取避免逐目录全表扫描；不支持的 provider 应明确返回 `unsupported`。创建文件和来源特有的变更通过目录上的显式 action 表达。
- `DirectoryEntry.file` 可携带目录查询已经取得的安全 metadata snapshot，且 snapshot 的 `ref` 必须等于 `target`；它不能包含需要额外授权的正文。兼容 `FilesPort` 用 async iterator 按 cursor/limit 逐页消费目录，每页优先调用 `readMany`，fallback 也受并发上限约束；`listNoteChildren(parentId)` 直接查询对应目录，不再为一个父节点读取全部笔记。重复 cursor 被视为 provider 不可用错误，不能静默返回不完整结果。
- `FileAction.kind` 是 `display | invoke | specialized` 判别联合。`invoke` 可声明可序列化的 input/output JSON-Schema 子集、字段 UI hint、`risk` 与 `idempotent`；Display 据此生成文本、数字、布尔、枚举、JSON 和文件输入。`display` 只用于导航，`specialized` 留给 OAuth、多步事务等场景 UI。高风险动作必须确认，确认目标会固定 `FileRef + version`，文件切换或版本变化后拒绝调用，provider 仍是最终授权与输入校验者。
- `stat` 用 `null` 统一表达不存在，其他读取仍返回 `not-found`。`read.range` 是以字节计数的 end-exclusive 区间；不能进行字节寻址的结构化来源必须返回 `unsupported`，不能静默按字符切片。
- `FileSystemAccessContext` 由 `actor`、`permissions` 以及可选的 `activeFile`、`intent` 组成。provider 根据调用者、权限、意图和精确文件引用执行授权，不从 workspace 全局状态推断权限。
- `actor` 包括 `ui | agent | embed | engine | system`。引擎授权仅作用于与 `activeFile` 完全相同的 `FileRef`；`system` 不会被隐式提升成 UI 权限。
- 文件 capability 描述 provider 可提供的操作，但不是授权票据。`read-only` 等 Engine access 只约束 Display 交互形态，最终读写权限仍由 provider 和访问上下文判定。
- 带 `expectedVersion` 的本地写入把“读取当前版本、校验、写入和写后 stat”放在同一文件临界区。Web 端优先使用以 FileRef 哈希命名的 Web Locks，并回退进程内 keyed mutex；原生 guarded FS 使用 grant + entry identity 的 mutex。存储更新时间即使处于同一毫秒也严格递增。

## Engine 与 Display

- Engine descriptor 只声明匹配条件、优先级、布局、access 和是否支持独立窗口，不直接引用 React 组件。
- Display 通过动态 `FileEngineRendererRegistry` 按 `engineId` 注册渲染回调。`registerFileEngineContribution()` 会原子注册 descriptor 与 renderer，拒绝重复或半注册；workspace 订阅 registry revision，因此运行期注册和卸载会立即反映到视图。
- shell 启动时由 composition root 注册内置 renderer。未注册 renderer 的 Engine 显示受控的不支持状态，不在 workspace 中维护静态 renderer switch。
- 默认 Engine 解析顺序为：当前工作区的单文件偏好、当前工作区的 media type 偏好、工作区默认策略、候选 Engine 的 priority/specificity、通用预览兜底。旧的全局偏好键作为文件工作区偏好继续使用，音频与开发工作区使用独立键。
- 标签身份是 `FileRef + engineId`。Engine 菜单可将同一文件以其他匹配 Engine 在当前工作区打开，因此音频、开发、数据库或通用预览可以同时存在为不同标签。
- 文件视图首次通过 `stat` 取元数据，并在 provider 支持时订阅 `watch` 后重新 `stat`。FileSystem registry 拥有底层 watcher 生命周期：同一 provider/目标/上下文的订阅共享一条底层 watch，最后一个观察者离开或 provider 被替换、注销、清空时自动 best-effort 释放；回调绑定 provider generation，旧实例的迟到事件会被丢弃。`FileSystemWatchEventHub` 已用于音频和数据库 provider：它把增量事件路由到目标及 old/new parent，并按批次合并同一目录项的变化；同一 `FileRef` 的多个 link 仍以 parent-scoped `entryId` 区分。目录 Display 对完整加载且身份明确的 `changed` 只重取单项 metadata、对 `deleted` 本地移除；created/move、自身事件、分页、异常信封或竞态失败统一回退全量读取。无 `watch` 的 provider 使用重新进入或显式刷新。
- 旧静态 tab、Resource tab 与 Node tab 只在深链解析和 workspace hydration 边界迁移成 File + Engine；导航分区与工作区切换只处理规范化后的 descriptor。`TabContent` 只接受 File + Engine 标签，旧 descriptor 不再有第二套直接渲染分支。
- 通用开发 Display 保留脏草稿和外部版本冲突。只有声明 `suspension: "serializable"` 且已成功写入身份绑定休眠快照的 dirty Engine 才可被 LRU 卸载；快照仅存当前窗口 `sessionStorage`，限制单份 1 MiB、合计 4 MiB、最多 24 份，并按 `tabId + engineId + fileKey` 严格恢复。序列化失败、超限或不支持休眠的 dirty Engine 继续保持挂载；关闭标签和离开页面仍使用全局 dirty 告警。`read-only` Engine 会同时禁用正文写入及 Node 工具栏中的重命名、标签和删除操作。

## 工作区与固定导航分区

- 工作区与视图是同一个 Display 概念，由 `WorkspaceKind = files | audio | development` 表达。工作区切换位于顶栏，不生成活动栏、目录树或移动导航项。
- 文件工作区是默认基础视图，包含文件树、标签页、文件渲染和 AI Agent。音频工作区在其上增加保持挂载的音频播放区；开发工作区在其上增加保持挂载的 Git / Shell 工具区。音频播放区与音频 File Engine 共用 shell 级播放控制器和唯一媒体元素，切换文件或工作区不会产生并行播放器。
- 工作区切换只改变 Display 组合和无显式偏好时的 Engine 选择，不改变当前 `FileRef`、既有标签、脏草稿、根目录或文件系统挂载。若活动标签是文件，Display 会为同一 `FileRef` 激活新场景的默认 Engine 标签；旧 Engine 标签继续保留。隐藏工具区保持挂载，避免切换后中断播放或 Shell 会话。
- 音频工作区对 `audio/*` 文件默认使用音频 Engine；开发工作区对通用文本文件默认使用 Code Engine；文件工作区使用通用预览。用户设置的单文件或 media type 偏好优先于这些默认策略。
- 活动栏一级分区固定为：**我的**、**活动**、**浏览**、**应用**、**设置**。对应的二级侧栏分别为：“关注 / 书签 / 资源 / 文件”、“空间 / 任务 / 删除”、“新闻 / 社区 / 浏览器”、“搜索 / 本地应用”、“基本 / AI”。五个一级入口始终同时可见；本地与联网资源共享同一合成根、FileSystem 身份和 Engine 偏好。
- `ideall.core` 内部的 AI `workspace` 目录继续承载兼容 FileRef 和旧快照，但设置 `navigationHidden`，不出现在左侧导航。AI 对话从所有工作区共享的右侧 Agent 面板到达；MCP、Skills 和规则从“设置 > AI”内打开。

## 启动与独立窗口

- 根目录本身不作为内容页显示；桌面活动栏和移动导航订阅同一个完整合成根，并呈现相同的五个固定分区。二级侧栏使用稳定 `FileRef` 打开对应目标；provider 挂载变化不改变已打开标签的文件身份。
- 文件深链使用 `?file=<FileRefKey>&engine=<engineId>`；旧 `?resource=`、`?node=` 和静态路由保留为兼容入口。
- 主窗口优先恢复 workspace 快照，包括当前导航分区、工作区、开发工具选择和标签。旧快照缺少工作区字段时回退文件工作区。没有可恢复标签时读取 `ideall:startup-target:v1`，无效时回退“我的”。
- 独立窗口入口要求文件显式声明 `standalone-window` capability，同时 Engine descriptor 声明 `supportsStandaloneWindow`。程序化打开会重新 `stat`，独立窗口渲染入口也重复执行同一策略，不能用伪造 metadata 或 `display=window` 深链绕过。当前 `ideall.core` 的 Node 文件、音轨和数据库表可选择支持；远端文件、本机 App 和 Git 文件不会因此自动获得独立窗口权限。
- 独立窗口使用 `file/engine/display=window` 内部深链，不恢复主 workspace。原生窗口创建命令仅授权 `main` 调用，URL 与 label 在 TypeScript 和 Rust 两侧校验；生成的 `engine-*` 窗口不继承主窗口的 secure-store、HTTP、Shell 或 guarded FS IPC capability。

## 当前文件系统

- `ideall.root`：隐藏的 `CompositeRootFileSystem`，合并核心目录与运行期 mount，并发送 mount 变化事件。
- `ideall.core`：`resource-file-system` 将 Node/Blob、仍属于 core 的系统 panel/place 和 `resource-sources` 中的连接数据来源投影为 FileSystem，并在深链/水合边界兼容旧 route/resource。Git、数据库和音频不再创建 core panel 代理文件；旧 `panel:git|database|audio` 深链与持久标签只在打开/水合边界迁移到对应 App FileSystem root。笔记、书签与文件通过对应目录的 `create` action 创建，后续读写、移动、删除与恢复均经 FileSystem；Node 同步、墓碑、Blob 旁存、正文 consent、乐观并发和 `save-to-mine` 语义仍由 Resource source 与底层 Node 存储的权限闸处理。UI 与活动 Engine 可读取完整 Blob，agent 读取仍受 1 MiB 上限约束。
- `ideall.trash`：把底层墓碑投影为回收站目录，通过显式 `restore`、`purge` 和 `empty` action 提供恢复与永久删除，并转发底层更新为 `watch` 事件。
- `remote.server`：承载 ServerPort 的 info、community、peer 和 publication 文件。常规内容读取与查询保持只读；发布和删除 publication 是经过远端写权限及 token 校验的显式 action，而不是通用 `write`。
- `third-party.installed-apps`：把本机已安装 App 投影到“本地应用”目录。文件读取返回应用 metadata，`launch` action 通过 Tauri 启动应用；不提供 metadata 写入、`watch` 或独立窗口能力。前端只提交 opaque App id，Rust 每次从平台可信目录重新枚举并解析启动项/图标；id、canonical 路径、图片扩展和内容魔数均在原生侧校验，前端不能提交任意启动路径或图标路径。
- `app.audio-library`：继续使用音频插件原 IndexedDB Blob，不复制媒体数据；提供播放状态、导入、导出、删除和 metadata 更新，并发送 `watch` 事件。音轨以 `audio/*` 文件供音频或预览 Engine 使用。
- `app.database`：每张表保留一个稳定 table JSON 文件，并挂出 rows 目录；每行都有不受排序影响的稳定 `FileRef`，可独立 `stat/read/watch/update/delete`。行 metadata 只含稳定身份/表引用，单元格正文只由 `read(rowRef)` 返回；删表会向已打开的行发送 `deleted`。表/行主键读取不扫描全库，rows 目录执行严格 cursor/limit 分页并在目录项携带安全 metadata snapshot，Display 可避免逐项 `stat`。建表、导入、导出、删表和行 CRUD 仍通过显式 action 提供；同一个 table 文件可由数据库、Code 或 Preview Engine 渲染。
- `app.agent-config`：把 Agent 正在使用的设置、工作区、规则、MCP、Skills 和任务 store 投影为可读写 JSON 文件，并复用同一订阅源发送 `watch`。普通 `fs:read` 只能枚举目录和读取不含正文指纹的安全 metadata；正文与带版本的 watch 需要 first-party 专用、默认关闭的 `agent.config:read`，UI 与精确活动 Engine 只对当前文件例外放行。Agent 显式授权后获得严格 section 枚举的 `agent.config.read` MCP tool；该 tool 只在 loopback 宿主注入 adapter 时注册，并仍通过 FileSystem registry 读取。公开正文会 fail-closed 地剥离 API key、token、认证头、URL query、命令参数及 schema 外字段；普通 `fs:write` 不能修改配置，只有 UI、精确活动 Engine 或专用 `agent.config:write` 可写。写入/导入先无副作用地校验全部 runtime schema，端点或命令变化时不会把既有凭据恢复到新目标。
- `app.git-repositories`：只挂载用户通过原生目录选择器授权的仓库。持久化 mount 为 `{ id, grantId, path }`；其中 path 仅用于展示，随机 mount id 用于 `FileRef`，bearer grantId 只在 provider 内解析原生授权。旧版字符串路径与导入数据会保留为未授权记录，必须重新选择目录，不能隐式恢复访问。provider 暴露仓库目录和真实子文件，提供文本读写、乐观并发、`watch`，以及 fetch、pull、push、branch、commit 和移除挂载等 Git action；仓库级变更会使该 mount 下已订阅的子文件一并刷新。

活动栏、桌面与移动目录树、本地搜索、Home 汇总以及笔记、书签、文件、订阅和回收站管理界面只调用 FileSystem registry。兼容 `FilesPort` 的普通 CRUD 也通过 registry 分派到 `ideall.core`；只有同步所需的 tombstone 全量读取和原子 bulk 写入收口在独立 `StorageSyncPort`。ESLint 对 `app/shell/workspace/modules/shared/ui` 禁止直接导入 store 或 Resource source registry；`src/filesystem/resource-sources` 只保留 FileSystem 内部的来源适配，`src/files/stores` 只保留 provider 存储实现及同步适配器。

## 运行时扩展边界

- `RuntimeExtensionCatalog` 是唯一激活入口：随包扩展走 builtin 信任路径，package 必须依次完成宿主注入的 `verify -> consent/restore -> activate`。Catalog 私有签发一次性、按 extension id 绑定的内存 permit，`RuntimeExtensionRegistry` 拒绝任何绕过 Catalog 的直接安装；缺少 verifier 或 consent authority 时 fail closed。
- 持久化只保存严格 v2 安装记录 `{ id, version, digest, permissionDigest, consentReceipt }`，不保存 factory 或可执行代码。hydrate 对大小、字段、数量和重复 id 严格校验，package receipt 必须由宿主重新验证并逐字段绑定当前 descriptor；未知来源只显示为 unavailable，不会执行。
- 激活前会对 Engine descriptor/matcher/renderer 做完整 runtime 白名单校验；随后先启动 connector 生命周期，再在同一 notification batch 中原子挂载 FileSystem 与成对的 Engine descriptor/renderer。卸载、撤销或 factory 移除会先 abort 并等待在途 activation，再调用生命周期 disposer，最后逆序注销宿主贡献；清理失败进入可诊断 quarantine，可重试且不会与新实例重叠。设置页展示来源、权限、状态、失败与待清理资源，并为 package 提供启用/重试、撤销和确认卸载；随发行物提供的 mandatory builtin 只允许故障重试，不伪装成可持久卸载。
- 本机已安装 App 已通过 `third-party.installed-apps` 文件系统、专用 Engine 和统一 `launch` action 形成完整链路。任意第三方 App 的内部数据仍需它自己的授权 connector/provider；宿主不会因为能启动一个 App 就推断拥有其数据访问权。

## Guarded FS 信任边界

- Git provider 通过 `src/lib/guarded-fs.ts` 调用 Tauri 原生命令访问仓库文件。TypeScript adapter 负责协议转换，不是安全边界。
- `main` 窗口是唯一获准调用 guarded FS 命令的窗口，且 grant 只能由 Rust 侧 Tauri dialog plugin 的原生目录选择器创建。前端不能向任何 guarded 命令传 root；独立 Engine 窗口也没有这些 Tauri capability。
- Rust 将 opaque UUID `grantId` 映射到 canonical root，并在 App 数据目录持久化；恢复和每次访问都会校验 root 的平台文件 identity，目录被替换后 grant 失效。撤销 mount 同时撤销原生 grant。
- stat/list/read/write 只接受 `grantId + entryId`（root 的 entryId 为空）。Unix entryId 使用 device/inode，Windows 使用 volume serial/file index；路径和名称不进入 `FileRef`。rename 后 identity 保持不变，缓存失效时 Rust 只在 grant 内进行有界扫描来重新定位。
- 解析目标时始终 canonicalize 并要求仍位于 grant root 内；目录枚举和 identity 扫描跳过 `.git`、指向 `.git` 的别名、symlink 逃逸与不支持条目。`list` 返回 canonical relative 作为展示 metadata，不能作为后续访问参数。read/write 在打开文件句柄后再次核对平台 identity，版本校验和 I/O 均使用该句柄，关闭路径替换的 TOCTOU 窗口。
- 原生层限制单次读取范围为 32 MiB、文本写入为 16 MiB。文件版本由修改时间与长度组成，`expectedVersion` 不匹配时返回冲突，避免静默覆盖并发修改。

## 安全不变量

- note/thread 正文、Blob 和远端写入继续经过各自既有权限闸；公开 metadata 不得绕过正文 consent 或二进制读取权限。
- provider 的写入和 destructive action 必须校验声明的 permission、intent 及来源约束；文件 capability 和 UI 可见性不能代替此校验。
- 远端、第三方 App、插件 IndexedDB 与本地磁盘各自保留存储边界。`save-to-mine` 是支持该 capability 的来源所提供的显式本地投影，不是所有只读来源的隐式写入路径。
- 独立窗口、guarded FS 与远端 action 的边界分别由 Tauri capability、Rust 路径约束和 provider 授权共同执行，不能由 Display 层放宽。
