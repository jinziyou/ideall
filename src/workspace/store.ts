"use client"

// 工作区状态 (多标签 + 活动模块 + 二级侧栏折叠)。
// RTK slice (DevTools) + 薄 imperative facade (openTab / getActiveId 等端口不变)。
// 标签 keep-alive: tab-host 对激活 + 最近的重标签 (iframe/编辑器) 做 LRU 保持后台运行、非激活态 display:none
// (不重载); 超出上限的重标签被卸载 (草稿由写队列落盘)。轻标签全挂载。详见 tab-host.tsx。

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
import { isStaticTabKind, type StaticTabKind } from "./tab-definitions"
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
  mountedFileRootId,
} from "./file-roots"
import { getFileSystem, statFile } from "@/filesystem/registry"
import { engineRegistry } from "@/engines/builtin"
import { enginePreferencesStorageKey, readEnginePreferences } from "@/engines/preferences"
import { openEngineWindow } from "@/lib/engine-window"
import { fileTypeInfo } from "@/lib/file-type"
import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  sameFileRef,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type { ResourceRef } from "@protocol/resource"
import {
  FILE_ENGINE_TAB_KIND,
  fileEngineTab,
  fileEngineTargetForTab,
  parseFileEngineTabParams,
} from "./file-tab"
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

export type { ActiveSource }
export type { OpenTarget }
export { tabKey } from "./tab-key"

function ws(): WorkspaceState {
  return store.getState().workspace
}

function setState(patch: Partial<WorkspaceState>) {
  store.dispatch(workspaceActions.patch(patch))
}

function dirtySet(): Set<string> {
  return new Set(ws().dirtyTabs)
}

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

/** 全部合法模块 id (水合时据此清洗陈旧/污染标签: module 不在此集合的丢弃)。
 *  用 Record<ModuleId,...> 构造 → 将来 ModuleId 增删而漏更新此处时编译期即报错 (而非静默丢标签)。 */
const VALID_MODULES = new Set(
  Object.keys({
    home: 1,
    subscriptions: 1,
    apps: 1,
    plugins: 1,
    shell: 1,
    git: 1,
    database: 1,
    audio: 1,
    code: 1,
    trash: 1,
    info: 1,
    community: 1,
    publications: 1,
    browser: 1,
    tool: 1,
    agent: 1,
  } satisfies Record<ModuleId, 1>) as ModuleId[],
)

function validModule(value: unknown): ModuleId | null {
  return typeof value === "string" && VALID_MODULES.has(value as ModuleId)
    ? (value as ModuleId)
    : null
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

function legacyResourceEngine(ref: ResourceRef): string {
  if (ref.scheme === "node") {
    if (ref.kind === "note") return "ideall.note"
    if (ref.kind === "bookmark") return "ideall.bookmark"
    if (ref.kind === "feed") return "ideall.feed"
    if (ref.kind === "thread") return "ideall.thread"
    if (ref.kind === "folder") return "ideall.directory"
    return "ideall.preview"
  }
  if (ref.scheme === "browser") return "ideall.browser"
  return "ideall.connected"
}

function legacyResourceRootId(ref: ResourceRef): string {
  if (ref.scheme === "node") {
    if (ref.kind === "note") return "notes"
    if (ref.kind === "bookmark" || ref.kind === "folder") return "bookmarks"
    if (ref.kind === "file") return "files"
    if (ref.kind === "feed") return "subscriptions"
    return "workspace"
  }
  if (ref.scheme === "browser") return "browser"
  if (ref.scheme === "app") return "apps"
  return ref.scheme
}

function inferredRootIdForFile(ref: FileRef): string | undefined {
  const resource = resourceRefForFile(ref)
  if (resource) return legacyResourceRootId(resource)

  const panel = panelForFile(ref)
  if (panel) {
    if (["home"].includes(panel.id)) return "home"
    if (["subscriptions"].includes(panel.id)) return "subscriptions"
    if (["bookmarks"].includes(panel.id)) return "bookmarks"
    if (["files"].includes(panel.id)) return "files"
    if (["notes"].includes(panel.id)) return "notes"
    if (panel.module === "agent") {
      return "workspace"
    }
    if (panel.id === "apps") return "apps"
    if (panel.id === "publications") return "community"
    return "system"
  }

  const provider = getFileSystem(ref.fileSystemId)
  return provider ? mountedFileRootId(provider.descriptor.root) : undefined
}

function compatibilityFileMediaType(name: string): string {
  const info = fileTypeInfo(name, "")
  if (info.preview === "audio") return "audio/*"
  if (info.preview === "video") return "video/*"
  if (info.preview === "image" || info.preview === "svg") return `image/${info.ext || "*"}`
  if (info.preview === "json") return "application/json"
  if (info.preview === "markdown") return "text/markdown"
  if (["code", "csv", "text"].includes(info.preview)) return "text/plain"
  if (info.preview === "pdf") return "application/pdf"
  return "application/octet-stream"
}

function compatibilityResourceMediaType(ref: ResourceRef, name: string): string {
  if (ref.scheme === "node") {
    if (ref.kind === "folder") return DIRECTORY_MEDIA_TYPE
    if (ref.kind === "file") return compatibilityFileMediaType(name)
    return `application/vnd.ideall.${ref.kind}+json`
  }
  if (ref.scheme === "browser") return "text/uri-list"
  if (ref.scheme === "app") return "application/vnd.ideall.app+json"
  return `application/vnd.ideall.${ref.scheme}.${ref.kind}+json`
}

/**
 * ResourceRef 仅是迁移期入口。这里把调用者已有的元数据投影成 File，避免为了
 * 兼容同步 boolean API 再创建一个临时 resource 标签；VFS 的真实元数据随后刷新。
 */
function compatibilityFileForResource(
  target: Extract<OpenTarget, { type: "resource" }>,
): IdeallFile {
  const { ref, meta } = target
  const directory = ref.scheme === "node" && (ref.kind === "folder" || ref.kind === "note")
  const name = meta?.title || target.title || ref.id
  return {
    ref: resourceFileRef(ref),
    kind: directory ? "directory" : "file",
    name,
    mediaType: compatibilityResourceMediaType(ref, name),
    capabilities: [
      ...(directory ? (["read-directory"] as const) : []),
      ...(meta?.capabilities.map((capability) => `resource:${capability}`) ?? []),
    ],
    source:
      ref.scheme === "node"
        ? { kind: "local", id: "ideall.nodes", label: "本机" }
        : ref.scheme === "info" || ref.scheme === "community"
          ? { kind: "remote", id: ref.scheme, label: ref.scheme }
          : ref.scheme === "app" || ref.scheme === "browser"
            ? { kind: "app", id: ref.scheme, label: ref.scheme }
            : { kind: "system", id: ref.scheme, label: ref.scheme },
    updatedAt: meta?.updatedAt,
    properties: {
      resourceScheme: ref.scheme,
      resourceKind: ref.kind,
      route: meta?.route ?? null,
      iconHint: meta?.iconHint ?? null,
    },
  }
}

function hydrateResourceFileTab(ref: ResourceRef, tab: Tab): Tab {
  const descriptor = fileEngineTab(
    { ref: resourceFileRef(ref), name: tab.title || ref.id },
    legacyResourceEngine(ref),
    { module: tab.module, rootId: legacyResourceRootId(ref) },
  )
  return { ...descriptor, id: tabKey(descriptor) }
}

function hydratePanelFileTab(
  ref: FileRef,
  tab: Tab,
  rootId: string,
  engineId = "ideall.panel",
): Tab {
  const descriptor = fileEngineTab({ ref, name: tab.title || ref.fileId }, engineId, { rootId })
  return { ...descriptor, id: tabKey(descriptor) }
}

function migrateStaticWorkspaceTab(tab: Tab & { kind: StaticTabKind }): Tab | null {
  switch (tab.kind) {
    case "home-overview":
      return hydratePanelFileTab(panelFileRef("home"), tab, "home")
    case "home-notes":
      return hydratePanelFileTab(panelFileRef("notes"), tab, "notes")
    case "subscriptions":
      return hydratePanelFileTab(panelFileRef("subscriptions"), tab, "subscriptions")
    case "home-publications":
      return hydratePanelFileTab(panelFileRef("publications"), tab, "community")
    case "home-resources":
      return hydratePanelFileTab(panelFileRef("files"), tab, "files")
    case "home-bookmarks":
      return hydratePanelFileTab(panelFileRef("bookmarks"), tab, "bookmarks")
    case "home-settings":
      return hydratePanelFileTab(panelFileRef("settings"), tab, "system")
    case "info":
      return hydrateResourceFileTab({ scheme: "info", kind: "home", id: "default" }, tab)
    case "community":
      return hydrateResourceFileTab({ scheme: "community", kind: "home", id: "default" }, tab)
    case "tool-search":
      return hydrateResourceFileTab({ scheme: "tool", kind: "search", id: "default" }, tab)
    case "tool-ai":
      return hydrateResourceFileTab({ scheme: "tool", kind: "ai", id: "default" }, tab)
    case "tool-navigation":
      return hydrateResourceFileTab({ scheme: "tool", kind: "navigation", id: "default" }, tab)
    case "apps":
      return hydratePanelFileTab(panelFileRef("apps"), tab, "apps")
    case "shell":
      return hydratePanelFileTab(panelFileRef("shell"), tab, "system", "ideall.shell")
    case "git":
      return hydratePanelFileTab(panelFileRef("git"), tab, "system", "ideall.git")
    case "database":
      return hydratePanelFileTab(panelFileRef("database"), tab, "system", "ideall.database")
    case "audio":
      return hydratePanelFileTab(panelFileRef("audio"), tab, "system", "ideall.audio")
    case "code":
      return hydratePanelFileTab(panelFileRef("code"), tab, "system")
    case "trash":
      return hydratePanelFileTab(panelFileRef("trash"), tab, "system")
    case "browser-view":
      return hydrateResourceFileTab({ scheme: "browser", kind: "page", id: "default" }, tab)
    case "ai-settings":
    case "ai-mcp":
    case "ai-skills":
    case "ai-rules":
      return hydratePanelFileTab(panelFileRef(tab.kind), tab, "workspace", "ideall.panel-fill")
    case "ai-tasks": {
      const workspaceId = tab.params?.workspaceId
      return workspaceId
        ? hydratePanelFileTab(
            aiTasksPanelFileRef(workspaceId),
            tab,
            "workspace",
            "ideall.panel-fill",
          )
        : null
    }
  }
}

export function migrateWorkspaceTab(tab: Tab): Tab | null {
  if (!VALID_MODULES.has(tab.module)) return null
  if (tab.kind === "node") {
    const ref = nodeResourceRefForTab(tab)
    if (!ref) return null
    return hydrateResourceFileTab(ref, tab)
  }
  if (tab.kind === "browser-view") {
    return hydrateResourceFileTab({ scheme: "browser", kind: "page", id: "default" }, tab)
  }
  if (tab.kind === "resource") {
    const ref = parseResourceTabParams(tab.params)
    return ref ? hydrateResourceFileTab(ref, tab) : null
  }
  if (tab.kind === FILE_ENGINE_TAB_KIND && !parseFileEngineTabParams(tab.params)) return null
  if (isStaticTabKind(tab.kind))
    return migrateStaticWorkspaceTab(tab as Tab & { kind: StaticTabKind })
  return { ...tab, id: tabKey(tab) }
}

export function migrateWorkspaceTabs(tabs: readonly Tab[]): {
  tabs: Tab[]
  idMap: ReadonlyMap<string, string>
} {
  const migrated: Tab[] = []
  const seen = new Set<string>()
  const idMap = new Map<string, string>()
  for (const tab of tabs) {
    const next = migrateWorkspaceTab(tab)
    if (!next) continue
    idMap.set(tab.id, next.id)
    if (seen.has(next.id)) continue
    seen.add(next.id)
    migrated.push(next)
  }
  return { tabs: migrated, idMap }
}

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

/** 计算「以瞬态(预览)方式打开 d」后的 tabs/transientId/activeId 补丁: 复用单一预览槽。
 *  - 该标签已存在: 仅激活, 不改其常驻/瞬态性 (单击一个已开标签不应把它降级成预览)。
 *  - 不存在且当前有预览槽: 原地替换旧预览 (位置不变, 旧预览内容由 tab-host 卸载)。
 *  - 不存在且无预览槽: 追加为新的预览标签。 */
function transientOpenPatch(d: TabDescriptor): {
  tabs: Tab[]
  transientId: string | null
  activeId: string
} {
  const id = tabKey(d)
  if (ws().tabs.some((t) => t.id === id)) {
    return { tabs: ws().tabs, transientId: ws().transientId, activeId: id }
  }
  if (ws().transientId && ws().tabs.some((t) => t.id === ws().transientId)) {
    return {
      tabs: ws().tabs.map((t) => (t.id === ws().transientId ? { ...d, id } : t)),
      transientId: id,
      activeId: id,
    }
  }
  return { tabs: [...ws().tabs, { ...d, id }], transientId: id, activeId: id }
}

/** 常驻标签软上限: 超过即回收最久未用的冷标签 (预览标签是单槽, 不计入)。 */
const MAX_PERMANENT_TABS = 12

/** 若常驻标签数超过软上限, 按 LRU 关闭最久未访问、非 protect、非预览的常驻标签, 直到回到上限。
 *  未保存草稿由写队列在卸载时落库 (与 tab-host 内容逐出同理), 故关闭是数据安全的。
 *  在 setState 之前调用 → 读 ws().lru / ws().transientId 的当前快照。 */
function evictColdTabs(tabs: Tab[], protect: Set<string>): Tab[] {
  const transient = ws().transientId
  const dirty = dirtySet()
  const permanentCount = tabs.reduce((n, t) => (t.id === transient ? n : n + 1), 0)
  const overflow = permanentCount - MAX_PERMANENT_TABS
  if (overflow <= 0) return tabs
  const rank = new Map(ws().lru.map((id, i) => [id, i])) // 越小越久未用
  const evictable = tabs
    .filter((t) => t.id !== transient && !protect.has(t.id) && !dirty.has(t.id))
    .sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1))
    .slice(0, overflow)
  if (evictable.length === 0) return tabs
  const drop = new Set(evictable.map((t) => t.id))
  return tabs.filter((t) => !drop.has(t.id))
}

/** 打开 (或激活已存在的) 标签, 并把活动模块同步到该标签所属模块 (驱动活动栏高亮 / 侧栏)。
 *  不翻 mode 视图 (打开标签是内容导航, 不是视图切换; 见 MODE_OF 注释)。
 *  source 默认 user (UI/路由触发); agent 经 ui.openTab 打开时传 "agent" —— 仅影响隐式同意, 不改打开行为。
 *  opts.transient=true → 预览标签 (复用单一预览槽: 轻底/淡色点/标题点线下划线); 缺省 = 常驻打开
 *  (若命中当前预览槽则提升为常驻)。新增常驻标签超过软上限时自动回收最久未用的冷标签。 */
export function openTab(d: TabDescriptor, source: ActiveSource = "user", opts?: OpenTabOpts) {
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
      ...transientOpenPatch(d),
      activeModule: coerceActiveModuleForMode(d.module, ws().mode, ws().activeModule),
      activeRootId,
      activeSource: source,
    })
    return
  }
  const exists = ws().tabs.some((t) => t.id === id)
  const tabs = exists ? ws().tabs : evictColdTabs([...ws().tabs, { ...d, id }], new Set([id]))
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

async function openFileTarget(
  target: Extract<OpenTarget, { type: "file" }>,
  source: ActiveSource,
  shouldCommit?: () => boolean,
): Promise<boolean> {
  const workspaceKind = ws().workspaceKind
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
    if (shouldCommit && !shouldCommit()) return false
    const candidates = engineRegistry.matching(file)
    const requested = target.engineId
      ? candidates.find((candidate) => candidate.descriptor.engineId === target.engineId)
      : undefined
    const preferences = readEnginePreferences(
      typeof window === "undefined" ? undefined : window.localStorage,
      enginePreferencesStorageKey(workspaceKind),
    )
    const resolved =
      requested ??
      resolveWorkspaceEngine(
        file,
        workspaceKind,
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

let routeFileOpenRequest = 0

/**
 * 路由专用的可等待文件打开：为 UrlSync 暴露实时 pending 状态，并用递增令牌
 * 取消已离开的旧深链，避免异步 stat 完成后把用户拉回上一条 URL。
 */
export async function openRouteFileTarget(
  target: Extract<OpenTarget, { type: "file" }>,
  source: ActiveSource = "user",
): Promise<boolean> {
  const request = ++routeFileOpenRequest
  setState({ routeOpenPending: true })
  try {
    return await openFileTarget(target, source, () => request === routeFileOpenRequest)
  } finally {
    if (request === routeFileOpenRequest) setState({ routeOpenPending: false })
  }
}

export function cancelRouteFileOpen(): void {
  routeFileOpenRequest += 1
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

/** 标记标签存在未保存草稿。dirty 标签不会被自动回收; UI 关闭前会二次确认。 */
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
  const dirtyIds = ids.filter((id) => ws().dirtyTabs.includes(id))
  if (dirtyIds.length === 0) return null
  const dirtyTabs = ws().tabs.filter((t) => dirtyIds.includes(t.id))
  const names = dirtyTabs
    .slice(0, 3)
    .map((t) => `「${t.title || "未命名"}」`)
    .join("、")
  const extra = dirtyTabs.length > 3 ? `等 ${dirtyTabs.length} 个标签` : ""
  return {
    ids: dirtyIds,
    title: "关闭未保存的标签？",
    description: `${names}${extra} 有未保存更改，关闭后会丢失这些更改。`,
    confirmLabel: "关闭标签",
    confirm,
  }
}

function requestDirtyClose(ids: string[], confirm: () => void): boolean {
  const request = dirtyCloseRequest(ids, confirm)
  if (!request) return true
  for (const listener of dirtyTabCloseListeners) listener(request)
  return false
}

/** 关闭标签; 若关的是激活项, 焦点转移到相邻标签。 */
export function closeTab(id: string) {
  const idx = ws().tabs.findIndex((t) => t.id === id)
  if (idx === -1) return
  const closingTab = ws().tabs[idx]
  const tabs = ws().tabs.filter((t) => t.id !== id)
  if (closingTab && isBrowserResourceTab(closingTab) && isTauri()) {
    void browserRelease().catch(() => {})
  }
  let activeId = ws().activeId
  let activeModule = ws().activeModule
  let activeRootId = ws().activeRootId
  if (ws().activeId === id) {
    const next = tabs[idx] ?? tabs[idx - 1] ?? null
    activeId = next ? next.id : null
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
    tabs,
    activeId,
    activeModule,
    activeRootId,
    transientId: ws().transientId === id ? null : ws().transientId,
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
}

/** 点活动栏图标: 同模块且侧栏展开 → 收起侧栏; 否则切到该模块、展开侧栏, 并以「预览」方式开其首个面板。 */
export function toggleModule(m: ModuleId) {
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
    ...transientOpenPatch(descriptor),
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

/** 切换 Display 工作区组合；与数据镜头、文件根和已打开标签完全正交。 */
export function setWorkspaceKind(workspaceKind: WorkspaceKind) {
  if (workspaceKind !== ws().workspaceKind) setState({ workspaceKind })
}

/** 选择开发工作区的辅助工具；选择本身不隐式切换工作区。 */
export function setDevelopmentTool(developmentTool: DevelopmentTool) {
  if (developmentTool !== ws().developmentTool) setState({ developmentTool })
}

/** 切换数据来源模式 (本地 / 连接): 活动模块归到该模式首个模块, 展开侧栏并以预览方式开其落地面板。
 *  已是该模式则无操作 (点已激活的分段不打扰当前标签)。 */
export function setMode(mode: WsMode) {
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
    ...transientOpenPatch(descriptor),
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
