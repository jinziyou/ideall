# Resource VFS 重构设计

本文修正“把全项目统一到 Linux 式分层模型”方案中的缺口，目标是把本地模式和连接模式统一到同一套可寻址、可打开、可搜索、可显示的 Resource 模型，同时保留本地 `Node` 的同步、隐私和墓碑语义。

当前状态：Resource 契约、VFS registry、`node` provider、连接模式 providers、`OpenTarget`、resource engines、连接侧栏 ResourceMeta 渲染、`save-to-mine` projector、VFS watch 已落地。仍保留 `kind:"node"` 标签作为兼容壳，暂不引入统一 `kind:"resource"` 标签。

## 1. 目标与非目标

目标分层：

```text
Storage -> VFS -> Resource Contract -> Engine -> Display
```

- **Storage**：物理存储与外部数据来源。包括 IndexedDB、Blob、同步密文、ServerPort、embed runtime、Tauri 能力。
- **VFS**：虚拟文件系统挂载层。把 `node/info/community/tool/browser/app` 暴露为统一 provider。
- **Resource Contract**：纯类型契约。描述“可寻址对象”的 ref、meta、capability、action，不包含 React、图标或 viewer。
- **Engine**：处理资源的能力。包括 viewer、preview、editor、resolver、save-to-mine projector、AI 工具适配。
- **Display**：workspace tabs、sidebar tree、search、mobile drill bar、panel layout。

非目标：

- 不把远端 `info/community` 对象强行写入本地 `STORE_NODES`。
- 不改 `Node` 同步、墓碑、`stripNode` 隐私净化和笔记块级合并。
- 不让 `protocol` 或 `vfs` 依赖 React、lucide、workspace UI。
- 不一次性删除 `openNodeTab`、`descriptorForNode`、`kind:"node"` 等旧入口。

## 2. ResourceRef 规范

`ResourceRef` 是全项目统一寻址句柄。`NodeRef` 是本地文件 ref，未来作为 `ResourceRef` 的一个 scheme。

```ts
export type ResourceScheme = "node" | "info" | "community" | "tool" | "browser" | "app"

export type NodeResourceRef = {
  scheme: "node"
  kind: NodeKind
  id: string
}

export type ResourceRef =
  | NodeResourceRef
  | { scheme: "info"; kind: "home" | "entity" | "publisher" | "search"; id: string }
  | { scheme: "community"; kind: "home" | "peer" | "publication"; id: string }
  | { scheme: "tool"; kind: "search" | "ai" | "navigation"; id: string }
  | { scheme: "browser"; kind: "page" | "bookmark"; id: string }
  | { scheme: "app"; kind: "native-app"; id: string }
```

Canonical key：

```ts
resourceKey(ref) = `${ref.scheme}:${ref.kind}:${encodeURIComponent(ref.id)}`
```

规则：

- `scheme` 和 `kind` 必须来自闭合联合，不接受任意字符串。
- `id` 是不透明字符串，只允许在 key 中 `encodeURIComponent`。
- `parseResourceKey()` 必须反序列化并校验 `scheme/kind/id`。
- URL 深链优先使用 `?resource=<resourceKey>`。
- 兼容旧深链：`?node=kind:id` 继续解析为 `{ scheme:"node", kind, id }`。
- 标签去重只看 canonical key，不看标题、route 或 display 文案。

## 3. ResourceMeta 与能力

`ResourceMeta` 是显示层和搜索层消费的最小元数据，不包含组件。

```ts
export type ResourceCapability =
  | "open"
  | "preview"
  | "edit"
  | "delete"
  | "restore"
  | "move"
  | "sync"
  | "read-content"
  | "read-blob"
  | "save-to-mine"
  | "navigate"

export type ResourceMeta = {
  ref: ResourceRef
  title: string
  subtitle?: string
  parent?: ResourceRef
  sortKey?: string
  updatedAt?: number
  iconHint?: string
  route?: string
  capabilities: ResourceCapability[]
}
```

约束：

- `route` 只是打开提示，不是身份。身份只能来自 `ref`。
- `iconHint` 是纯字符串提示，真实图标由 Engine/Display 决定。
- `read-content` 和 `read-blob` 必须独立于 `open`，防止 UI 打开能力被误当正文读取权限。
- `save-to-mine` 只表示可投影，不表示已经本地拥有。

## 4. VFS Provider 契约

Provider 是 scheme 的挂载点。它可以包装本地 IndexedDB，也可以包装 ServerPort、embed route、Tauri API。

```ts
export type ResourceQuery = {
  scheme: ResourceScheme
  kind?: string
  kinds?: readonly string[]
  parent?: ResourceRef
  text?: string
  limit?: number
  cursor?: string
}

export type ResourcePage = {
  items: ResourceMeta[]
  nextCursor?: string
}

export type ResourceRecord = {
  meta: ResourceMeta
  content?: unknown
}

export type ResourceActionId =
  | "open"
  | "preview"
  | "edit"
  | "delete"
  | "restore"
  | "move"
  | "read-blob"
  | "save-to-mine"
  | "navigate"

export type ResourceAction = {
  id: ResourceActionId
  label: string
  destructive?: boolean
  requires?: ResourceCapability[]
}

export type VfsAccessContext = {
  actor: "ui" | "agent" | "embed"
  permissions: readonly string[]
  /** 用户当前正在看的资源, 用于 note/thread 隐式同意判断。 */
  activeRef?: ResourceRef
  intent?: "metadata" | "content" | "blob" | "action"
}

export type WatchHandle = { dispose: () => void }

export type VfsProvider = {
  scheme: ResourceScheme
  list(query: ResourceQuery, ctx: VfsAccessContext): Promise<ResourcePage>
  get(ref: ResourceRef, ctx: VfsAccessContext): Promise<ResourceRecord | null>
  actions(ref: ResourceRef, ctx: VfsAccessContext): Promise<ResourceAction[]>
  invoke(
    ref: ResourceRef,
    action: ResourceActionId,
    input: unknown,
    ctx: VfsAccessContext,
  ): Promise<unknown>
  watch?(query: ResourceQuery, ctx: VfsAccessContext, notify: () => void): WatchHandle
}
```

错误约定：

- `not-found`：资源不存在或已删除。
- `permission-denied`：当前 grant 不允许。
- `consent-required`：需要用户显式授权，如 note/thread 正文。
- `offline`：连接模式 provider 当前无法取数。
- `unsupported`：scheme/kind 支持显示但不支持该动作。

Provider 注册规则：

- `vfs/registry.ts` 只管 provider 注册、查找和分派。
- 同一个 `scheme` 只能有一个 provider。
- registry 负责把 `ResourceRef.scheme` 分派到对应 provider；provider 内仍要校验 `kind`。
- 所有 provider 调用必须携带 `VfsAccessContext`，不得从全局偷读权限或活动标签状态。
- provider 不 import workspace UI。
- provider 不返回 React component，不返回 lucide icon。

## 5. 连接模式 Provider 设计

连接模式不是单一数据源，需要区分三类 Resource：

1. **可列举远端对象**：可通过 `ServerPort` 或本地关注偏好列出。
   例如 entity、publisher、peer、publication。
2. **可打开路由对象**：本身不一定可枚举，但可变成稳定 `route`。
   例如 `/info/search?...`、`/tool/navigation`。
3. **嵌入运行时对象**：由 embed iframe 负责内部导航，宿主只持外层 Resource。
   例如 `info:home`、`community:home`。

Provider 责任：

- `info-provider`：包装 ServerPort 可取的 entity/publisher/search 语义，并把 embed route 暴露为 Resource route。
- `community-provider`：包装 peer/publication，支持打开 community embed route。
- `tool-provider`：包装 search/ai/navigation 页面，通常是静态 Resource。
- `browser-provider`：包装 browser page 和本地 bookmark 导航。
- `app-provider`：包装 Tauri native app launcher。

远端保存规则：

- 远端 Resource 默认只读，不进入 `STORE_NODES`。
- “关注 / 收藏 / 保存到我的”通过 `save-to-mine` action 进入 `save-to-mine-projector`。
- 投影必须幂等：关注走 `feed:type:key` 稳定键；书签按 URL 去重，避免重复创建。
- 投影结果返回本地资产摘要（subscription/bookmark + existed + href），不把远端对象自动改写成 `NodeResourceRef`。
- 连接资源的静态入口、route、title、capability 定义集中在 `connected-resource-manifest.ts`，provider 只负责 VFS list/get/action/watch 编排。

## 6. OpenTarget 与 Tab 兼容

统一打开入口：

```ts
export type OpenTarget =
  | { type: "resource"; ref: ResourceRef; title?: string; meta?: ResourceMeta; transient?: boolean }
  | { type: "tab"; descriptor: TabDescriptor; transient?: boolean }
  | { type: "command"; command: "open-ai-panel" | "toggle-right-panel" }
```

迁移规则：

- 新增 `openTarget(target)`，旧 `openTab` 和 `openNodeTab` 保持。
- `openNodeTab(ref,title)` 变成薄包装：`openTarget({ type:"resource", ref:{ scheme:"node", ...ref }, title })`。
- `openTarget(resource)` 同步打开 fallback descriptor，同时通过 VFS `get(..., intent:"metadata")` 读取 `ResourceMeta` 修正标题、route 和 embed 内部导航。
- 新 tab 类型可以先沿用旧 `kind:"node"`，待 resource engine 稳定后再引入 `kind:"resource"`。
- URL sync 优先读 `?resource=`，其次读旧 `?node=`。
- 水合旧标签：
  - 旧 `kind:"node"` 标签按 params 反解为 `node` Resource。
  - 静态面板标签继续按 `tab-definitions` 解析。
  - 无法解析的旧标签丢弃，不阻塞 hydration。
- `tabKey()` 对 resource 标签只使用 `resourceKey(ref)`。

## 7. Engine 与 Display 边界

Engine 是 UI 层能力注册表，可以有 React/lucide。

```ts
export type ResourceEngine = {
  scheme: ResourceScheme
  kind: string
  layout: "fill" | "padded"
  icon: ComponentType<{ className?: string }>
  viewer?: LazyExoticComponent<ComponentType<{ resourceRef: ResourceRef }>>
  preview?: LazyExoticComponent<ComponentType<{ resourceRef: ResourceRef }>>
  actions?: (meta: ResourceMeta) => ResourceAction[]
}
```

边界：

- `protocol/resource.ts` 只放纯类型和纯函数。
- `vfs/*` 只放 provider 和数据获取逻辑。
- `workspace/resource-engines.tsx` 放 viewer/icon/layout/action UI。
- `workspace/registry.tsx` 只做 `resolveResourceEngine(ref)` 和 suspense/error boundary。
- `modules/*` 可以提供 viewer 组件，但不能成为 Resource 身份来源。

已有 `node-kind-ui.ts` 可作为 node scheme 的 engine 起点，后续升级为 `resource-engines.tsx`。

## 8. 权限与隐私

统一 Resource 后必须保留现有隐私闸：

- `node` provider 的 `list()` 默认只能返回 `stripNode()` 后的内容摘要。
- note/thread 正文读取需要 `read-content` capability，并继续受 `fs.notes:read` 或用户活动标签隐式同意控制。
- file blob 读取需要 `read-blob` capability，并继续受 `fs.blobs:read` 控制。
- `ResourceMeta` 不包含 note 正文、thread messages 或 blob bytes。
- agent 通过 Resource/VFS 访问时，仍走 `Grant -> MCP -> provider`，不得 import workspace store 或底层 store 绕过权限。
- 连接模式 provider 不暴露 ServerPort wire DTO，只返回领域 Resource。
- web 出站仍经 `egress-guard`，不因 `browser/page` Resource 绕过 SSRF 防护。

## 9. 分阶段落地

### 阶段 A：纯契约与注册表

新增：

- `src/protocol/resource.ts`
- `src/vfs/types.ts`
- `src/vfs/registry.ts`

验收：

- `resourceKey/parseResourceKey` 单测。
- provider 注册重复 scheme 报错。
- 无 UI 行为变化。

### 阶段 B：node provider

已新增 `src/vfs/node-provider.ts`，包装现有 `nodes-store`：

- `listNodeSummaries`
- `getNodeRaw`
- `createNode/updateNode/moveNode/deleteNode`
- `readBlobBase64`

验收：

- `node` Resource 能覆盖 note/file/bookmark/feed/thread。
- `stripNode` 与 `fs.notes:read` 测试继续通过。
- `openNodeTab` 行为不变。
- provider watch 基于 `onFilesUpdated` 通知 node query 失效。

### 阶段 C：OpenTarget

新增 `workspace/open-target.ts`，让侧栏、搜索、mobile drill bar 逐步调用 `openTarget()`。

验收：

- 旧 `openTab/openNodeTab` 仍可用。
- 旧 `?node=` 深链仍可刷新恢复。
- 新 `?resource=` 深链可打开 node Resource。

### 阶段 D：Display 消费 Resource

把 sidebar tree 的 `descriptor/nodeRef` 迁移为 `target: OpenTarget`，动态子项从 `ResourceMeta` 生成。连接模式 info/community 侧栏已从订阅 DTO 改为 VFS `listResources()`；resource 行携带 `ResourceMeta` 打开。

验收：

- Home places 展开结果不变。
- browser 书签导航保留原语义。
- agent workspace 静态树不受影响。
- sidebar 通过 `watchResources()` 监听 node/resource query，按 section 失效缓存。

### 阶段 E：连接 provider

已接入：

- `info-provider`
- `community-provider`
- `tool-provider`
- `browser-provider`
- `app-provider`

验收：

- 连接模式侧栏能用 ResourceMeta 表达 entity/peer/tool/browser/app。
- embed route 打开仍由 `requestEmbedRoute` 执行。
- 远端对象不会自动写入 `STORE_NODES`。
- `connected-resource-manifest.ts` 是 route/title/capability 的单一来源。
- `save-to-mine` action 由 provider 委托 projector，UI 不直接拼写 FilesPort 入参。

### 阶段 F：Resource Engine

已新增 `workspace/resource-engines.tsx`，把 node engine 与连接 engine 统一分派。

验收：

- `registry.tsx` 不再直接区分 node/remote 的 viewer 分派。
- `tabLayout()` 通过 engine 得到布局。
- 未注册 engine 有清晰 fallback。

### 阶段 G：清理旧兼容层

当所有调用迁完后再清理：

- `node-viewers.ts` re-export
- `home-sections.ts` re-export
- `descriptorForNode`
- 手写 NodeKind 到 section 的映射

删除前必须有全量测试和 hydration 兼容测试。

## 10. 测试矩阵

必测：

- Resource key encode/decode，包括 id 内含 `:`, `/`, `?`, `&`, `=`, Unicode。
- 非法 scheme/kind 拒收。
- provider registry 注册、重复注册、未知 scheme。
- node provider list/get/action/invoke。
- note/thread list 不泄正文。
- note/thread read 无权限返回 `consent-required`。
- file blob 无权限返回 `permission-denied`。
- `openTarget(resource)` 标签去重。
- 旧 `?node=` 与新 `?resource=` 深链。
- hydration 旧 `kind:"node"` 标签。
- save-to-mine 幂等投影。
- info/community provider 离线错误。
- embed route resource 不泄 ServerPort DTO。
- sidebar tree 从 ResourceMeta 构造。
- mobile drill bar 根据 ResourceRef 找回 fallback。
- VFS watch 通知 node/connected query 后显示缓存失效并重载。

每阶段最低验证：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## 11. 提交批次

建议批次：

1. `feat: add resource contracts and vfs registry`
2. `refactor: mount node resources through vfs`
3. `refactor: introduce open target dispatch`
4. `refactor: render workspace tree from resources`
5. `refactor: add connected resource providers`
6. `refactor: resolve tabs through resource engines`
7. `refactor: migrate home panels to resource hooks`
8. `chore: remove legacy node display shims`

每批只迁一个边界，保留旧入口薄包装，避免全仓一次性重排。

## 12. 成功标准

- 本地和连接模式都能用 `ResourceRef` 表示可打开对象。
- sidebar、search、tabs、mobile drill bar 都消费同一套 Resource/OpenTarget。
- 本地 `Node` 仍是唯一可同步、可墓碑删除、可恢复的文件实体。
- 远端 Resource 只有通过显式 `save-to-mine` 才投影成本地 Node。
- protocol/vfs/workspace 依赖方向不倒置。
- 隐私闸和现有 agent grant 语义不变。
