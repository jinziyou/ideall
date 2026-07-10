"use client"

// 标签内容注册表: kind → 渲染函数 + 布局模式 (keep-alive 由 tab-host 负责)。
// 渲染函数返回 JSX (内部用 React.lazy 按需加载, 切到该标签才下载对应 chunk)。
// layout: "fill" = 组件自管理全高/滚动 (笔记 / AI / 嵌入 iframe); "padded" = 居中限宽滚动容器。

import * as React from "react"
import { Check, ChevronDown, Loader2 } from "lucide-react"
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
import type { FileRef, IdeallFile } from "@protocol/file-system"
import { statFile } from "@/filesystem/registry"
import { panelForFile, resourceRefForFile } from "@/filesystem/resource-file-system"
import { engineRegistry } from "@/engines/builtin"
import {
  EnginePreferenceStore,
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
import { resolveFileEngineRenderer } from "./file-engine-renderer"
import { openTarget } from "./store"
import { useActiveRootId } from "./store"
import { writeStartupTarget } from "./startup-target"
import NodeFileEngineToolbar from "./viewers/node-file-engine-toolbar"

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
const GitPage = React.lazy(() => import("@/plugins/git/git-page"))
const DatabasePage = React.lazy(() => import("@/plugins/database/database-page"))
const AudioPage = React.lazy(() => import("@/plugins/audio/audio-page"))
const CodePage = React.lazy(() => import("@/plugins/code/code-page"))
const TrashPage = React.lazy(() => import("@/modules/home/trash/trash-page"))
const BrowserView = React.lazy(() => import("./browser-view"))
const AiSettings = React.lazy(() => import("@/plugins/agent/views/ai-settings"))
const HomeSettings = React.lazy(() => import("@/modules/home/settings/settings-page"))
const AiMcp = React.lazy(() => import("@/plugins/agent/views/ai-mcp"))
const AiSkills = React.lazy(() => import("@/plugins/agent/views/ai-skills"))
const AiRules = React.lazy(() => import("@/plugins/agent/views/ai-rules"))
const AiTasks = React.lazy(() => import("@/plugins/agent/views/ai-tasks"))
const AudioFileEngine = React.lazy(() => import("./viewers/audio-file-engine"))
const FileDirectoryEngine = React.lazy(() => import("./viewers/file-directory-engine"))
const GenericCodeEngine = React.lazy(() => import("./viewers/generic-code-engine"))

type Entry = { render: (tab: Tab) => React.ReactNode }

const REGISTRY: Record<StaticTabKind, Entry> = {
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
  git: { render: () => <GitPage /> },
  database: { render: () => <DatabasePage /> },
  audio: { render: () => <AudioPage /> },
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
  const tab: Tab = {
    id: `panel:${panel.id}`,
    kind: panel.tabKind,
    module: panel.module as Tab["module"],
    title: panel.name,
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

function renderGenericPreview(file: IdeallFile): React.ReactNode {
  const mediaType = file.mediaType.toLowerCase()
  if (mediaType.startsWith("audio/")) return <AudioFileEngine file={file} />
  if (
    mediaType.startsWith("text/") ||
    mediaType.includes("json") ||
    mediaType.includes("javascript") ||
    mediaType.includes("typescript") ||
    mediaType.includes("xml") ||
    mediaType === "image/svg+xml"
  ) {
    return <GenericCodeEngine file={file} readOnly />
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 p-6">
      <h1 className="text-lg font-semibold">{file.name}</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">类型</dt>
        <dd>{file.mediaType}</dd>
        <dt className="text-muted-foreground">来源</dt>
        <dd>{file.source.label ?? file.source.id}</dd>
        <dt className="text-muted-foreground">大小</dt>
        <dd>{file.size == null ? "—" : `${file.size} bytes`}</dd>
      </dl>
    </div>
  )
}

function renderFileEngineBody(file: IdeallFile, engineId: string): React.ReactNode {
  const resource = resourceRefForFile(file.ref)
  const renderer = resolveFileEngineRenderer(file, engineId)

  switch (renderer) {
    case "node-note":
      return resource?.scheme === "node" && resource.kind === "note"
        ? renderNodeResource(resource)
        : unsupportedEngine(file, engineId)
    case "node-bookmark":
      return resource?.scheme === "node" && resource.kind === "bookmark"
        ? renderNodeResource(resource)
        : unsupportedEngine(file, engineId)
    case "node-feed":
      return resource?.scheme === "node" && resource.kind === "feed"
        ? renderNodeResource(resource)
        : unsupportedEngine(file, engineId)
    case "node-thread":
      return resource?.scheme === "node" && resource.kind === "thread"
        ? renderNodeResource(resource)
        : unsupportedEngine(file, engineId)
    case "directory":
      return <FileDirectoryEngine file={file} />
    case "audio-file":
      return <AudioFileEngine file={file} />
    case "audio-library":
      return <AudioPage />
    case "database": {
      const tableId =
        typeof file.properties?.tableId === "string" ? file.properties.tableId : undefined
      return <DatabasePage initialTableId={tableId} />
    }
    case "git": {
      const path = typeof file.properties?.path === "string" ? file.properties.path : undefined
      return <GitPage initialRepoPath={path} />
    }
    case "shell":
      return <ShellPage />
    case "browser": {
      const propertyUrl = typeof file.properties?.url === "string" ? file.properties.url : undefined
      const resourceUrl =
        resource?.scheme === "browser" && resource.id !== "default" ? resource.id : undefined
      return <BrowserView initialUrl={propertyUrl ?? resourceUrl} />
    }
    case "code":
      return <GenericCodeEngine file={file} />
    case "connected":
      return resource ? renderConnectedResource(resource) : unsupportedEngine(file, engineId)
    case "panel":
      return renderPanelFile(file)
    case "preview":
      return renderGenericPreview(file)
    case "unsupported":
      return unsupportedEngine(file, engineId)
  }
}

function useEnginePreferences() {
  const store = React.useMemo(
    () =>
      new EnginePreferenceStore(typeof window === "undefined" ? undefined : window.localStorage),
    [],
  )
  const [revision, setRevision] = React.useState(0)
  const preferences = React.useMemo(() => {
    void revision
    return store.snapshot()
  }, [store, revision])
  const refresh = () => setRevision((value) => value + 1)
  return { store, preferences, refresh }
}

function EnginePicker({ file, engineId }: { file: IdeallFile; engineId: string }) {
  const activeRootId = useActiveRootId()
  const { store, preferences, refresh } = useEnginePreferences()
  const candidates = engineRegistry.matching(file)
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
        <DropdownMenuLabel>打开方式</DropdownMenuLabel>
        {candidates.map(({ descriptor }) => (
          <DropdownMenuItem
            key={descriptor.engineId}
            disabled={descriptor.engineId === engineId || !descriptor.supportsStandaloneWindow}
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
            <span className="min-w-0 flex-1 truncate">{descriptor.label}</span>
            {descriptor.engineId === engineId && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
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

export function FileEngineContent({ refValue, engineId }: { refValue: FileRef; engineId: string }) {
  const [file, setFile] = React.useState<IdeallFile | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const { fileSystemId, fileId } = refValue
  const legacyResource = resourceRefForFile(refValue)
  const missingMessage =
    legacyResource?.scheme === "node" && legacyResource.kind === "file"
      ? "该文件不存在或已删除。"
      : "文件不存在或挂载已断开"

  React.useEffect(() => {
    let alive = true
    setError(null)
    statFile({ fileSystemId, fileId }, { actor: "ui", permissions: [], intent: "metadata" })
      .then((next) => {
        if (!alive) return
        if (next) setFile(next)
        else setError(missingMessage)
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [fileId, fileSystemId, missingMessage])

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>
  }
  if (!file) return Spinner
  const candidate = engineRegistry
    .matching(file)
    .find((item) => item.descriptor.engineId === engineId)
  if (!candidate) {
    return <div className="p-6 text-sm text-muted-foreground">该引擎不能处理此文件。</div>
  }
  const isNodeFile = legacyResource?.scheme === "node" && legacyResource.kind === "file"
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {isNodeFile ? (
        <NodeFileEngineToolbar
          file={file}
          enginePicker={<EnginePicker file={file} engineId={engineId} />}
          onFileChanged={setFile}
        />
      ) : (
        <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b bg-card px-3">
          <h1 className="min-w-0 truncate text-xs font-normal text-muted-foreground">
            {file.name}
          </h1>
          <EnginePicker file={file} engineId={engineId} />
        </div>
      )}
      <div className="min-h-0 flex-1">
        <React.Suspense fallback={Spinner}>{renderFileEngineBody(file, engineId)}</React.Suspense>
      </div>
    </div>
  )
}

function renderFileEngineTab(tab: Tab): React.ReactNode {
  const target = parseFileEngineTabParams(tab.params)
  if (!target) {
    return <div className="p-6 text-sm text-muted-foreground">无法解析文件视图</div>
  }
  return <FileEngineContent refValue={target.ref} engineId={target.engineId} />
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

function renderResourceTab(tab: Tab): React.ReactNode {
  const ref = parseResourceTabParams(tab.params)
  if (!ref) {
    return <div className="p-6 text-sm text-muted-foreground">无法打开此资源（{tab.id}）</div>
  }
  if (ref.scheme === "node") return renderNodeResource(ref)
  return <React.Suspense fallback={Spinner}>{renderConnectedResource(ref)}</React.Suspense>
}

function renderTabBody(tab: Tab): React.ReactNode {
  if (tab.kind === FILE_ENGINE_TAB_KIND) return renderFileEngineTab(tab)
  if (tab.kind === RESOURCE_TAB_KIND) return renderResourceTab(tab)

  // 节点级标签 (一切皆标签): params={kind,id} → 解析 NodeRef → 查节点查看器 → <Comp nodeId/>。
  if (tab.kind === "node") {
    const resourceRef = nodeResourceRefForTab(tab)
    if (!resourceRef) {
      return <div className="p-6 text-sm text-muted-foreground">无法打开此内容（{tab.id}）</div>
    }
    return renderNodeResource(resourceRef)
  }

  const entry = isStaticTabKind(tab.kind) ? REGISTRY[tab.kind] : undefined
  if (!entry) {
    return <div className="p-6 text-sm text-muted-foreground">未知的标签类型：{tab.kind}</div>
  }
  return <React.Suspense fallback={Spinner}>{entry.render(tab)}</React.Suspense>
}

export function TabContent({ tab }: { tab: Tab }) {
  // 标签级错误边界: 单标签渲染崩溃 / chunk 加载失败只炸掉本面板 (错误卡 + 重试),
  // 标签条、侧栏与其他标签全部存活 —— 不再击穿 layout 落到 global-error 替换整个外壳。
  return <ErrorBoundary label="此标签">{renderTabBody(tab)}</ErrorBoundary>
}
