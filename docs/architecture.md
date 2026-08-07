# 架构与数据模型

## 分层

代码按依赖方向组织：

- `domain`：节点、文档、发布关联、同步元数据及仓库接口
- `application`：导入导出、发布协调、加密同步与冲突合并
- `data`：Drift SQLite、FTS5、仓库实现
- `wonita`：类型化 HTTP、认证密码学、发布与同步传输
- `presentation`：自适应外壳、五个主区、编辑器和受控内容阅读器
- `app`：Riverpod 依赖组合、路由、主题与语言

外部服务和本地数据库不会进入 Widget 的核心逻辑；页面接收窄回调和视图数据。所有可执行内容均由注册引擎解释，首版只有笔记编辑/阅读、书签预览、Wonita 文章、发布阅读与文件夹浏览，不加载代码或插件。

## 本地模型

层级节点 `LibraryNode` 有稳定 UUID、可空父节点、类型、标题、Quill Delta、纯文本投影、URL、标签、状态、UTC 时间戳和单调 revision。

节点类型：

- `folder`
- `note`
- `bookmark`
- `publicationDraft`

状态为 `active / trashed / archived`。文件夹删除会级联状态；永久删除前必须进入显式确认流程。

其他记录包括：

- `Subscription`
- `PublicationLink`
- `SyncMetadata`
- `SyncTombstone`
- `ActivityEntry`

数据库文件固定为 `ideall_terminal_v1.sqlite`，当前 schema v2 会从 v1 原地增加同步删除墓碑表，不接触旧应用的 `ideall.db`。FTS5 以标题、纯文本和标签建立外部内容索引；不支持 FTS5 的 SQLite 构建会安全降级为转义后的 `LIKE` 查询。

## 编辑与发布

编辑器只允许段落、H1–H3、引用、有序/无序/待办列表、代码块、分隔线，以及粗体、斜体、删除线、行内代码和 HTTP(S) 链接。Delta 是本地权威格式；发布前生成可移植 Markdown，并按 Wonita 的标题和 UTF-8 字节上限验证。

本地节点与云端发布通过 `PublicationLink` 关联。发布 ID 稳定，内容更新与状态切换使用服务端版本号做 CAS；恢复旧版本会追加新版本，不修改历史。

## 同步合并

三类数据使用不同派生 ID 和密钥。每个范围的快照含版本向量、写入设备 ID 与完整记录：

1. 本地脏数据先递增当前设备计数。
2. 下载并解密当前远端快照。
3. 依据版本向量判断本地领先、远端领先或并发。
4. 永久删除生成持久化 tombstone；删除对同 ID 的陈旧记录采用 delete-wins，避免另一台设备把内容复活。
5. 并发节点采用确定性排序保留稳定 ID 的胜者，并为败者生成 UUID-v5 冲突副本。
6. 导入合并结果后，上传新不可变 generation，最后 CAS 切换 manifest。

CAS 冲突最多重新读取并合并三次。应用不运行后台同步，只在用户点击或显式前台动作时工作。
