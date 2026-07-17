# App 数据存储与左侧导航映射

本文说明 ideall 以 Tauri App 运行时的数据落点，以及桌面活动栏、二级侧栏如何通过 FileSystem 投影映射到真实数据。本文描述当前实现；完整分层契约见 [file-system-engine-architecture.md](file-system-engine-architecture.md)，总体数据流见 [architecture.md](architecture.md)。

## 1. 结论

ideall 的 Tauri 层是原生 App 外壳，但业务数据没有统一迁移到 Rust 或 SQLite：

- 本机核心内容主要保存在 App WebView 的 IndexedDB。
- 标签页、导航选中状态和部分公开配置保存在 localStorage / sessionStorage。
- 登录令牌、同步码、AI API Key 等敏感值优先保存在操作系统钥匙串。
- Git 仓库和用户授权目录仍位于原始磁盘位置，App 只保存授权及挂载信息。
- 新闻、社区等连接数据来自远端服务，不复制到本地 Node 库。

左侧导航也不直接查询 IndexedDB 来决定信息架构。它先读取只读的 `ideall.root` / `ideall.navigation` FileSystem 投影，再由目录项的 `target` 找到真实 FileSystem provider，最后用 `preferredEngine` 选择显示界面。

## 2. App 运行后的数据落点

### 2.1 WebView 本地存储

正式 App 加载 `out/` 静态资源，但 IndexedDB、localStorage 和 sessionStorage 由系统 WebView 的独立 App profile 管理，不写入仓库目录或 `out/`。

Tauri App 标识为 `org.wonita.ideall`，定义在 [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json)。当前配置没有为 WebView 数据指定自定义绝对路径，因此物理子目录由操作系统和 WebView 实现决定，不应作为业务契约使用。

开发与生产需要特别区分：

- `pnpm app:dev` 加载 `http://localhost:5020`。
- 正式 App 加载 Tauri 打包后的静态资源。
- 两者的 origin/profile 不同，IndexedDB 与 localStorage 通常不共享。

因此，开发壳中已有数据而正式安装包中为空，通常不是数据迁移失败，而是访问了不同的 WebView 存储域。

### 2.2 核心 IndexedDB

核心数据库定义在 [`src/lib/idb.ts`](../src/lib/idb.ts)：

| 项 | 当前值 |
| --- | --- |
| 数据库名 | `wonita-home` |
| 数据库版本 | `20` |
| 权威角色 | 本机核心内容的默认 Storage |

数据库名保留历史名称是有意行为。IndexedDB 不能原子重命名，直接改名会让旧数据表现为“丢失”。

**存储类（XDG 分类）**：每个存储点都归入六类之一——`data`（用户内容权威副本）、`config`（偏好与公开配置）、`cache`（可重建派生）、`state`（跨会话状态/历史）、`runtime`（会话级）、`secrets`（凭据本体）。分类登记在 [`src/plugins/shared/local-data-schema.ts`](../src/plugins/shared/local-data-schema.ts) 的 `storageClass`/`storeClasses` 字段（含构造期不变量：cache/runtime/secrets 不得 portable），设计见 [freedesktop-alignment.md](freedesktop-alignment.md) §2。归档 ⊆ data+config+state，同步只在 data 内按 scope 决策，仅 cache 可清除重建。

v17 在既有 `kind`、`[kind,sortKey]` 等索引上增加 `[kind,sortKey,title,id]` 覆盖索引。v18 增加 `local_search_index` 全文派生仓；v19 增加 `agent_write_audit` 脱敏审计 outbox；v20 增加可选的 `local_semantic_index` 向量派生仓。所有检索索引都可从 FileSystem 源数据重建，不是源数据。

| Object store | 内容 | 存储类 | 说明 |
| --- | --- | --- | --- |
| `nodes` | `note`、`bookmark`、`folder`、`file`、`feed`、`thread` | data | 一切皆文件的统一 Node 库 |
| `blobs` | 上传文件的原始 Blob | data | `file` Node 只保存 `blobRef`；Blob 默认不进入同步 |
| `trash_snapshots` | 删除前的 Node / Blob 恢复快照 | data | 与软删除墓碑共同支持回收站恢复 |
| `agent_tasks` | Agent 任务关系、revision、count、迁移状态 | data | 任务关联的对话正文仍是 `nodes` 中的 `thread` |
| `agent_write_audit` | Agent mutating tool 的脱敏 pending outbox 与终态回执 | state | 本机最多 1,000 条，不进入同步或配置导出；pending 不参与容量裁剪 |
| `local_search_index` | 标题、标签和正文检索投影 | cache | 本机派生数据，不进入同步或工作区归档；损坏时回退源数据扫描并重建 |
| `local_semantic_index` | 固定模型生成的 384 维 embedding | cache | 可选本机派生数据，最多 10,000 个对象、约 14.7 MiB；源版本漂移或损坏时停止语义混排并重建 |

核心内容与对象仓的映射如下：

| 产品概念 | Node kind | 正文/附属数据 |
| --- | --- | --- |
| 关注 | `feed` | 只保存关注偏好；关注内容可来自远端 |
| 书签 | `bookmark` | 收藏夹为 `folder`，父子关系使用 `parentId` |
| 资源 | `file` | 元数据在 `nodes`，原始内容在 `blobs` |
| 文件/笔记 | `note` | Plate 块正文保存在 Node 中 |
| 社区发布草稿 | `note` | `社区草稿` 标签 + 版本化元数据块；正文仍是普通 Plate 内容，成功后改标为 `社区发布` |
| AI 对话 | `thread` | 消息内联于 Thread Node |
| AI 任务 | `thread` + `agent_tasks` | Thread 保存正文，任务 store 保存轻量关系和版本 |

文件 Blob 的同事务写入实现可从 [`src/files/stores/files-store.ts`](../src/files/stores/files-store.ts) 继续追踪；Node 到 Resource/FileSystem 的投影入口位于 [`src/filesystem/resource-file-system/`](../src/filesystem/resource-file-system/)。

社区草稿没有单独 object store。`/home/publications` 从 `ideall.core` 的 Note FileSystem 筛选专用标签，URL 与来源快照身份位于首个版本化元数据块，正文位于后续普通段落块。因此它随笔记同步、工作区归档、全文索引和回收站一起工作；公开发布本身才经 `remote.server` 出站。

本地语义检索默认关闭且不下载模型。用户在“设置 > 基本 > 本地数据”显式启用后，App 才从 Hugging Face 的固定 commit 下载 `Xenova/multilingual-e5-small` q8 ONNX 所需四个文件，共 135,392,016 bytes（约 129 MiB），保存到 Cache Storage `ideall:semantic-model:v1`。模型 commit、文件清单和大小均固定；Transformers.js Worker 的 ONNX WASM runtime 随 App 构建，不从 CDN 加载。文档与查询只在离线 Worker 中生成向量，不作为模型下载请求上传；模型缓存和向量索引均可在设置中删除，也不进入工作区归档或跨端同步。

### 2.3 插件独立 IndexedDB

不是所有 App 数据都强行写入 `wonita-home`。插件保留自己的事务和存储语义，再通过 FileSystem 投影到统一命名空间。

| 数据库 | 数据 | 存储类 | 实现 |
| --- | --- | --- | --- |
| `ideall:audio` | 音轨 Blob、音轨元数据（`tracks` = data）、播放状态（`state` = state） | data（混合，见 storeClasses） | [`src/plugins/audio/audio-store.ts`](../src/plugins/audio/audio-store.ts) |
| `ideall:database` | 数据表、字段和行 | data | [`src/plugins/database/database-store.ts`](../src/plugins/database/database-store.ts) |

### 2.4 localStorage 与 sessionStorage

localStorage 主要保存小型公开配置、索引和跨重启 UI 状态，不作为核心大正文的默认容器。

| 数据 | 典型键/位置 | 存储类 | 说明 |
| --- | --- | --- | --- |
| 工作区快照 | `ideall:workspace:v1` | state（localStorage）/ runtime（sessionStorage） | 标签、当前标签、活动分区、工作区类型、侧栏状态等；同时写 sessionStorage 与 localStorage |
| 默认启动目标 | `ideall:startup-target:v1` | config | 没有可恢复标签时使用 |
| Agent 工作区公开状态 | `ideall:agent:workspaces:v1` | config | 不含 API Key；包含单调 revision |
| Agent 设置、规则、MCP、Skills 等公开配置 | `ideall:agent:*` | config（凭据 revision 为 state） | 由各 owner store 维护，敏感值另存 secure store |
| 本地语义混排开关 | `ideall:semantic-search:v1` | config | 仅保存是否启用；模型本体在 Cache Storage，向量在 IndexedDB |
| Git 仓库挂载列表 | `ideall:git:repos` | config | 保存 mount/grant/path 信息，不保存仓库内容 |
| Engine 偏好、树展开状态、主题等 | 各模块命名键 | config（Engine 偏好/主题/启动目标）、state（树展开等 UI 状态） | 只保存 Display 或本机配置状态 |

工作区快照的双写入口是 [`src/workspace/workspace-persist.ts`](../src/workspace/workspace-persist.ts)，本地数据 schema 汇总入口是 [`src/plugins/shared/local-data-schema.ts`](../src/plugins/shared/local-data-schema.ts)。

### 2.5 系统安全存储

桌面 App 通过 Rust `keyring` 使用操作系统凭据后端，入口位于 [`src-tauri/src/secure_store.rs`](../src-tauri/src/secure_store.rs)，前端适配位于 [`src/lib/secure-store.ts`](../src/lib/secure-store.ts)。

当前已登记的核心敏感项（全部归 `secrets` 存储类）包括：

| 项 | Secure store key |
| --- | --- |
| 登录令牌 | `ideall:auth:token` |
| 同步码 | `ideall:sync:code` |
| 全局 AI API Key | `ideall:agent:settings:apiKey` |

Agent workspace 覆盖凭据、MCP secret 和 OAuth token 也遵循相同原则：公开索引可以位于 localStorage，但密钥值本身进入 secure store。纯 Web 形态仍可使用带明确前缀的 localStorage 兼容后端；Tauri 桌面形态若系统钥匙串不可用则 **fail closed**，不会把新敏感值降级写入 WebView 明文存储。设置页会把当前安全存储后端显示为健康项。

### 2.6 原生 App data 与用户文件

Rust 侧明确写入 App data 的一个例子是目录授权清单：

```text
<Tauri app_data_dir>/guarded-fs-grants.json
```

实现位于 [`src-tauri/src/guarded_fs.rs`](../src-tauri/src/guarded_fs.rs)。在使用标准 XDG 目录的 Linux 环境中，`app_data_dir` 通常位于 `~/.local/share/org.wonita.ideall/`；其它平台由 Tauri 路径解析器决定。

该文件只保存授权根、稳定身份和 grant id。Git 仓库或用户选择的文件夹不会被复制到 App data；读写仍发生在用户原始目录，并受 grant 校验保护。

## 3. 导航不是第二份业务数据

### 3.1 五层关系

导航涉及三个不同概念：

| 概念 | 职责 | 是否是数据身份 |
| --- | --- | --- |
| `navigationPath` | 表示 `/home/bookmarks` 等导航位置，用于深链和左侧高亮 | 否 |
| `FileRef` | `{ fileSystemId, fileId }`，定位真实文件或目录 | 是 |
| `engineId` | 选择如何解释和显示同一个文件 | 否；它与 FileRef 一起组成标签身份 |

目录项只是链接。删除或移动一个导航 link 不等于删除 target 数据；同一个 FileRef 也可以从多个位置打开。

### 3.2 启动注册

客户端启动时，组合根在 [`src/shell/boot.ts`](../src/shell/boot.ts) 注册内置 FileSystem、Engine 和 Display renderer。内置文件系统注册入口位于 [`src/filesystem/builtin.ts`](../src/filesystem/builtin.ts)：

1. `ideall.core`：本地 Node/Blob 与兼容 Resource 投影。
2. `ideall.navigation`：五分区和二级入口的只读导航命名空间。
3. `ideall.root`：隐藏的合成根，汇总固定分区和运行时 mount。
4. `remote.server`：资讯、社区等远端文件。
5. `ideall.trash`：回收站投影。

音频、数据库、Git、Agent 配置、设置和本地应用等 provider 会通过内置 manifest/runtime extension 继续挂载。

注册事务结束前，[`src/shell/boot-contract.ts`](../src/shell/boot-contract.ts) 会校验导航定义、三个核心 provider 的根引用和 `read-directory` 能力。契约失败时 BootGate 停止进入工作区，并显示稳定错误码与脱敏诊断，避免把“半注册”误表现成空导航。

### 3.3 活动栏读取一级目录

桌面最左侧的 Activity Bar 读取 `IDEALL_ROOT_REF`，对应隐藏合成根 `ideall.root/root`。核心目录项由 [`src/filesystem/builtin.ts`](../src/filesystem/builtin.ts) 根据导航定义生成：

```text
ideall.root/root
├── /home      → ideall.navigation/home
├── /activity  → ideall.navigation/activity
├── /browse    → ideall.navigation/browse
├── /apps      → ideall.navigation/apps
└── /settings  → ideall.navigation/settings
```

[`src/workspace/activity-bar.tsx`](../src/workspace/activity-bar.tsx) 通过 `useNavigationDirectory(IDEALL_ROOT_REF)` 取得名称、顺序、路径和 icon hint。React 层的 [`src/workspace/navigation-sections.ts`](../src/workspace/navigation-sections.ts) 主要负责把 icon hint 映射到 Lucide 图标并提供首次加载回退，不负责定义真实 target。

点击一级分区会更新 workspace 的 `activeRootId`，并展开或切换对应二级侧栏；它不会直接读取或修改业务正文。

### 3.4 二级侧栏读取分区目录

二级侧栏读取当前 `ideall.navigation/<section>` 目录，例如：

```text
ideall.navigation/home
├── following  → ideall.core/place:subscriptions
├── bookmarks  → ideall.core/place:bookmarks
├── resources  → ideall.core/place:files
└── files      → ideall.core/place:notes
```

每个 `DirectoryEntry` 的核心信息是：

```ts
{
  pathName,       // 路径分量与高亮位置
  target,         // 真实 FileRef
  properties: {
    preferredEngine,
    targetKind,
    iconHint,
  },
}
```

目录项由 [`src/filesystem/navigation-file-system.ts`](../src/filesystem/navigation-file-system.ts) 生成。桌面侧栏由 [`src/workspace/navigation-sidebar-list.tsx`](../src/workspace/navigation-sidebar-list.tsx) 消费；Activity Bar、桌面侧栏和移动导航共用 [`src/workspace/use-navigation-directory.ts`](../src/workspace/use-navigation-directory.ts) 的目录读取、metadata 解析、缓存和 watch 边界。

### 3.5 点击入口后的完整链路

```text
DirectoryEntry
  ├─ pathName ───────────────► 生成 navigationPath，用于深链和高亮
  ├─ target: FileRef ────────► FileSystem registry 按 fileSystemId 找 provider
  └─ preferredEngine ────────► Engine registry 选择匹配的 Display renderer
                                      │
                                      ▼
                             打开 FileRef + engineId 标签
```

点击二级入口时，`NavigationSidebarList` 把以下目标交给 `openTarget`：

- `ref`：真实 target FileRef；
- `engineId`：目录项声明的 preferred Engine；
- `rootId`：当前五分区 id；
- `navigationPath`：当前 link 的规范路径；
- `transient`：单击预览或双击固定标签的状态。

`openTarget` 随后执行 `statFile(ref)`，由 registry 分派到真实 provider，再匹配 Engine 并创建标签。因此导航组件不需要知道 target 最终来自 IndexedDB、localStorage、远端服务还是操作系统。

## 4. 当前导航到数据的完整映射

导航定义的权威来源是 [`src/filesystem/navigation-file-system.ts`](../src/filesystem/navigation-file-system.ts)。

| 规范路径 | 真实 FileRef | Preferred Engine | Storage / 来源 |
| --- | --- | --- | --- |
| `/home/following` | `ideall.core / place:subscriptions` | `ideall.subscriptions` | `wonita-home/nodes` 中的 `feed`；内容可来自远端 |
| `/home/bookmarks` | `ideall.core / place:bookmarks` | `ideall.bookmarks` | `nodes` 中的 `folder`、`bookmark` |
| `/home/resources` | `ideall.core / place:files` | `ideall.resources` | `nodes` 中的 `file` + `blobs` |
| `/home/files` | `ideall.core / place:notes` | `ideall.directory` | `nodes` 中的 `note` |
| `/activity/audit` | `app.agent-write-audit / audit` | `ideall.agent-write-audit` | `agent_write_audit` 脱敏 outbox；只读展示、跨窗口 watch |
| `/activity/spaces` | `app.agent-config / config:workspaces` | `ideall.agent-spaces` | Agent workspace localStorage 公开状态 + secure-store 凭据 |
| `/activity/tasks` | `app.agent-config / config:tasks` | `ideall.agent-tasks` | `agent_tasks` + `nodes/thread` |
| `/activity/deleted` | `ideall.trash / root` | `ideall.trash` | Node 墓碑、`trash_snapshots`、必要时关联 Blob |
| `/browse/news` | `ideall.core / resource:info…` | `ideall.connected` | info Resource / 远端 ServerPort 或嵌入页 |
| `/browse/community` | `ideall.core / resource:community…` | `ideall.connected` | community Resource / 远端 ServerPort 或嵌入页 |
| `/browse/browser` | `ideall.core / resource:browser…` | `ideall.browser` | 浏览器宿主能力；页面状态不属于核心 Node 正文 |
| `/apps/search` | `ideall.core / resource:tool…` | `ideall.connected` | Tool Resource；历史等轻状态可位于 localStorage |
| `/apps/local-apps` | `third-party.installed-apps / root` | `ideall.installed-apps` | Rust 实时枚举本机已安装 App |
| `/settings/basic` | `app.settings / root` | `ideall.settings` | 主题、设备、连接、运行时扩展等 owner 状态的 JSON 投影 |
| `/settings/ai` | `app.agent-config / config:settings` | `ideall.agent-settings` | Agent 公开配置 + secure store 中的敏感值 |

`ideall.core` place 到 Node kind 的查询规则集中在 [`src/filesystem/resource-file-system/catalog.ts`](../src/filesystem/resource-file-system/catalog.ts)：

```text
subscriptions → node/feed
bookmarks     → node/folder + node/bookmark
files         → node/file
notes         → node/note
home          → node/thread
```

目录入口展开后，子树直接读取 target provider 的真实目录。例如展开“文件”会读取 `place:notes` 下的 Note FileRef；新增笔记会改变该真实目录的读取结果，但不会改变五分区或二级入口定义。

## 5. 状态变化如何反映到 UI

`useNavigationDirectory` 对目录读取执行以下处理：

1. 通过 FileSystem registry 读取目录分页。
2. 过滤 `navigationHidden: true` 的兼容项或内部 mount。
3. 批量解析目录项 metadata。
4. 缓存本次 provider generation 的结果。
5. provider 支持 `watch` 时，在变更后重新读取。

Node 目录的常用无文本查询会把 opaque cursor 直接下推到 Storage。桌面树每页读取 80 项，到达列表末尾或点击“加载更多”才请求下一页；不会再为了显示首屏预先物化整个目录。

需要注意两类变化：

- **导航结构变化**：修改 `ideall.navigation` 定义，或挂载/卸载运行时 FileSystem；影响 Activity Bar 或固定入口。
- **业务内容变化**：新增笔记、书签、文件、任务等；影响入口展开后的 target 目录或已打开 Display，不改变固定导航定义。

`navigationHidden` 用于让兼容 panel、内部 App root 或无需直接展示的运行时 mount 留在文件系统中，但不重复出现在左侧导航。

## 6. 示例：书签入口如何到达 IndexedDB

以 `/home/bookmarks` 为例：

```text
1. ideall.root 返回 home DirectoryEntry
2. Activity Bar 选择 home，workspace.activeRootId = "home"
3. 二级侧栏读取 ideall.navigation/home
4. bookmarks DirectoryEntry 提供：
   target = { fileSystemId: "ideall.core", fileId: "place:bookmarks" }
   preferredEngine = "ideall.bookmarks"
5. openTarget 对 target 执行 stat
6. FileSystem registry 分派给 ideall.core provider
7. place:bookmarks 查询 node kind = folder | bookmark
8. Node Resource source 读取 IndexedDB wonita-home/nodes
9. ideall.bookmarks Engine 用书签管理 Display 打开同一个 FileRef
10. 标签保存 navigationPath = "/home/bookmarks"，供左侧高亮
```

这里不存在“导航书签数据”和“书签管理数据”两份记录；导航只是指向真实目录的 link。

## 7. 排查数据与导航问题

### 7.1 App 中数据为空

按顺序检查：

1. 当前运行的是 `app:dev` 还是正式安装包，确认是否处于不同 origin/profile。
2. 检查 IndexedDB 是否存在 `wonita-home`、版本是否为 18。
3. 检查 `nodes` 中是否存在对应 kind，记录是否带 `deletedAt`。
4. 文件资源还要检查 `blobs` 中是否存在 `blobRef.key` 对应记录。
5. Agent 任务检查 `agent_tasks` 与关联 `thread` 是否一致。
6. 若只恢复了 UI 标签但内容为空，检查 localStorage 工作区快照是否指向另一个 profile 中的旧 FileRef。

### 7.2 左侧入口存在但打不开

按边界检查：

1. `DirectoryEntry.target` 的 `fileSystemId/fileId` 是否正确。
2. 对应 provider 是否已在 boot/runtime extension 阶段注册。
3. `provider.stat(target)` 是否返回文件。
4. `preferredEngine` 是否已经注册且能匹配该文件 media type/capability。
5. renderer 是否已和 Engine descriptor 成对注册。
6. 目标是否被 `navigationHidden` 误过滤，或运行时 mount 是否仍在等待激活。

### 7.3 数据存在但左侧树不刷新

检查：

1. Storage mutation 是否在事务提交后发出 store/provider 变更通知。
2. provider 是否实现 `watch`，事件 ref 是否覆盖目标目录或父目录。
3. `useNavigationDirectory` 当前缓存绑定的 provider generation 是否已经替换。
4. 跨窗口 mutation 是否只广播失效信号，并由接收方重新读取 Storage。

## 8. 修改导航时的约束

新增或调整左侧入口时，应保持以下顺序：

1. 先确定真实 Storage 和 FileSystem provider，不让导航组件直连 store。
2. 为 target 提供稳定 FileRef；名称、路径、父目录不能充当文件身份。
3. 在 `navigation-file-system.ts` 中添加或调整 link、`preferredEngine` 和 icon hint。
4. 确保 Engine descriptor 与 renderer 已在组合根注册。
5. 只在 `navigation-sections.ts` 中维护图标/颜色等 Display 装饰。
6. 为导航目录项、打开目标、旧深链迁移和 workspace 水合补充聚焦测试。

不要把 localStorage key、IndexedDB 主键或 Next 路由直接当成导航协议。稳定边界应始终是：

```text
Storage → FileSystem provider → FileRef → Engine → Display
```

## 9. 数据安全与备份注意

- 清理 App WebView 数据可能同时删除 IndexedDB 与 localStorage 中的本地内容。
- 当前同步不是整库备份；同步范围与加密语义以 [sync-lww-tradeoff.md](sync-lww-tradeoff.md) 为准。
- 当前关注、笔记、书签与收藏夹分别进入端到端加密同步；文件 Blob、AI 对话、插件数据库和部分本机配置仍不应被假定为已跨端同步。
- 导出/导入应通过各 owner 的 data port 或 workspace archive，不能直接复制正在使用的 IndexedDB 底层文件。
- Secure store 与 WebView Storage 是两个后端，不具备跨后端原子事务；相关写入必须遵守各 owner 的 revision、锁和失败回滚语义。

设置页“本地数据”区域提供 IndexedDB store 计数、持久存储状态、申请持久存储、归档导出、导入预览与确认导入。工作区归档当前为 v2，manifest 记录数量、Blob 字节数和 CRC32，用于发现截断或意外损坏；CRC32 不是数字签名，不能证明归档来源可信，导入前仍必须预览。归档可用不少于 12 字符的口令经 PBKDF2-SHA-256（600,000 次）派生 AES-256-GCM 密钥；外层及明文、节点、Blob、回收站、插件和标签页都有硬上限，选择文件时会先检查 envelope 大小。

桌面 App 还提供两项运行期安全操作：系统凭据库自检在 Rust 端写入、读回并删除一次性随机值；遗留凭据迁移只在原生值已存在，或新值写入并读回一致后，才删除旧 fallback/公开明文。真实安装包验收见 [app-data-safety-acceptance.md](app-data-safety-acceptance.md)。

## 10. 优化实施状态与后续建议

本轮按风险和收益顺序完成了以下收敛：

1. **敏感数据安全**：桌面 secure store 失败关闭；敏感写入改为可等待、可向 UI 报错，不再静默降级明文。
2. **可恢复性**：增加本地数据健康视图、持久存储申请、workspace archive v2 完整性 manifest 和导入预览。
3. **大目录性能**：v17 的 Node 摘要查询和左侧树使用稳定 cursor 增量分页；v18 的全文搜索只查询可重建派生投影，避免每次克隆全部源正文。
4. **导航一致性**：规范路径和 legacy root 映射集中到 `navigation-file-system`；启动时执行 provider/导航契约检查。
5. **配置与同步**：主题和文件树展开状态经统一的公开配置访问层，并登记到可诊断、可修复 schema；书签与收藏夹加入独立 E2E 加密同步域。
6. **资源与关系约束**：归档和三个同步域具有内存/记录硬预算；书签孤儿会确定性归根，Storage CAS 再次拒绝不完整父集合。
7. **桌面验收与迁移**：设置页可执行真实 keychain 自检和遗留明文迁移；`lint:storage` 冻结既有 Web Storage 适配器，新增直接访问不能通过质量门禁。
8. **非敏感指标**：本机状态显示当前进程最近一次同步的成功/失败、完成时间、耗时、条目数或稳定失败分类，不记录同步码、storageId、密文或错误正文。

暂不建议仅为“桌面 App”形态立即迁移到 SQLite。现有核心内容已统一在 IndexedDB Node 模型，且分页、事务、健康检查与备份边界已经补齐；此时迁移会引入 WebView/原生双存储迁移和回滚成本。后续优先级建议是：

- 如需要验证“归档来自谁”，再为 archive v2 增加签名或受信导出来源；当前 AES-GCM 只证明持口令者生成的密文未被篡改，CRC32 只负责明文误码检测。
- 为超大 Blob 设计分块、限额、断点和用户显式选择的同步通道，不把它直接塞进现有 JSON SyncBlob。
- 持续把新增公开配置登记到 local data schema；只有出现查询、事务或跨模块一致性需求时，再评估配置数据库。
- 在发布矩阵持续执行真实 Tauri 升级/导入/钥匙串不可用验收，并保存不含敏感值的结果记录。
