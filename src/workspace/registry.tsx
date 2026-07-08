"use client"

// 标签内容注册表: kind → 渲染函数 + 布局模式 (keep-alive 由 tab-host 负责)。
// 渲染函数返回 JSX (内部用 React.lazy 按需加载, 切到该标签才下载对应 chunk)。
// layout: "fill" = 组件自管理全高/滚动 (笔记 / AI / 嵌入 iframe); "padded" = 居中限宽滚动容器。

import * as React from "react"
import { Loader2 } from "lucide-react"
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
import { resolveViewer } from "./node-viewers"
import { parseNodeParams } from "./node-tab"

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
  // 节点级标签: layout 取自查看器注册表 (file 的 mime 分派在叶子, 故按 kind 即可定 layout)。
  if (tab.kind === "node") {
    const ref = parseNodeParams(tab.params)
    return ref ? (resolveViewer(ref.kind)?.layout ?? "padded") : "padded"
  }
  return tabDefinitionLayout(tab.kind) ?? "padded"
}

function renderTabBody(tab: Tab): React.ReactNode {
  // 节点级标签 (一切皆标签): params={kind,id} → 解析 NodeRef → 查节点查看器 → <Comp nodeId/>。
  if (tab.kind === "node") {
    const ref = parseNodeParams(tab.params)
    const entry = ref ? resolveViewer(ref.kind) : null
    if (!ref || !entry) {
      return (
        <div className="p-6 text-sm text-muted-foreground">
          {ref ? `暂不支持这种内容（${ref.kind}）` : `无法打开此内容（${tab.id}）`}
        </div>
      )
    }
    const Viewer = entry.viewer
    return (
      <React.Suspense fallback={Spinner}>
        <Viewer nodeId={ref.id} />
      </React.Suspense>
    )
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
