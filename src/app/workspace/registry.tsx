"use client"

// 标签内容注册表: kind → 渲染函数 + 布局模式 (keep-alive 由 tab-host 负责)。
// 渲染函数返回 JSX (内部用 React.lazy 按需加载, 切到该标签才下载对应 chunk)。
// layout: "fill" = 组件自管理全高/滚动 (笔记 / AI / 嵌入 iframe); "padded" = 居中限宽滚动容器。

import * as React from "react"
import { Loader2 } from "lucide-react"
import { EmbedHost } from "@/components/embed/host"
import { infoEmbedManifest, communityEmbedManifest } from "@/components/embed/manifest"
import type { SubscriptionType } from "@protocol/subscription"
import type { Tab } from "./types"

// 订阅流按类型切分: 订阅(资讯回流) = publisher/entity/search; 关注(社区回流) = peer。
const INFO_SUB_TYPES: SubscriptionType[] = ["publisher", "entity", "search"]
const PEER_SUB_TYPES: SubscriptionType[] = ["peer"]

const HubDashboard = React.lazy(() => import("@/app/home/hub-dashboard"))
const NotesManager = React.lazy(() => import("@/app/home/notes/notes-manager"))
const SyncPanel = React.lazy(() => import("@/app/home/subscriptions/sync-panel"))
const SubscriptionFeed = React.lazy(() => import("@/app/home/subscriptions/subscription-feed"))
const MyPublications = React.lazy(() => import("@/app/home/publications/my-publications"))
const FileManager = React.lazy(() => import("@/app/home/resources/file-manager"))
const BookmarkManager = React.lazy(() => import("@/app/home/bookmarks/bookmark-manager"))
const ToolSearch = React.lazy(() => import("@/components/apps/tool/search/page"))
const ToolAi = React.lazy(() => import("@/components/apps/tool/ai/page"))
const ToolNavigation = React.lazy(() => import("@/components/apps/tool/navigation/page"))

export type TabLayout = "padded" | "fill"

type Entry = { render: () => React.ReactNode; layout: TabLayout }

const REGISTRY: Record<string, Entry> = {
  "home-overview": { render: () => <HubDashboard />, layout: "padded" },
  "home-notes": { render: () => <NotesManager />, layout: "fill" },
  subscriptions: {
    render: () => (
      <div className="flex flex-col gap-6">
        <SyncPanel />
        <SubscriptionFeed types={INFO_SUB_TYPES} title="订阅流" dotClass="bg-spoke-info" />
      </div>
    ),
    layout: "padded",
  },
  following: {
    render: () => (
      <SubscriptionFeed
        types={PEER_SUB_TYPES}
        title="关注的发布者"
        dotClass="bg-spoke-community"
      />
    ),
    layout: "padded",
  },
  "home-publications": { render: () => <MyPublications />, layout: "padded" },
  "home-resources": { render: () => <FileManager />, layout: "padded" },
  "home-bookmarks": { render: () => <BookmarkManager />, layout: "padded" },
  info: { render: () => <EmbedHost manifest={infoEmbedManifest} />, layout: "fill" },
  community: { render: () => <EmbedHost manifest={communityEmbedManifest} />, layout: "fill" },
  "tool-search": { render: () => <ToolSearch />, layout: "padded" },
  "tool-ai": { render: () => <ToolAi />, layout: "padded" },
  "tool-navigation": { render: () => <ToolNavigation />, layout: "padded" },
}

export function tabLayout(kind: string): TabLayout {
  return REGISTRY[kind]?.layout ?? "padded"
}

export function TabContent({ tab }: { tab: Tab }) {
  const entry = REGISTRY[tab.kind]
  if (!entry) {
    return <div className="p-6 text-sm text-muted-foreground">未知的标签类型：{tab.kind}</div>
  }
  return (
    <React.Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      }
    >
      {entry.render()}
    </React.Suspense>
  )
}
