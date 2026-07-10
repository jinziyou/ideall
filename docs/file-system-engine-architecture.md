# 文件系统与引擎架构

本文是 ideall 五层模型的实现约定：

```text
Storage -> FileSystem -> IdeallFile -> Engine -> Display
```

## 身份与挂载

- Storage 是物理来源和 provenance，包括本地 Node/Blob、独立插件 IndexedDB、ServerPort、App 与第三方 App。来源保留自己的事务、同步和权限语义，不强行实现一套通用 CRUD。
- 一个 `FileSystemProvider` 对应一个可独立挂载的文件系统实例。registry 按 `fileSystemId` 分派，允许多个同类来源同时注册。
- `FileRef { fileSystemId, fileId }` 是文件身份；名称、路径和父目录不参与身份。`DirectoryEntry` 独立引用 `FileRef`，因此同一文件可被多个目录引用，删除 link/mount 不等于删除源文件。
- `ideall.root` 是隐藏合成根。核心目录和运行期 App 挂载共同组成它的直接目录项；这些目录项驱动桌面活动栏。
- 旧 Resource/VFS 由 `ideall.core` 适配器接入。Node 的同步、墓碑、Blob 旁存、正文 consent 与 `save-to-mine` 语义不变。

## 文件与引擎

- `IdeallFile.kind` 只表达 `file | directory`；业务含义由开放的 `mediaType`、properties 和 capabilities 表达。
- Engine 只声明匹配条件、优先级、布局、读写级别和独立窗口支持；React 组件留在 Display 层。
- 默认解析顺序固定为：单文件偏好、media type 偏好、引擎 priority/specificity、通用预览。
- 标签身份是 `FileRef + engineId`。同一文件可同时拥有音频、开发、浏览器或通用预览视图。
- 选择非默认引擎创建 `engine-*` 独立窗口。窗口只接受内部 `file/engine/display=window` 深链，不恢复主会话，也不继承主窗口的 secure-store、HTTP、Shell 等 IPC capability。

## Display 与启动

- 根目录本身不显示；活动栏展示其直接子树，二级侧栏通过 `readDirectory/stat/watch` 渲染当前子树。
- 新深链使用 `?file=<FileRefKey>&engine=<engineId>`；旧 `?resource=`、`?node=` 和静态路由仍作为兼容入口。
- 主窗口优先恢复 workspace 快照。没有可恢复标签时读取 `ideall:startup-target:v1`，无效则回退 Home。
- 引擎菜单提供“设为此文件默认”“设为此类型默认”“设为启动界面”。其他匹配引擎通过独立窗口打开。

## 当前挂载

- `ideall.core`：统一 Node/Blob、本地系统文件、ServerPort/嵌入路由和旧 Resource 兼容层。
- `app.audio-library`：保留音频插件原 IndexedDB Blob，不复制数据；音轨作为 `audio/*` 文件供音频或预览引擎处理。
- `app.database`：数据库表作为数据库文件挂载。
- `app.git-repositories`：用户已显式保存的仓库路径作为受限目录挂载；不会自动枚举整块磁盘。
- 第三方可用 `mountFileSystem()` 原子注册 provider 并向合成根贡献目录；卸载只移除目录项。

## 安全不变量

- 所有文件系统调用携带 actor、permissions、intent、activeFile；provider 不能从工作区全局状态偷取授权。
- note/thread 正文、Blob 和远端写入继续执行原 VFS 权限闸。metadata 和目录项不得携带私密正文或二进制。
- 远端可写来源原地保存；只读来源只提供 `save-to-mine` 本地投影。
- 独立引擎窗口的原生创建命令只授权主窗口调用，URL 与 label 在 TypeScript/Rust 两侧重复校验。
