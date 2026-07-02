"use client"

// 标签内容注册表: kind → 渲染函数 + 布局模式 (keep-alive 由 tab-host 负责)。
// 渲染函数返回 JSX (内部用 React.lazy 按需加载, 切到该标签才下载对应 chunk)。
// layout: "fill" = 组件自管理全高/滚动 (笔记 / AI / 嵌入 iframe); "padded" = 居中限宽滚动容器。

import * as React from "react"
import { Loader2 } from "lucide-react"
import { EmbedHost } from "@/plugins/embed/host"
import { infoEmbedManifest, communityEmbedManifest } from "@/plugins/embed/manifest"
import type { SubscriptionType } from "@protocol/subscription"
import type { Tab } from "./types"
import { resolveViewer } from "./node-viewers"
import { parseNodeParams } from "./node-tab"

// 关注流含全部动态来源: 发布者 / 实体 / 搜索 (资讯) + 社区发布者 peer; 内容汇入「我的」。
const FOLLOW_TYPES: SubscriptionType[] = ["publisher", "entity", "search", "peer"]

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
const BrowserView = React.lazy(() => import("./browser-view"))
const AiSettings = React.lazy(() => import("@/plugins/agent/views/ai-settings"))
const HomeSettings = React.lazy(() => import("@/modules/home/settings/settings-page"))
const AiMcp = React.lazy(() => import("@/plugins/agent/views/ai-mcp"))
const AiSkills = React.lazy(() => import("@/plugins/agent/views/ai-skills"))
const AiRules = React.lazy(() => import("@/plugins/agent/views/ai-rules"))
const AiTasks = React.lazy(() => import("@/plugins/agent/views/ai-tasks"))

export type TabLayout = "padded" | "fill"

type Entry = { render: (tab: Tab) => React.ReactNode; layout: TabLayout }

const REGISTRY: Record<string, Entry> = {
  "home-overview": { render: () => <Overview />, layout: "padded" },
  "home-notes": { render: () => <NotesManager />, layout: "padded" },
  subscriptions: {
    render: () => (
      <div className="flex flex-col gap-6">
        <SyncPanel />
        <SubscriptionFeed types={FOLLOW_TYPES} title="关注流" dotClass="bg-spoke-info" />
      </div>
    ),
    layout: "padded",
  },
  "home-publications": { render: () => <MyPublications />, layout: "padded" },
  "home-resources": { render: () => <FileManager />, layout: "padded" },
  "home-bookmarks": { render: () => <BookmarkManager />, layout: "padded" },
  "home-settings": { render: () => <HomeSettings />, layout: "padded" },
  info: { render: () => <EmbedHost manifest={infoEmbedManifest} />, layout: "fill" },
  community: { render: () => <EmbedHost manifest={communityEmbedManifest} />, layout: "fill" },
  "tool-search": { render: () => <ToolSearch />, layout: "padded" },
  "tool-ai": { render: () => <ToolAi />, layout: "padded" },
  "tool-navigation": { render: () => <ToolNavigation />, layout: "padded" },
  apps: { render: () => <AppsPage />, layout: "padded" },
  "browser-view": { render: () => <BrowserView />, layout: "fill" },
  // AI 区段标签 (module:"agent", mode-中性)。任务标签按 params.workspaceId 实例化。
  "ai-settings": { render: () => <AiSettings />, layout: "fill" },
  "ai-mcp": { render: () => <AiMcp />, layout: "fill" },
  "ai-skills": { render: () => <AiSkills />, layout: "fill" },
  "ai-rules": { render: () => <AiRules />, layout: "fill" },
  "ai-tasks": {
    render: (tab) => <AiTasks workspaceId={tab.params?.workspaceId ?? ""} />,
    layout: "fill",
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
  return REGISTRY[tab.kind]?.layout ?? "padded"
}

export function TabContent({ tab }: { tab: Tab }) {
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

  const entry = REGISTRY[tab.kind]
  if (!entry) {
    return <div className="p-6 text-sm text-muted-foreground">未知的标签类型：{tab.kind}</div>
  }
  return <React.Suspense fallback={Spinner}>{entry.render(tab)}</React.Suspense>
}
