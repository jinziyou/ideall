"use client"

// 标签内容注册表: kind → 渲染函数 + 布局模式 (keep-alive 由 tab-host 负责)。
// 渲染函数返回 JSX (内部用 React.lazy 按需加载, 切到该标签才下载对应 chunk)。
// layout: "fill" = 组件自管理全高/滚动 (笔记 / AI / 嵌入 iframe); "padded" = 居中限宽滚动容器。

import * as React from "react"
import { AppWindow, Check, ChevronDown, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { ErrorBoundary } from "@/ui/error-boundary"
import { infoEmbedManifest, communityEmbedManifest } from "@/plugins/embed/manifest"
import type { SubscriptionType } from "@protocol/subscription"
import type { Tab } from "./types"
import {
  isStaticTabKind,
  tabDefinitionLayout,
  type StaticTabKind,
  type TabLayout,
} from "./tab-definitions"
import { resolveNodeResourceViewer, resourceLayout } from "./resource-engines"
import { RESOURCE_TAB_KIND, nodeResourceRefForTab, parseResourceTabParams } from "./resource-tab"
import type { ResourceRef } from "@protocol/resource"
import { sameFileRef, type FileRef, type IdeallFile } from "@protocol/file-system"
import { getFileSystem, statFile, subscribeFileSystems, watchFile } from "@/filesystem/registry"
import { AUDIO_LIBRARY_ROOT_REF } from "@/filesystem/builtin-app-roots"
import { panelForFile, resourceRefForFile } from "@/filesystem/resource-file-system"
import { engineRegistry } from "@/engines/builtin"
import {
  EnginePreferenceStore,
  enginePreferencesStorageKey,
  getFileEnginePreference,
  getMediaTypeEnginePreference,
} from "@/engines/preferences"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { Button } from "@/ui/button"
import { FILE_ENGINE_TAB_KIND, parseFileEngineTabParams } from "./file-tab"
import {
  type FileEngineRenderer,
  FileEngineRendererRegistry,
  fileEngineRendererRegistry,
  getFileEngineRendererRevision,
  resolveFileEngineRenderer,
  subscribeFileEngineRenderers,
} from "./file-engine-renderer"
import { openTarget } from "./store"
import { useActiveRootId, useWorkspaceKind } from "./store"
import { writeStartupTarget } from "./startup-target"
import NodeFileEngineToolbar from "./viewers/node-file-engine-toolbar"
import GenericFileActionMenu from "./viewers/generic-file-action-menu"
import { canOpenStandaloneWindow } from "./standalone-window-policy"
import { audioManifest } from "@/plugins/audio/manifest"
import { databaseManifest } from "@/plugins/database/manifest"
import { gitManifest } from "@/plugins/git/manifest"

// 关注流含全部动态来源: 发布者 / 实体 / 搜索 (资讯) + 社区发布者 peer; 内容汇入「我的」。
const FOLLOW_TYPES: SubscriptionType[] = ["publisher", "entity", "search", "peer"]

const EmbedHost = React.lazy(() =>
  import("@/plugins/embed/host").then((mod) => ({ default: mod.EmbedHost })),
)

const Overview = React.lazy(() => import("@/modules/home/overview"))
const NotesManager = React.lazy(() => import("@/modules/home/notes/notes-manager"))
const SyncPanel = React.lazy(() => import("@/modules/home/subscriptions/sync-panel"))
const SubscriptionFeed = React.lazy(() => import("@/modules/home/subscriptions/subscription-feed"))
const MyPublications = React.lazy(() => import("@/modules/home/publications/my-publications"))
const FileManager = React.lazy(() => import("@/modules/home/resources/file-manager"))
const BookmarkManager = React.lazy(() => import("@/modules/home/bookmarks/bookmark-manager"))
const ToolSearch = React.lazy(() => import("@/modules/tool/search-page"))
const ToolAi = React.lazy(() => import("@/modules/tool/ai-page"))
const ToolNavigation = React.lazy(() => import("@/modules/tool/navigation-page"))
const AppsPage = React.lazy(() => import("@/modules/apps/apps-page"))
const ShellPage = React.lazy(() => import("@/plugins/shell/shell-page"))
const CodePage = React.lazy(() => import("@/plugins/code/code-page"))
const TrashPage = React.lazy(() => import("@/modules/home/trash/trash-page"))
const BrowserView = React.lazy(() => import("./browser-view"))
const AiSettings = React.lazy(() => import("@/plugins/agent/views/ai-settings"))
const HomeSettings = React.lazy(() => import("@/modules/home/settings/settings-page"))
const AiMcp = React.lazy(() => import("@/plugins/agent/views/ai-mcp"))
const AiSkills = React.lazy(() => import("@/plugins/agent/views/ai-skills"))
const AiRules = React.lazy(() => import("@/plugins/agent/views/ai-rules"))
const AiTasks = React.lazy(() => import("@/plugins/agent/views/ai-tasks"))
const AgentSpaces = React.lazy(() => import("@/plugins/agent/views/agent-spaces"))
const AgentTaskList = React.lazy(() => import("@/plugins/agent/views/agent-task-list"))
const AudioFileEngine = React.lazy(() => import("./viewers/audio-file-engine"))
const FileDirectoryEngine = React.lazy(() => import("./viewers/file-directory-engine"))
const GenericCodeEngine = React.lazy(() => import("./viewers/generic-code-engine"))
const GenericPreviewEngine = React.lazy(() => import("./viewers/generic-preview-engine"))
const InstalledAppEngine = React.lazy(() => import("./viewers/installed-app-engine"))

type Entry = { render: (tab: Tab) => React.ReactNode }

const REGISTRY: Partial<Record<StaticTabKind, Entry>> = {
  "home-overview": { render: () => <Overview /> },
  "home-notes": { render: () => <NotesManager /> },
  subscriptions: {
    render: () => (
      <div className="flex flex-col gap-6">
        <SyncPanel />
        <SubscriptionFeed types={FOLLOW_TYPES} title="关注流" dotClass="bg-spoke-info" />
      </div>
    ),
  },
  "home-publications": { render: () => <MyPublications /> },
  "home-resources": { render: () => <FileManager /> },
  "home-bookmarks": { render: () => <BookmarkManager /> },
  "home-settings": { render: () => <HomeSettings /> },
  info: { render: () => <EmbedHost manifest={infoEmbedManifest} /> },
  community: { render: () => <EmbedHost manifest={communityEmbedManifest} /> },
  "tool-search": { render: () => <ToolSearch /> },
  "tool-ai": { render: () => <ToolAi /> },
  "tool-navigation": { render: () => <ToolNavigation /> },
  apps: { render: () => <AppsPage /> },
  shell: { render: () => <ShellPage /> },
  // git/database/audio 仅保留在 TAB_DEFINITIONS 识别旧快照；运行态入口已经迁移到
  // 各自 App FileSystem 的真实 root，由对应 File Engine renderer 处理。
  code: { render: () => <CodePage /> },
  trash: { render: () => <TrashPage /> },
  "browser-view": { render: () => <BrowserView /> },
  // AI 区段标签 (module:"agent", mode-中性)。任务标签按 params.workspaceId 实例化。
  "ai-settings": { render: () => <AiSettings /> },
  "ai-mcp": { render: () => <AiMcp /> },
  "ai-skills": { render: () => <AiSkills /> },
  "ai-rules": { render: () => <AiRules /> },
  "ai-tasks": {
    render: (tab) => <AiTasks workspaceId={tab.params?.workspaceId ?? ""} />,
  },
  "agent-spaces": { render: () => <AgentSpaces /> },
  "agent-task-list": { render: () => <AgentTaskList /> },
}

const Spinner = (
  <div className="flex h-full items-center justify-center text-muted-foreground">
    <Loader2 className="h-5 w-5 animate-spin" />
  </div>
)

export function tabLayout(tab: Tab): TabLayout {
  if (tab.kind === FILE_ENGINE_TAB_KIND) {
    const target = parseFileEngineTabParams(tab.params)
    return target ? (engineRegistry.get(target.engineId)?.layout ?? "padded") : "padded"
  }
  if (tab.kind === RESOURCE_TAB_KIND) {
    const ref = parseResourceTabParams(tab.params)
    return ref ? resourceLayout(ref) : "padded"
  }
  // 节点级标签: layout 取自查看器注册表 (file 的 mime 分派在叶子, 故按 kind 即可定 layout)。
  if (tab.kind === "node") {
    const ref = nodeResourceRefForTab(tab)
    return ref ? resourceLayout(ref) : "padded"
  }
  return tabDefinitionLayout(tab.kind) ?? "padded"
}

function renderPanelFile(file: IdeallFile): React.ReactNode {
  const panel = panelForFile(file.ref)
  if (!panel || !isStaticTabKind(panel.tabKind)) {
    return <div className="p-6 text-sm text-muted-foreground">无法打开此系统文件</div>
  }
  const entry = REGISTRY[panel.tabKind]
  if (!entry) {
    return <div className="p-6 text-sm text-muted-foreground">无法打开此系统文件</div>
  }
  const tab: Tab = {
    id: `panel:${panel.id}`,
    kind: panel.tabKind,
    module: panel.module as Tab["module"],
    title: panel.name,
    params: panel.params ? { ...panel.params } : undefined,
  }
  return <React.Suspense fallback={Spinner}>{entry.render(tab)}</React.Suspense>
}

function unsupportedEngine(file: IdeallFile, engineId: string): React.ReactNode {
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      {engineRegistry.get(engineId)?.label ?? engineId} 尚未接入{" "}
      {file.source.label ?? file.source.id}
      的此类文件。
    </div>
  )
}

function renderGenericPreview(
  file: IdeallFile,
  engineId: string,
  readOnly: boolean,
): React.ReactNode {
  const mediaType = file.mediaType.toLowerCase()
  if (mediaType.startsWith("audio/")) return <AudioFileEngine file={file} />
  if (mediaType.startsWith("image/")) return <GenericPreviewEngine file={file} />
  if (
    mediaType.startsWith("text/") ||
    mediaType.includes("json") ||
    mediaType.includes("javascript") ||
    mediaType.includes("typescript") ||
    mediaType.includes("xml")
  ) {
    return <GenericCodeEngine file={file} engineId={engineId} readOnly={readOnly} />
  }
  return <GenericPreviewEngine file={file} />
}

function registerRenderer(
  registry: FileEngineRendererRegistry,
  engineId: string,
  renderer: FileEngineRenderer,
): () => void {
  return registry.get(engineId) ? () => {} : registry.register(engineId, renderer)
}

/** UI composition contribution for the built-in engine descriptors. */
export function registerBuiltInFileEngineRenderers(
  registry: FileEngineRendererRegistry = fileEngineRendererRegistry,
): () => void {
  const disposers: Array<() => void> = []
  const nodeRenderer =
    (kind: "note" | "bookmark" | "feed" | "thread"): FileEngineRenderer =>
    ({ file, descriptor }) => {
      const resource = resourceRefForFile(file.ref)
      return resource?.scheme === "node" && resource.kind === kind
        ? renderNodeResource(resource)
        : unsupportedEngine(file, descriptor.engineId)
    }

  disposers.push(registerRenderer(registry, "ideall.note", nodeRenderer("note")))
  disposers.push(registerRenderer(registry, "ideall.bookmark", nodeRenderer("bookmark")))
  disposers.push(registerRenderer(registry, "ideall.feed", nodeRenderer("feed")))
  disposers.push(registerRenderer(registry, "ideall.thread", nodeRenderer("thread")))
  disposers.push(
    registerRenderer(registry, "ideall.directory", ({ file }) => (
      <FileDirectoryEngine file={file} />
    )),
  )
  disposers.push(
    registerRenderer(registry, "ideall.audio", ({ file }) =>
      sameFileRef(file.ref, AUDIO_LIBRARY_ROOT_REF) ? (
        audioManifest.renderLibraryRoot()
      ) : (
        <AudioFileEngine file={file} />
      ),
    ),
  )
  disposers.push(
    registerRenderer(registry, "ideall.installed-app", ({ file }) => (
      <InstalledAppEngine file={file} />
    )),
  )
  disposers.push(registerRenderer(registry, "ideall.database", databaseManifest.renderEngine))
  disposers.push(registerRenderer(registry, "ideall.git", gitManifest.renderEngine))
  disposers.push(registerRenderer(registry, "ideall.shell", () => <ShellPage />))
  disposers.push(
    registerRenderer(registry, "ideall.browser", ({ file, descriptor }) => {
      const resource = resourceRefForFile(file.ref)
      const propertyUrl = typeof file.properties?.url === "string" ? file.properties.url : undefined
      const resourceUrl =
        resource?.scheme === "browser" && resource.id !== "default" ? resource.id : undefined
      return propertyUrl || resource?.scheme === "browser" ? (
        <BrowserView initialUrl={propertyUrl ?? resourceUrl} />
      ) : (
        unsupportedEngine(file, descriptor.engineId)
      )
    }),
  )
  disposers.push(
    registerRenderer(registry, "ideall.code", ({ file, descriptor }) => (
      <GenericCodeEngine
        file={file}
        engineId={descriptor.engineId}
        readOnly={descriptor.access === "read-only"}
      />
    )),
  )
  disposers.push(
    registerRenderer(registry, "ideall.connected", ({ file, descriptor }) => {
      const resource = resourceRefForFile(file.ref)
      return resource
        ? renderConnectedResource(resource)
        : unsupportedEngine(file, descriptor.engineId)
    }),
  )
  disposers.push(registerRenderer(registry, "ideall.panel", ({ file }) => renderPanelFile(file)))
  disposers.push(
    registerRenderer(registry, "ideall.panel-fill", ({ file }) => renderPanelFile(file)),
  )
  disposers.push(
    registerRenderer(registry, "ideall.preview", ({ file, descriptor }) =>
      file.kind === "directory" ? (
        <FileDirectoryEngine file={file} />
      ) : (
        renderGenericPreview(file, descriptor.engineId, descriptor.access === "read-only")
      ),
    ),
  )
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

function renderFileEngineBody(
  file: IdeallFile,
  descriptor: NonNullable<ReturnType<typeof engineRegistry.get>>,
): React.ReactNode {
  const renderer = resolveFileEngineRenderer(descriptor.engineId)
  return renderer ? renderer({ file, descriptor }) : unsupportedEngine(file, descriptor.engineId)
}

function useEnginePreferences() {
  const workspace = useWorkspaceKind()
  const store = React.useMemo(
    () =>
      new EnginePreferenceStore(
        typeof window === "undefined" ? undefined : window.localStorage,
        enginePreferencesStorageKey(workspace),
      ),
    [workspace],
  )
  const [revision, setRevision] = React.useState(0)
  const preferences = React.useMemo(() => {
    void revision
    return store.snapshot()
  }, [store, revision])
  const refresh = () => setRevision((value) => value + 1)
  return { store, preferences, refresh }
}

function subscribeEngineRegistry(listener: () => void): () => void {
  return engineRegistry.subscribe(listener)
}

function getEngineRegistryRevision(): number {
  return engineRegistry.revision()
}

function useEngineRegistryRevision(): void {
  React.useSyncExternalStore(
    subscribeEngineRegistry,
    getEngineRegistryRevision,
    getEngineRegistryRevision,
  )
}

function EnginePicker({ file, engineId }: { file: IdeallFile; engineId: string }) {
  useEngineRegistryRevision()
  const activeRootId = useActiveRootId()
  const { store, preferences, refresh } = useEnginePreferences()
  const candidates = engineRegistry.matching(file)
  const standaloneCandidates = candidates.filter(({ descriptor }) =>
    canOpenStandaloneWindow(file, descriptor),
  )
  const current = engineRegistry.get(engineId)
  const fileDefault = getFileEnginePreference(preferences, file.ref)
  const mediaDefault = getMediaTypeEnginePreference(preferences, file.mediaType)

  const setFileDefault = () => {
    store.setFile(file.ref, engineId)
    refresh()
    toast.success("已设为此文件的默认引擎")
  }
  const setMediaDefault = () => {
    store.setMediaType(file.mediaType, engineId)
    refresh()
    toast.success(`已设为 ${file.mediaType} 的默认引擎`)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          {current?.label ?? engineId}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>在当前工作区打开</DropdownMenuLabel>
        {candidates.map(({ descriptor }) => (
          <DropdownMenuItem
            key={descriptor.engineId}
            disabled={descriptor.engineId === engineId}
            onSelect={() =>
              openTarget({
                type: "file",
                ref: file.ref,
                file,
                engineId: descriptor.engineId,
                display: "tab",
              })
            }
          >
            <span className="min-w-0 flex-1 truncate">{descriptor.label}</span>
            {descriptor.engineId === engineId && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
        {standaloneCandidates.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>在独立窗口打开</DropdownMenuLabel>
            {standaloneCandidates.map(({ descriptor }) => (
              <DropdownMenuItem
                key={descriptor.engineId}
                onSelect={() =>
                  openTarget({
                    type: "file",
                    ref: file.ref,
                    file,
                    engineId: descriptor.engineId,
                    display: "window",
                  })
                }
              >
                <AppWindow className="mr-2 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{descriptor.label}</span>
                {descriptor.engineId === engineId && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={setFileDefault}>
          <span className="min-w-0 flex-1">设为此文件默认</span>
          {fileDefault === engineId && <Check className="h-3.5 w-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={setMediaDefault}>
          <span className="min-w-0 flex-1 truncate">设为此类型默认</span>
          {mediaDefault === engineId && <Check className="h-3.5 w-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            writeStartupTarget(window.localStorage, {
              ref: file.ref,
              engineId,
              rootId: activeRootId,
            })
            toast.success("已设为启动界面")
          }}
        >
          设为启动界面
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function FileEngineContent({
  refValue,
  engineId,
  display = "tab",
}: {
  refValue: FileRef
  engineId: string
  display?: "tab" | "window"
}) {
  useEngineRegistryRevision()
  const [file, setFile] = React.useState<IdeallFile | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const { fileSystemId, fileId } = refValue
  // registry 用全局通知即可，但 snapshot 取当前 provider 对象：无关挂载变化时 Object.is
  // 保持相同，不会清空所有 Engine 子树；同 id 卸载/重装时对象变化才重新 stat/watch。
  const providerSnapshot = React.useSyncExternalStore(
    subscribeFileSystems,
    () => getFileSystem(fileSystemId),
    () => getFileSystem(fileSystemId),
  )
  const legacyResource = resourceRefForFile(refValue)
  const missingMessage =
    legacyResource?.scheme === "node" && legacyResource.kind === "file"
      ? "该文件不存在或已删除。"
      : "文件不存在或挂载已断开"

  React.useSyncExternalStore(
    subscribeFileEngineRenderers,
    getFileEngineRendererRevision,
    getFileEngineRendererRevision,
  )

  React.useEffect(() => {
    let alive = true
    let request = 0
    setError(null)
    setFile(null)

    const refresh = () => {
      const currentRequest = ++request
      void statFile({ fileSystemId, fileId }, { actor: "ui", permissions: [], intent: "metadata" })
        .then((next) => {
          if (!alive || currentRequest !== request) return
          setFile(next)
          setError(next ? null : missingMessage)
        })
        .catch((reason) => {
          if (!alive || currentRequest !== request) return
          setError(reason instanceof Error ? reason.message : String(reason))
        })
    }

    refresh()
    let watchHandle: ReturnType<typeof watchFile> = null
    try {
      watchHandle = watchFile(
        { fileSystemId, fileId },
        { actor: "ui", permissions: [], intent: "watch" },
        refresh,
      )
    } catch {
      // Watching is optional; the initial stat remains authoritative for providers without it.
    }

    return () => {
      alive = false
      watchHandle?.dispose()
    }
  }, [fileId, fileSystemId, missingMessage, providerSnapshot])

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>
  }
  if (!file) return Spinner
  const matches = engineRegistry.matching(file)
  // 陈旧标签 / 深链可能带着已不再匹配的 engineId；就地回退到当前候选中优先级最高的引擎渲染,
  // 不改写标签本身 (避免在渲染路径里触发 store 更新)。
  const candidate =
    matches.find((item) => item.descriptor.engineId === engineId) ?? matches[0] ?? null
  if (!candidate) {
    return <div className="p-6 text-sm text-muted-foreground">没有可处理此文件的引擎。</div>
  }
  const activeEngineId = candidate.descriptor.engineId
  if (display === "window" && !canOpenStandaloneWindow(file, candidate.descriptor)) {
    return <div className="p-6 text-sm text-destructive">此文件或引擎不允许在独立窗口中打开。</div>
  }
  const isNodeFile = legacyResource?.scheme === "node" && legacyResource.kind === "file"
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {isNodeFile ? (
        <NodeFileEngineToolbar
          file={file}
          enginePicker={<EnginePicker file={file} engineId={activeEngineId} />}
          onFileChanged={setFile}
          readOnly={candidate.descriptor.access === "read-only"}
        />
      ) : (
        <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b bg-card px-3">
          <h1 className="min-w-0 truncate text-xs font-normal text-muted-foreground">
            {file.name}
          </h1>
          <div className="flex shrink-0 items-center gap-1">
            <GenericFileActionMenu file={file} />
            <EnginePicker file={file} engineId={activeEngineId} />
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <React.Suspense fallback={Spinner}>
          {renderFileEngineBody(file, candidate.descriptor)}
        </React.Suspense>
      </div>
    </div>
  )
}

function renderFileEngineTab(tab: Tab): React.ReactNode {
  const target = parseFileEngineTabParams(tab.params)
  if (!target) {
    return <div className="p-6 text-sm text-muted-foreground">无法解析文件视图</div>
  }
  return <FileEngineContent refValue={target.ref} engineId={target.engineId} display="tab" />
}

function renderNodeResource(ref: ResourceRef): React.ReactNode {
  if (ref.scheme !== "node") return null
  const entry = resolveNodeResourceViewer(ref)
  if (!entry) {
    return <div className="p-6 text-sm text-muted-foreground">暂不支持这种内容（{ref.kind}）</div>
  }
  const Viewer = entry.viewer
  return (
    <React.Suspense fallback={Spinner}>
      <Viewer nodeId={ref.id} />
    </React.Suspense>
  )
}

function renderConnectedResource(ref: ResourceRef): React.ReactNode {
  switch (ref.scheme) {
    case "info":
      return <EmbedHost manifest={infoEmbedManifest} />
    case "community":
      return <EmbedHost manifest={communityEmbedManifest} />
    case "tool":
      if (ref.kind === "search") return <ToolSearch />
      if (ref.kind === "ai") return <ToolAi />
      if (ref.kind === "navigation") return <ToolNavigation />
      break
    case "browser":
      return <BrowserView initialUrl={ref.id === "default" ? undefined : ref.id} />
    case "app":
      return <AppsPage />
    case "node":
      break
  }
  return <div className="p-6 text-sm text-muted-foreground">无法打开此资源</div>
}

function renderTabBody(tab: Tab): React.ReactNode {
  if (tab.kind === FILE_ENGINE_TAB_KIND) return renderFileEngineTab(tab)
  // 旧 static/resource/node descriptor 只允许在 store 水合/打开边界迁移；Display 不再保留
  // 第二套直接渲染路径。命中这里表示调用方绕过了 openTarget/migrateWorkspaceTab。
  return <div className="p-6 text-sm text-muted-foreground">标签尚未规范为文件视图：{tab.kind}</div>
}

export function TabContent({ tab }: { tab: Tab }) {
  // 标签级错误边界: 单标签渲染崩溃 / chunk 加载失败只炸掉本面板 (错误卡 + 重试),
  // 标签条、侧栏与其他标签全部存活 —— 不再击穿 layout 落到 global-error 替换整个外壳。
  return <ErrorBoundary label="此标签">{renderTabBody(tab)}</ErrorBoundary>
}
