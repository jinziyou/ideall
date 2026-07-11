"use client"

// 工作区状态 (多标签 + 活动模块 + 二级侧栏折叠)。
// RTK slice (DevTools) + 薄 imperative facade (openTab / getActiveId 等端口不变)。
// 标签 keep-alive: tab-host 对激活 + 最近的重标签 (iframe/编辑器) 做 LRU 保持后台运行、非激活态 display:none
// (不重载); 超出上限的重标签可被卸载。dirty Engine 只有在声明可序列化且有身份绑定的
// session 快照后才参与逐出，不支持或暂存失败时继续保持挂载。轻标签全挂载。详见 tab-host.tsx。

import type { DevelopmentTool, ModuleId, Tab, TabDescriptor, WorkspaceKind, WsMode } from "./types"
import type { NodeRef } from "./node-ref"
import { tabKey } from "./tab-key"
import type { OpenTarget } from "./open-target"
import {
  isBrowserResourceTab,
  nodeResourceRefForTab,
  parseResourceTabParams,
  resourceTab,
} from "./resource-tab"
import { coerceActiveModuleForMode, moduleById, isModeNeutralModule } from "./modules"
import { isStaticTabKind } from "./tab-definitions"
import { isTauri, browserRelease } from "@/lib/tauri"
import { store, useAppSelector } from "@/lib/store"
import { workspaceActions, type ActiveSource, type WorkspaceState } from "./workspace-slice"
import { WORKSPACE_STORAGE_KEY } from "./workspace-persist"
import { setActiveWorkspace } from "@/plugins/agent/lib/agent-workspace"
import { requestEmbedRoute } from "@/plugins/embed/embed-nav"
import {
  coreFileRoot,
  coreFileRootForModule,
  coreFileRootMode,
  coerceCoreFileRootIdForMode,
  builtinAppSurfaceForLegacyPanel,
  mountedFileRootId,
} from "./file-roots"
import { statFile } from "@/filesystem/registry"
import { engineRegistry } from "@/engines/builtin"
import { enginePreferencesStorageKey, readEnginePreferences } from "@/engines/preferences"
import { openEngineWindow } from "@/lib/engine-window"
import { fileRefKey, sameFileRef, type FileRef } from "@protocol/file-system"
import { FILE_ENGINE_TAB_KIND, fileEngineTab, fileEngineTargetForTab } from "./file-tab"
import {
  aiTasksPanelFileRef,
  panelFileRef,
  panelForFile,
  resourceFileRef,
  resourceRefForFile,
} from "@/filesystem/resource-file-system"
import { DEFAULT_STARTUP_TARGET, readStartupTarget } from "./startup-target"
import { canOpenStandaloneWindow } from "./standalone-window-policy"
import { resolveWorkspaceEngine } from "./workspace-engine"
import { clearEngineSuspendSnapshot } from "./engine-suspension"
import {
  compatibilityFileForResource,
  inferredRootIdForFile,
  legacyResourceRootId,
  migrateWorkspaceTab,
  migrateWorkspaceTabs,
  validWorkspaceModule as validModule,
} from "./workspace-compat"
import {
  dirtyTabClosePolicy,
  evictColdTabs,
  planTabClose,
  planTransientTabOpen,
} from "./tab-lifecycle"
import { NavigationRequestCoordinator } from "./navigation-request-coordinator"

export type { ActiveSource }
export type { OpenTarget }
export { tabKey } from "./tab-key"
export { migrateWorkspaceTab, migrateWorkspaceTabs } from "./workspace-compat"

function ws(): WorkspaceState {
  return store.getState().workspace
}

function setState(patch: Partial<WorkspaceState>) {
  if (patch.tabs) {
    const nextIds = new Set(patch.tabs.map((tab) => tab.id))
    for (const tab of ws().tabs) {
      if (!nextIds.has(tab.id)) clearEngineSuspendSnapshot(tab.id)
    }
  }
  store.dispatch(workspaceActions.patch(patch))
}

function dirtySet(): Set<string> {
  return new Set(ws().dirtyTabs)
}

const fileOpenRequests = new NavigationRequestCoordinator()
const routeFileOpenRequests = new NavigationRequestCoordinator()
const workspaceEngineOpenRequests = new NavigationRequestCoordinator()

/** 模块 → 数据来源模式 (本地 / 连接)。仅在「显式模块导航」(活动栏 toggleModule) 时据此同步模式;
 *  打开/激活/关闭标签一律不翻 mode —— 否则点一个另一模式的标签会整排重构活动栏, 摧毁空间锚点
 *  (视图切换只归 ModeSwitch 与活动栏图标两个显式入口)。 */
const MODE_OF: Record<ModuleId, WsMode> = {
  home: "local",
  subscriptions: "local",
  apps: "local",
  plugins: "local",
  shell: "local",
  git: "local",
  database: "local",
  audio: "local",
  code: "local",
  trash: "local",
  tool: "connected",
  info: "connected",
  community: "connected",
  publications: "connected",
  browser: "connected",
  agent: "connected",
}

function validMode(value: unknown): WsMode {
  return value === "connected" || value === "local" ? value : "local"
}

function validWorkspaceKind(value: unknown): WorkspaceKind {
  return value === "audio" || value === "development" || value === "files" ? value : "files"
}

function validDevelopmentTool(value: unknown): DevelopmentTool {
  return value === "shell" || value === "git" ? value : "git"
}

type OpenTabOpts = { transient?: boolean }

function persist() {
  /* 持久化由 lib/store workspacePersistMiddleware 处理 (patch/hydrate 后触发)。 */
}

/** 客户端挂载后调用一次: 从本地存储恢复上次的标签 (sessionStorage 优先 = 本浏览器标签的会话现场;
 *  兜底 localStorage = 跨重启的最近一次快照, 桌面 App 重启 / 浏览器重开靠它恢复工作现场;
 *  新浏览器标签无 session 时会继承 localStorage 快照 —— 有意为之, 非 per-tab 隔离)。
 *  与路由标记的 openTab 顺序无关 (React 不保证父子 effect 顺序): 采用合并而非覆盖 ——
 *  历史标签在前, 本次会话已开的标签去重并入; 当前路由已设的激活标签优先。 */
export function hydrateWorkspace() {
  if (ws().hydrated || typeof window === "undefined") return
  let saved: {
    tabs: Tab[]
    activeId: string | null
    transientId: string | null
    activeModule: ModuleId
    activeRootId: string | null
    mode: WsMode
    workspaceKind: WorkspaceKind
    developmentTool: DevelopmentTool
    sidebarCollapsed: boolean
    rightPanelOpen: boolean
  } | null = null
  try {
    const raw =
      sessionStorage.getItem(WORKSPACE_STORAGE_KEY) ?? localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as {
        tabs?: Tab[]
        activeId?: string | null
        transientId?: string | null
        activeModule?: ModuleId
        activeRootId?: string
        mode?: WsMode
        workspaceKind?: WorkspaceKind
        developmentTool?: DevelopmentTool
        sidebarCollapsed?: boolean
        rightPanelOpen?: boolean
      }
      if (Array.isArray(p.tabs)) {
        saved = {
          tabs: p.tabs,
          activeId: p.activeId ?? null,
          transientId: p.transientId ?? null,
          activeModule: validModule(p.activeModule) ?? "home",
          activeRootId:
            typeof p.activeRootId === "string" && p.activeRootId ? p.activeRootId : null,
          mode: validMode(p.mode),
          workspaceKind: validWorkspaceKind(p.workspaceKind),
          developmentTool: validDevelopmentTool(p.developmentTool),
          sidebarCollapsed: p.sidebarCollapsed ?? false,
          rightPanelOpen: p.rightPanelOpen ?? false,
        }
      }
    }
  } catch {
    /* 损坏数据 → 忽略 */
  }
  if (saved) {
    const cur = ws()
    // 清洗: 丢弃 module 不在合法集合的污染/陈旧标签 (防下线某模块留僵尸标签);
    // 节点标签额外要求 params 能解析出合法 NodeRef (防下线某 kind / 损坏 params 留僵尸标签)。
    const { tabs: validTabs, idMap } = migrateWorkspaceTabs(saved.tabs)
    const merged = [...validTabs]
    for (const t of cur.tabs) if (!merged.some((x) => x.id === t.id)) merged.push(t)
    const savedActiveId = saved.activeId ? (idMap.get(saved.activeId) ?? saved.activeId) : null
    const wantId = cur.activeId ?? savedActiveId
    const activeTab = wantId ? (merged.find((x) => x.id === wantId) ?? null) : null
    const savedTransientId = saved.transientId
      ? (idMap.get(saved.transientId) ?? saved.transientId)
      : null
    const aiActive = activeTab?.module === "agent"
    const requestedRootId =
      cur.activeId && activeTab
        ? cur.activeRootId
        : (saved.activeRootId ?? activeTab?.rootId ?? coreFileRootForModule(saved.activeModule).id)
    const activeRootId = coerceCoreFileRootIdForMode(requestedRootId, saved.mode)
    store.dispatch(
      workspaceActions.hydrate({
        tabs: merged,
        activeId: activeTab ? activeTab.id : null,
        transientId:
          savedTransientId && merged.some((t) => t.id === savedTransientId)
            ? savedTransientId
            : null,
        lru: activeTab ? [activeTab.id] : [],
        activeSource: "user",
        activeModule: aiActive
          ? saved.activeModule
          : activeTab
            ? coerceActiveModuleForMode(activeTab.module, saved.mode, saved.activeModule)
            : cur.activeId
              ? coerceActiveModuleForMode(cur.activeModule, saved.mode, saved.activeModule)
              : coerceActiveModuleForMode(saved.activeModule, saved.mode),
        activeRootId,
        mode: saved.mode,
        workspaceKind: saved.workspaceKind,
        developmentTool: saved.developmentTool,
        sidebarCollapsed: saved.sidebarCollapsed,
        rightPanelOpen: saved.rightPanelOpen,
      }),
    )
  } else {
    store.dispatch(workspaceActions.hydrate({}))
  }
  if (isTauri()) {
    const { tabs, activeId } = store.getState().workspace
    const active = tabs.find((t) => t.id === activeId)
    if (!active || !isBrowserResourceTab(active)) void browserRelease().catch(() => {})
  }
}

// —— 动作 ——

/** 切离「浏览器」标签时收起原生子 webview, 避免其叠在插件 iframe 上拦截点击。 */
function hideBrowserWebviewUnlessBrowserTab(tab: Pick<TabDescriptor, "kind" | "params">) {
  if (isBrowserResourceTab(tab)) return
  if (isTauri()) void browserRelease().catch(() => {})
}

/** 打开 (或激活已存在的) 标签, 并把活动模块同步到该标签所属模块 (驱动活动栏高亮 / 侧栏)。
 *  不翻 mode 视图 (打开标签是内容导航, 不是视图切换; 见 MODE_OF 注释)。
 *  source 默认 user (UI/路由触发); agent 经 ui.openTab 打开时传 "agent" —— 仅影响隐式同意, 不改打开行为。
 *  opts.transient=true → 预览标签 (复用单一预览槽: 轻底/淡色点/标题点线下划线); 缺省 = 常驻打开
 *  (若命中当前预览槽则提升为常驻)。新增常驻标签超过软上限时自动回收最久未用的冷标签。 */
export function openTab(d: TabDescriptor, source: ActiveSource = "user", opts?: OpenTabOpts) {
  invalidatePendingFileOpen()
  // 旧模块配置仍可能交出 Resource descriptor；统一入口在运行期立即折叠为
  // FileRef + Engine，保证任何 UI 路径都不会重新制造第二套标签身份。
  if (d.kind === "resource") {
    const ref = parseResourceTabParams(d.params)
    if (ref) {
      openTarget({ type: "resource", ref, title: d.title, transient: opts?.transient }, source)
      return
    }
  }
  // 旧 UI port 仍可能交出 static descriptor；立即迁移成 panel/resource File + Engine，
  // 避免运行期重新创建绕过统一身份的标签。
  if (isStaticTabKind(d.kind)) {
    const migrated = migrateWorkspaceTab({ ...d, id: tabKey(d) })
    if (migrated && migrated.kind === FILE_ENGINE_TAB_KIND) {
      openTab(migrated, source, opts)
      return
    }
  }
  hideBrowserWebviewUnlessBrowserTab(d)
  const id = tabKey(d)
  const activeRootId = coerceCoreFileRootIdForMode(
    d.rootId ?? coreFileRootForModule(d.module).id,
    ws().mode,
    ws().activeRootId,
  )
  if (opts?.transient) {
    setState({
      ...planTransientTabOpen(ws().tabs, ws().transientId, d),
      activeModule: coerceActiveModuleForMode(d.module, ws().mode, ws().activeModule),
      activeRootId,
      activeSource: source,
    })
    return
  }
  const exists = ws().tabs.some((t) => t.id === id)
  const tabs = exists
    ? ws().tabs
    : evictColdTabs({
        tabs: [...ws().tabs, { ...d, id }],
        transientId: ws().transientId,
        lru: ws().lru,
        dirtyIds: dirtySet(),
        protectedIds: new Set([id]),
      })
  setState({
    tabs,
    // 显式 (非瞬态) 打开命中当前预览槽 → 提升为常驻。
    transientId: ws().transientId === id ? null : ws().transientId,
    activeId: id,
    activeModule: coerceActiveModuleForMode(d.module, ws().mode, ws().activeModule),
    activeRootId,
    activeSource: source,
  })
}

/** 把预览标签提升为常驻 (双击标签条/侧栏行调用); 非当前预览标签则忽略。 */
export function promoteTab(id: string) {
  if (ws().transientId !== id) return
  setState({ transientId: null })
}

/** 若当前激活标签正是预览标签, 提升为常驻 (供「编辑即固定」: 内容编辑器首次编辑时调用, 避免改到一半被下次预览替换)。 */
export function promoteActiveTab() {
  if (ws().activeId && ws().activeId === ws().transientId) {
    setState({ transientId: null })
  }
}

/** 打开全局设置标签 (外观 / 本机 / 已连接应用)。 */
export function openSettings() {
  openTarget({ type: "file", ref: panelFileRef("settings"), rootId: "system" })
}

/** AI 管理标签 = 全局 AI 设置 (次级入口: 右栏齿轮 / /ai 深链 / ui-actions 端口)。
 *  AI 主入口是对话: 顶栏 AI 钮与移动中央 AI 钮均呼出右侧对话栏 (toggleRightPanel / setRightPanel)。 */
export function openAiSettings(opts?: OpenTabOpts) {
  setState({ activeModule: "agent", sidebarCollapsed: true })
  openTarget({
    type: "file",
    ref: panelFileRef("ai-settings"),
    rootId: "workspace",
    transient: opts?.transient,
  })
}

/** 打开 AI 区段管理标签 (MCP / Skills / 规则)。 */
export function openAiSection(kind: "ai-mcp" | "ai-skills" | "ai-rules", opts?: OpenTabOpts) {
  setState({ activeModule: "agent", sidebarCollapsed: true })
  openTarget({
    type: "file",
    ref: panelFileRef(kind),
    rootId: "workspace",
    transient: opts?.transient,
  })
}

/** 打开某工作区的任务文件；FileRef 仅编码 workspaceId，标题不参与身份。 */
export function openAiTasks(workspaceId: string, title: string, opts?: OpenTabOpts) {
  const ref = aiTasksPanelFileRef(workspaceId)
  setActiveWorkspace(workspaceId)
  setState({ activeModule: "agent", sidebarCollapsed: true })
  openTarget({
    type: "file",
    ref,
    title,
    rootId: "workspace",
    transient: opts?.transient,
  })
}

function requestConnectedEmbedRoute(meta: { ref: OpenTargetResourceRef; route?: string }) {
  const { ref, route } = meta
  if (!route || (ref.scheme !== "info" && ref.scheme !== "community")) return
  requestEmbedRoute(ref.scheme, route)
}

type OpenTargetResourceRef = Extract<OpenTarget, { type: "resource" }>["ref"]

async function refreshResourceTarget(target: Extract<OpenTarget, { type: "resource" }>) {
  try {
    const fileRef = resourceFileRef(target.ref)
    const file = target.meta
      ? null
      : await statFile(fileRef, { actor: "ui", permissions: [], intent: "metadata" })
    const title = target.meta?.title ?? file?.name
    if (!title) return
    const refKey = fileRefKey(fileRef)
    const tabs = ws().tabs.map((tab) => {
      const opened = fileEngineTargetForTab(tab)
      return opened && fileRefKey(opened.ref) === refKey && tab.title !== title
        ? { ...tab, title }
        : tab
    })
    if (tabs.some((tab, index) => tab !== ws().tabs[index])) setState({ tabs })
    requestConnectedEmbedRoute({
      ref: target.ref,
      route:
        target.meta?.route ??
        (typeof file?.properties?.route === "string" ? file.properties.route : undefined),
    })
  } catch {
    /* 兼容文件标签已打开；元数据暂不可用时保留调用者提供的标题。 */
  }
}

function invalidatePendingFileOpen(): void {
  fileOpenRequests.invalidate()
}

async function openFileTarget(
  target: Extract<OpenTarget, { type: "file" }>,
  source: ActiveSource,
  shouldCommit?: () => boolean,
): Promise<boolean> {
  const legacySurface = builtinAppSurfaceForLegacyPanel(target.ref)
  if (legacySurface) {
    target = {
      ...target,
      ref: legacySurface.ref,
      file: undefined,
      engineId: legacySurface.engineId,
      rootId: mountedFileRootId(legacySurface.ref),
    }
  }
  const request = fileOpenRequests.begin()
  const canCommit = () => request.isCurrent() && (shouldCommit?.() ?? true)
  // 先声明本次导航的空间锚点，再异步读取文件。完成时下方会再次核对：若用户
  // 已切到别的根，旧请求就安静失效；若仍在此根，深链/活动栏请求可以正常打开。
  const navigationRootId = target.rootId
    ? coerceCoreFileRootIdForMode(target.rootId, ws().mode, ws().activeRootId)
    : undefined
  if (navigationRootId) setState({ activeRootId: navigationRootId })
  try {
    const hintedFile = target.file && sameFileRef(target.file.ref, target.ref) ? target.file : null
    const file =
      target.display !== "window" && hintedFile
        ? hintedFile
        : await statFile(target.ref, {
            actor: "ui",
            permissions: [],
            intent: "metadata",
          })
    if (!file) return false
    if (!canCommit()) return false
    // stat 可能跨越工作区切换；无显式 Engine 时必须按“现在”的场景解析，不能使用
    // 请求发起前捕获的旧工作区偏好。
    const resolutionWorkspaceKind = ws().workspaceKind
    const candidates = engineRegistry.matching(file)
    const requested = target.engineId
      ? candidates.find((candidate) => candidate.descriptor.engineId === target.engineId)
      : undefined
    const preferences = readEnginePreferences(
      typeof window === "undefined" ? undefined : window.localStorage,
      enginePreferencesStorageKey(resolutionWorkspaceKind),
    )
    const resolved =
      requested ??
      resolveWorkspaceEngine(
        file,
        resolutionWorkspaceKind,
        candidates,
        engineRegistry.resolve(file, preferences),
      )
    if (!resolved) return false
    // 文件 stat / 引擎解析是异步的；用户已切到别的根时丢弃旧点击结果，避免活动栏回跳。
    if (navigationRootId && ws().activeRootId !== navigationRootId) return false
    const engineId = resolved.descriptor.engineId
    if (target.display === "window") {
      if (!canOpenStandaloneWindow(file, resolved.descriptor)) return false
      await openEngineWindow(fileRefKey(file.ref), engineId)
      return true
    }
    const provisional = fileEngineTab({ ref: file.ref, name: target.title || file.name }, engineId)
    const existingRootId = ws().tabs.find((tab) => tab.id === tabKey(provisional))?.rootId
    const rootId = target.rootId ?? existingRootId ?? inferredRootIdForFile(file.ref)
    openTab(
      fileEngineTab(
        { ref: file.ref, name: target.title || file.name },
        engineId,
        rootId ? { rootId } : {},
      ),
      source,
      { transient: target.transient },
    )
    if (rootId) {
      setState({
        activeRootId: coerceCoreFileRootIdForMode(rootId, ws().mode, ws().activeRootId),
      })
    }
    return true
  } catch {
    /* 文件卸载、权限或窗口创建失败时保留当前工作区，不制造损坏标签。 */
    return false
  }
}

/**
 * 路由专用的可等待文件打开：为 UrlSync 暴露实时 pending 状态，并用递增令牌
 * 取消已离开的旧深链，避免异步 stat 完成后把用户拉回上一条 URL。
 */
export async function openRouteFileTarget(
  target: Extract<OpenTarget, { type: "file" }>,
  source: ActiveSource = "user",
): Promise<boolean> {
  const request = routeFileOpenRequests.begin()
  setState({ routeOpenPending: true })
  try {
    return await openFileTarget(target, source, request.isCurrent)
  } finally {
    if (request.isCurrent()) setState({ routeOpenPending: false })
  }
}

export function cancelRouteFileOpen(): void {
  routeFileOpenRequests.invalidate()
  if (ws().routeOpenPending) setState({ routeOpenPending: false })
}

/** 首次启动或恢复目标失效时打开用户配置；最终总是回退 Home。 */
export async function openStartupTarget(transient = false): Promise<boolean> {
  const configured = readStartupTarget(
    typeof window === "undefined" ? undefined : window.localStorage,
  )
  if (configured.rootId) {
    setState({
      activeRootId: coerceCoreFileRootIdForMode(configured.rootId, ws().mode, ws().activeRootId),
    })
  }
  if (await openFileTarget({ type: "file", ...configured, transient }, "user")) {
    return true
  }
  if (
    configured.ref.fileSystemId === DEFAULT_STARTUP_TARGET.ref.fileSystemId &&
    configured.ref.fileId === DEFAULT_STARTUP_TARGET.ref.fileId &&
    configured.engineId === DEFAULT_STARTUP_TARGET.engineId
  ) {
    return false
  }
  setState({ activeRootId: DEFAULT_STARTUP_TARGET.rootId ?? "home" })
  return openFileTarget(
    { type: "file", ...DEFAULT_STARTUP_TARGET, transient, rootId: "home" },
    "user",
  )
}

/** 统一打开入口: ResourceRef 只作为兼容输入，立即投影为 File 后交给引擎解析。 */
export function openTarget(target: OpenTarget, source: ActiveSource = "user"): boolean {
  switch (target.type) {
    case "tab":
      openTab(target.descriptor, source, { transient: target.transient })
      return true
    case "resource": {
      const file = compatibilityFileForResource(target)
      // target.file 使 openFileTarget 在首次 await 之前完成标签激活，保留旧同步 API 的手感；
      // 标签身份与后续文件入口完全一致，且默认引擎仍经过用户偏好解析。
      void openFileTarget(
        {
          type: "file",
          ref: file.ref,
          file,
          transient: target.transient,
          rootId: legacyResourceRootId(target.ref),
        },
        source,
      )
      void refreshResourceTarget(target)
      return true
    }
    case "file":
      void openFileTarget(target, source)
      return true
    case "command":
      invalidatePendingFileOpen()
      if (target.command === "open-ai-panel") setRightPanel(true)
      else toggleRightPanel()
      return true
  }
}

/**
 * @deprecated 仅保留给旧端口/插件兼容；新代码应直接调用 openTarget({ type:"file" })。
 * 打开 (或激活已存在的) 一个节点标签。AI (boot.ts 的 ui.openTab) 传 source="agent" ——
 * 该节点不计入「打开即隐式同意」(隐私)。
 */
export function openNodeTab(
  ref: NodeRef,
  title: string,
  source: ActiveSource = "user",
  opts?: OpenTabOpts,
) {
  openTarget(
    {
      type: "file",
      ref: resourceFileRef({ scheme: "node", ...ref }),
      title,
      transient: opts?.transient,
      rootId: legacyResourceRootId({ scheme: "node", ...ref }),
    },
    source,
  )
}

/** 节点标签取数后回填真实标题 (不改 id / 去重 key, 仅更新显示)。 */
export function renameNodeTab(ref: NodeRef, title: string) {
  const id = tabKey(resourceTab({ scheme: "node", ...ref }, title))
  const matches = (tab: Tab) => {
    if (tab.id === id) return true
    const fileTarget = fileEngineTargetForTab(tab)
    const resource = fileTarget ? resourceRefForFile(fileTarget.ref) : null
    return resource?.scheme === "node" && resource.kind === ref.kind && resource.id === ref.id
  }
  if (!ws().tabs.some(matches)) return
  setState({ tabs: ws().tabs.map((tab) => (matches(tab) ? { ...tab, title } : tab)) })
}

/** 删除节点后关闭它的全部引擎视图以及旧 Resource 兼容标签。 */
export function closeNodeTabs(ref: NodeRef) {
  const ids = ws().tabs.flatMap((tab) => {
    const legacy = nodeResourceRefForTab(tab)
    const fileTarget = fileEngineTargetForTab(tab)
    const resource = fileTarget ? resourceRefForFile(fileTarget.ref) : null
    return (legacy?.kind === ref.kind && legacy.id === ref.id) ||
      (resource?.scheme === "node" && resource.kind === ref.kind && resource.id === ref.id)
      ? [tab.id]
      : []
  })
  for (const id of ids) closeTab(id)
}

/** 关闭同一文件通过任意引擎打开的全部 Display。 */
export function closeFileTabs(ref: FileRef) {
  const key = fileRefKey(ref)
  const ids = ws().tabs.flatMap((tab) => {
    const target = fileEngineTargetForTab(tab)
    return target && fileRefKey(target.ref) === key ? [tab.id] : []
  })
  for (const id of ids) closeTab(id)
}

/** 标记标签存在未保存草稿。关闭前仍会二次确认；已持久化休眠快照的内容可按 LRU 卸载。 */
export function setTabDirty(id: string, dirty: boolean) {
  if (!ws().tabs.some((t) => t.id === id)) return
  const next = dirtySet()
  if (dirty) next.add(id)
  else next.delete(id)
  const dirtyTabs = [...next]
  if (
    dirtyTabs.length === ws().dirtyTabs.length &&
    dirtyTabs.every((x, i) => x === ws().dirtyTabs[i])
  )
    return
  setState({ dirtyTabs })
}

/** Renderer 仅在完整快照已成功写入有界会话存储后设置 true。 */
export function setTabSuspendReady(id: string, ready: boolean) {
  if (!ws().tabs.some((tab) => tab.id === id)) return
  const next = new Set(ws().suspendReadyTabs)
  if (ready) next.add(id)
  else next.delete(id)
  const suspendReadyTabs = [...next]
  if (
    suspendReadyTabs.length === ws().suspendReadyTabs.length &&
    suspendReadyTabs.every((value, index) => value === ws().suspendReadyTabs[index])
  ) {
    return
  }
  setState({ suspendReadyTabs })
}

export function isTabDirty(id: string): boolean {
  return ws().dirtyTabs.includes(id)
}

export type DirtyTabCloseRequest = {
  title: string
  description: string
  confirmLabel: string
  ids: string[]
  confirm: () => void
}

const dirtyTabCloseListeners = new Set<(request: DirtyTabCloseRequest) => void>()

export function subscribeDirtyTabCloseRequests(
  listener: (request: DirtyTabCloseRequest) => void,
): () => void {
  dirtyTabCloseListeners.add(listener)
  return () => {
    dirtyTabCloseListeners.delete(listener)
  }
}

function dirtyCloseRequest(ids: string[], confirm: () => void): DirtyTabCloseRequest | null {
  const policy = dirtyTabClosePolicy(ws().tabs, dirtySet(), ids)
  return policy ? { ...policy, confirm } : null
}

function requestDirtyClose(ids: string[], confirm: () => void): boolean {
  const request = dirtyCloseRequest(ids, confirm)
  if (!request) return true
  for (const listener of dirtyTabCloseListeners) listener(request)
  return false
}

/** 关闭标签; 若关的是激活项, 焦点转移到相邻标签。 */
export function closeTab(id: string) {
  invalidatePendingFileOpen()
  const plan = planTabClose(ws().tabs, ws().activeId, ws().transientId, id)
  if (!plan) return
  if (isBrowserResourceTab(plan.closingTab) && isTauri()) {
    void browserRelease().catch(() => {})
  }
  let activeModule = ws().activeModule
  let activeRootId = ws().activeRootId
  if (plan.activeChanged) {
    const next = plan.nextActiveTab
    // 焦点转移到相邻标签时同步活动模块 (否则活动栏/侧栏会停在旧模块); mode 不随标签翻转。
    if (next) {
      hideBrowserWebviewUnlessBrowserTab(next)
      activeModule = coerceActiveModuleForMode(next.module, ws().mode, activeModule)
      activeRootId = coerceCoreFileRootIdForMode(
        next.rootId ?? coreFileRootForModule(next.module).id,
        ws().mode,
        activeRootId,
      )
    }
  }
  setState({
    tabs: plan.tabs,
    activeId: plan.activeId,
    activeModule,
    activeRootId,
    transientId: plan.transientId,
    activeSource: "user",
  })
}

/** UI 关闭标签入口: dirty 标签先确认; 返回是否真的关闭。 */
export function requestCloseTab(id: string): boolean {
  if (!requestDirtyClose([id], () => closeTab(id))) return false
  closeTab(id)
  return true
}

/** 关闭全部标签。 */
export function closeAllTabs() {
  invalidatePendingFileOpen()
  if (ws().tabs.length === 0) return
  if (isTauri()) void browserRelease().catch(() => {})
  setState({
    tabs: [],
    activeId: null,
    transientId: null,
    activeSource: "user",
  })
}

export function requestCloseAllTabs(): boolean {
  if (
    !requestDirtyClose(
      ws().tabs.map((t) => t.id),
      closeAllTabs,
    )
  )
    return false
  closeAllTabs()
  return true
}

/** 关闭除 keepId 外的全部标签。 */
export function closeOtherTabs(keepId: string) {
  invalidatePendingFileOpen()
  const keep = ws().tabs.find((t) => t.id === keepId)
  if (!keep) return
  hideBrowserWebviewUnlessBrowserTab(keep)
  setState({
    tabs: [keep],
    activeId: keepId,
    activeModule: coerceActiveModuleForMode(keep.module, ws().mode, ws().activeModule),
    activeRootId: coerceCoreFileRootIdForMode(
      keep.rootId ?? coreFileRootForModule(keep.module).id,
      ws().mode,
      ws().activeRootId,
    ),
    transientId: ws().transientId === keepId ? keepId : null,
    activeSource: "user",
  })
}

export function requestCloseOtherTabs(keepId: string): boolean {
  if (
    !requestDirtyClose(
      ws()
        .tabs.filter((t) => t.id !== keepId)
        .map((t) => t.id),
      () => closeOtherTabs(keepId),
    )
  )
    return false
  closeOtherTabs(keepId)
  return true
}

export function setActiveTab(id: string) {
  invalidatePendingFileOpen()
  const t = ws().tabs.find((x) => x.id === id)
  if (!t) return
  hideBrowserWebviewUnlessBrowserTab(t)
  // 激活标签不翻 mode 视图; activeModule 只作为左侧导航/侧栏锚点, 需收束在当前 mode 可见范围内。
  // 用户主动点标签 = 用户在看它 → 来源 user (即便它原是 agent 经 ui.openTab 开的, 用户点回即视作同意)。
  setState({
    activeId: id,
    activeModule: coerceActiveModuleForMode(t.module, ws().mode, ws().activeModule),
    activeRootId: coerceCoreFileRootIdForMode(
      t.rootId ?? coreFileRootForModule(t.module).id,
      ws().mode,
      ws().activeRootId,
    ),
    activeSource: "user",
  })
}

/**
 * 选择合成根下的直接子树。活动栏只改变文件树锚点；若该根有默认文件，使用
 * 单一预览槽打开，避免浏览根目录时持续堆积标签。
 */
export function toggleFileRoot(rootId: string) {
  invalidatePendingFileOpen()
  const root = coreFileRoot(rootId)
  const mode = coreFileRootMode(root, ws().mode)
  if (ws().activeRootId === root.id && ws().mode === mode && !ws().sidebarCollapsed) {
    setState({ sidebarCollapsed: true })
    return
  }
  setState({
    activeRootId: root.id,
    activeModule: root.module,
    mode,
    sidebarCollapsed: false,
    activeSource: "user",
  })
  if (root.defaultFile) {
    void openFileTarget(
      { type: "file", ref: root.defaultFile, transient: true, rootId: root.id },
      "user",
    )
  }
}

export function toggleMountedFileRoot(ref: FileRef) {
  invalidatePendingFileOpen()
  const rootId = mountedFileRootId(ref)
  if (ws().activeRootId === rootId && !ws().sidebarCollapsed) {
    setState({ sidebarCollapsed: true })
    return
  }
  setState({
    activeRootId: rootId,
    activeModule: "home",
    sidebarCollapsed: false,
    activeSource: "user",
  })
  void openFileTarget({ type: "file", ref, transient: true, rootId }, "user")
}

/** 点活动栏图标: 同模块且侧栏展开 → 收起侧栏; 否则切到该模块、展开侧栏, 并以「预览」方式开其首个面板。 */
export function toggleModule(m: ModuleId) {
  invalidatePendingFileOpen()
  if (ws().activeModule === m && !ws().sidebarCollapsed) {
    setState({ sidebarCollapsed: true })
    return
  }
  const mod = moduleById(m)
  const first = mod.entries[0]
  // mode-中性模块 (跨模式工具): 切到它不翻视图; 否则同步到该模块所属模式。
  const mode = isModeNeutralModule(m) ? ws().mode : MODE_OF[m]
  if (!first || m === "plugins") {
    setState({ activeModule: m, mode, sidebarCollapsed: false })
    return
  }
  const descriptor = migrateWorkspaceTab({ ...first.descriptor, id: tabKey(first.descriptor) })
  if (!descriptor) {
    setState({ activeModule: m, mode, sidebarCollapsed: false })
    return
  }
  hideBrowserWebviewUnlessBrowserTab(descriptor)
  // 切模块进来的落地面板用「预览」方式开: 点遍多个模块只复用单一预览槽, 不再每切一个就堆一个常驻标签。
  setState({
    ...planTransientTabOpen(ws().tabs, ws().transientId, descriptor),
    activeModule: m,
    activeRootId: coerceCoreFileRootIdForMode(
      descriptor.rootId ?? coreFileRootForModule(m).id,
      mode,
    ),
    mode,
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

/**
 * 切换 Display 工作区组合。已有标签和文件身份保持不变；若当前标签是文件，则按新工作区的
 * 偏好/场景策略激活同一 FileRef 的对应 Engine 标签。旧 Engine 标签仍保留，因此脏草稿不会
 * 因切换工作区被替换或卸载。
 */
export function setWorkspaceKind(workspaceKind: WorkspaceKind) {
  invalidatePendingFileOpen()
  if (workspaceKind === ws().workspaceKind) return
  const currentTab = ws().tabs.find((tab) => tab.id === ws().activeId)
  const currentFile = fileEngineTargetForTab(currentTab)
  const request = workspaceEngineOpenRequests.begin()
  setState({ workspaceKind })
  if (!currentFile || !currentTab) return

  void openFileTarget(
    {
      type: "file",
      ref: currentFile.ref,
      title: currentTab.title,
      rootId: currentTab.rootId,
      // 场景切换是显式导航：新 Engine 标签不复用全局预览槽，否则活动文件恰为
      // transient 时会原地替换旧 Engine 标签，违背“保留既有视图”的语义。
      transient: false,
    },
    "user",
    () =>
      request.isCurrent() &&
      ws().workspaceKind === workspaceKind &&
      ws().activeId === currentTab.id,
  )
}

/** 选择开发工作区的辅助工具；选择本身不隐式切换工作区。 */
export function setDevelopmentTool(developmentTool: DevelopmentTool) {
  if (developmentTool !== ws().developmentTool) setState({ developmentTool })
}

/** 切换数据来源模式 (本地 / 连接): 活动模块归到该模式首个模块, 展开侧栏并以预览方式开其落地面板。
 *  已是该模式则无操作 (点已激活的分段不打扰当前标签)。 */
export function setMode(mode: WsMode) {
  invalidatePendingFileOpen()
  if (mode === ws().mode) {
    const activeModule = coerceActiveModuleForMode(ws().activeModule, mode)
    const activeRootId = coerceCoreFileRootIdForMode(ws().activeRootId, mode)
    if (activeModule !== ws().activeModule || activeRootId !== ws().activeRootId) {
      setState({ activeModule, activeRootId })
    }
    return
  }
  cancelRouteFileOpen()
  const firstModule: ModuleId = mode === "local" ? "home" : "info"
  const mod = moduleById(firstModule)
  const first = mod.entries[0]
  if (!first) {
    setState({ mode, activeModule: firstModule, sidebarCollapsed: false, activeSource: "user" })
    return
  }
  const descriptor = migrateWorkspaceTab({ ...first.descriptor, id: tabKey(first.descriptor) })
  if (!descriptor) {
    setState({ mode, activeModule: firstModule, sidebarCollapsed: false, activeSource: "user" })
    return
  }
  hideBrowserWebviewUnlessBrowserTab(descriptor)
  setState({
    ...planTransientTabOpen(ws().tabs, ws().transientId, descriptor),
    mode,
    activeModule: firstModule,
    activeRootId: coerceCoreFileRootIdForMode(
      descriptor.rootId ?? coreFileRootForModule(firstModule).id,
      mode,
    ),
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

export function setSidebarCollapsed(v: boolean) {
  setState({ sidebarCollapsed: v })
}

/** 切换左侧二级侧栏显隐 (顶栏布局开关)。 */
export function toggleSidebar() {
  setState({ sidebarCollapsed: !ws().sidebarCollapsed })
}

/** 兼容入口：展开 AI 管理侧栏 (MCP / Skills / 智能体任务等)。 */
export function toggleWorkspace() {
  if (ws().activeModule === "agent" && !ws().sidebarCollapsed) {
    setState({ sidebarCollapsed: true })
    return
  }
  setState({
    activeModule: "agent",
    sidebarCollapsed: false,
    activeSource: "user",
  })
}

/** 右侧 AI 对话栏开关 (顶栏 AI 钮 / 移动底栏中央 AI 钮)。 */
export function toggleRightPanel() {
  setState({ rightPanelOpen: !ws().rightPanelOpen })
}
export function setRightPanel(v: boolean) {
  setState({ rightPanelOpen: v })
}

/** 拖拽重排: 把 fromId 移动到 toId 的位置。 */
export function reorderTabs(fromId: string, toId: string) {
  const from = ws().tabs.findIndex((t) => t.id === fromId)
  const to = ws().tabs.findIndex((t) => t.id === toId)
  if (from === -1 || to === -1 || from === to) return
  const tabs = [...ws().tabs]
  const [moved] = tabs.splice(from, 1)
  tabs.splice(to, 0, moved)
  setState({ tabs })
}

// —— 键盘导航动作 (全局快捷键 / 命令面板共用) ——

/** 关闭当前激活标签 (mod+W)。无激活标签时无操作。 */
export function closeActiveTab() {
  const id = ws().activeId
  if (id) closeTab(id)
}

export function requestCloseActiveTab(): boolean {
  const id = ws().activeId
  if (!id) return true
  return requestCloseTab(id)
}

/** 按标签条顺序激活相邻标签 (Ctrl+Tab / Ctrl+PgUp/PgDn), 首尾循环。 */
export function activateAdjacentTab(delta: 1 | -1) {
  const n = ws().tabs.length
  if (n === 0) return
  const cur = ws().tabs.findIndex((t) => t.id === ws().activeId)
  const next = ws().tabs[(cur === -1 ? 0 : cur + delta + n) % n]
  setActiveTab(next.id)
}

/** 激活第 N 个标签 (mod+1..9; 浏览器惯例: 9 = 最后一个)。 */
export function activateTabAt(index: number) {
  const n = ws().tabs.length
  if (n === 0 || index < 1) return
  const t = index >= 9 ? ws().tabs[n - 1] : ws().tabs[index - 1]
  if (t) setActiveTab(t.id)
}

// —— hooks (RTK useAppSelector) ——

export function useTabs() {
  return useAppSelector((s) => s.workspace.tabs)
}
export function useActiveId() {
  return useAppSelector((s) => s.workspace.activeId)
}

/** 当前预览/瞬态标签 id (标签条斜体显示用); 无预览标签 → null。 */
export function useTransientId() {
  return useAppSelector((s) => s.workspace.transientId)
}

export function useDirtyTabIds() {
  return useAppSelector((s) => s.workspace.dirtyTabs)
}

export function useSuspendReadyTabIds() {
  return useAppSelector((s) => s.workspace.suspendReadyTabs)
}

/** 当前激活标签的 kind (活动栏 AI 固定钮高亮用); 无激活标签 → null。 */
export function useActiveTabKind(): string | null {
  return useAppSelector(
    (s) => s.workspace.tabs.find((t) => t.id === s.workspace.activeId)?.kind ?? null,
  )
}

/** 当前激活的 ai-tasks 标签所属工作区 id (AI 侧栏高亮用); 否则 null。 */
export function useActiveWorkspaceId(): string | null {
  return useAppSelector((s) => {
    const t = s.workspace.tabs.find((x) => x.id === s.workspace.activeId)
    if (t?.kind === "ai-tasks") return t.params?.workspaceId ?? null
    const target = fileEngineTargetForTab(t)
    if (!target) return null
    const panel = panelForFile(target.ref)
    return panel?.tabKind === "ai-tasks" ? (panel.params?.workspaceId ?? null) : null
  })
}
export function useActiveModule() {
  return useAppSelector((s) => s.workspace.activeModule)
}
export function useActiveRootId() {
  return useAppSelector((s) => s.workspace.activeRootId)
}
export function useMode() {
  return useAppSelector((s) => s.workspace.mode)
}
export function useWorkspaceKind() {
  return useAppSelector((s) => s.workspace.workspaceKind)
}
export function useDevelopmentTool() {
  return useAppSelector((s) => s.workspace.developmentTool)
}
export function useSidebarCollapsed() {
  return useAppSelector((s) => s.workspace.sidebarCollapsed)
}
export function useRightPanelOpen() {
  return useAppSelector((s) => s.workspace.rightPanelOpen)
}
export function useHydrated() {
  return useAppSelector((s) => s.workspace.hydrated)
}
export function useRouteOpenPending() {
  return useAppSelector((s) => s.workspace.routeOpenPending)
}

/** 标签访问序 (LRU, 最近激活在末尾)。⌘K「打开的标签」按最近优先排序用。 */
export function useLru() {
  return useAppSelector((s) => s.workspace.lru)
}

/** 非响应式实时读取 (effect 内用): 拿 store 当前快照, 而非组件渲染闭包里的旧值。 */
export function getActiveId(): string | null {
  return ws().activeId
}
/** 当前预览/瞬态标签 id 的实时快照 (effect / 测试用)。 */
export function getTransientId(): string | null {
  return ws().transientId
}
/** 当前数据来源模式的实时快照 (effect / 测试用)。 */
export function getMode(): WsMode {
  return ws().mode
}
export function getWorkspaceKind(): WorkspaceKind {
  return ws().workspaceKind
}
export function getDevelopmentTool(): DevelopmentTool {
  return ws().developmentTool
}
/** 当前左侧导航/侧栏模块的实时快照 (effect / 测试用)。 */
export function getActiveModule(): ModuleId {
  return ws().activeModule
}
export function getActiveRootId(): string {
  return ws().activeRootId
}
/** 当前激活节点的激活来源 (user / agent)。隐私: active-node 端口对 agent 自激活的节点返回 null, 不计入隐式同意。 */
export function getActiveSource(): ActiveSource {
  return ws().activeSource
}
export function getTabs(): Tab[] {
  return ws().tabs
}
export function getRouteOpenPending(): boolean {
  return ws().routeOpenPending
}
