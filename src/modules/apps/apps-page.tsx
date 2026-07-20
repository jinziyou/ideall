"use client"

// 「本地应用」视图: 列举本机已安装应用, 支持搜索/分类筛选与一键启动。

import * as React from "react"
import { AppWindow, ChevronDown, RefreshCw, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { appIconSrc, type InstalledApp } from "@/lib/installed-apps"
import type { FileRef } from "@protocol/file-system"
import { invokeFileAction, readFileDirectory, statFile } from "@/filesystem/registry"
import { isTauri } from "@/lib/tauri"
import { Input } from "@/ui/input"
import { Button } from "@/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card"
import { EmptyState } from "@/ui/empty-state"
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover"
import { installedAppFromFile, installedAppsRootRef } from "./installed-app-file-system"

type InstalledAppItem = InstalledApp & { fileRef: FileRef }

/**
 * 标准分类的展示顺序。**手工同步约定**: 此列表必须与 src-tauri/src/installed_apps.rs 的 `category_label`
 * 输出标签集一致 —— 那边新增/改名一类, 这里须同步增改, 否则未识别标签会落入「其他」分组。
 */
const STANDARD_CATEGORY_ORDER = [
  "办公",
  "开发",
  "工具",
  "浏览器",
  "网络",
  "系统",
  "设置",
  "影音",
  "音频",
  "视频",
  "图形",
  "游戏",
  "教育",
  "科学",
  "文本",
] as const

const STANDARD_CATEGORY_SET = new Set<string>(STANDARD_CATEGORY_ORDER)

function appCategories(app: InstalledApp): string[] {
  return app.categories.length > 0 ? app.categories : ["其他"]
}

function isStandardCategory(cat: string): boolean {
  return STANDARD_CATEGORY_SET.has(cat)
}

/** 分组展示用: 优先标准分类, 否则归入「其他」。 */
function primaryDisplayCategory(app: InstalledApp): string {
  const cats = appCategories(app)
  for (const std of STANDARD_CATEGORY_ORDER) {
    if (cats.includes(std)) return std
  }
  return "其他"
}

function splitCategories(all: string[]): { standard: string[]; custom: string[] } {
  const standard: string[] = []
  const custom: string[] = []
  for (const cat of all) {
    if (isStandardCategory(cat)) standard.push(cat)
    else custom.push(cat)
  }
  standard.sort(
    (a, b) =>
      STANDARD_CATEGORY_ORDER.indexOf(a as (typeof STANDARD_CATEGORY_ORDER)[number]) -
      STANDARD_CATEGORY_ORDER.indexOf(b as (typeof STANDARD_CATEGORY_ORDER)[number]),
  )
  custom.sort((a, b) => a.localeCompare(b, "zh-CN"))
  return { standard, custom }
}

function AppIcon({ app, size = "md" }: { app: InstalledApp; size?: "md" | "lg" }) {
  const [src, setSrc] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState(false)
  const dim = size === "lg" ? "h-12 w-12" : "h-11 w-11"
  const text = size === "lg" ? "text-base" : "text-sm"

  React.useEffect(() => {
    let cancelled = false
    setFailed(false)
    if (!app.iconPath) {
      setSrc(null)
      return () => {
        cancelled = true
      }
    }
    void appIconSrc(app.id).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [app.iconPath, app.id])

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 本机图标经 Rust 读为 data URL
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className={cn(dim, "shrink-0 rounded-md object-contain ring-1 ring-border/30")}
      />
    )
  }

  return (
    <span
      className={cn(
        dim,
        "flex shrink-0 items-center justify-center rounded-md bg-muted/80 font-semibold text-muted-foreground ring-1 ring-border/30",
        text,
      )}
    >
      {app.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function groupByPrimaryCategory<T extends InstalledApp>(apps: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const app of apps) {
    const cat = primaryDisplayCategory(app)
    const list = map.get(cat) ?? []
    list.push(app)
    map.set(cat, list)
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  }
  const order = (key: string) => {
    const idx = STANDARD_CATEGORY_ORDER.indexOf(key as (typeof STANDARD_CATEGORY_ORDER)[number])
    return idx >= 0 ? idx : STANDARD_CATEGORY_ORDER.length
  }
  return new Map(
    [...map.entries()].sort(([a], [b]) => {
      const diff = order(a) - order(b)
      return diff !== 0 ? diff : a.localeCompare(b, "zh-CN")
    }),
  )
}

function AppsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i} className="border-border/60">
          <CardHeader className="pb-3">
            <div className="h-4 w-24 animate-pulse rounded bg-muted/60" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((__, j) => (
                <div
                  key={j}
                  className="flex flex-col items-center gap-3 rounded-lg bg-muted/20 p-5"
                >
                  <div className="h-11 w-11 animate-pulse rounded-md bg-muted/50" />
                  <div className="h-3 w-16 animate-pulse rounded bg-muted/50" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function AppTile({
  app,
  launching,
  onLaunch,
}: {
  app: InstalledAppItem
  launching: boolean
  onLaunch: (app: InstalledAppItem) => void
}) {
  return (
    <button
      type="button"
      title={app.comment ?? app.id}
      disabled={launching}
      onClick={() => onLaunch(app)}
      className={cn(
        "group flex flex-col items-center gap-3 rounded-lg p-5 text-center transition-[background-color,box-shadow,transform]",
        "bg-background/50 ring-1 ring-border/40",
        "hover:bg-background hover:ring-spoke-tool/25",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "active:scale-[0.98]",
        launching && "pointer-events-none opacity-50",
      )}
    >
      <AppIcon app={app} />
      <div className="flex w-full min-w-0 flex-col gap-1">
        <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {app.name}
        </span>
        {app.comment ? (
          <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {app.comment}
          </span>
        ) : null}
      </div>
    </button>
  )
}

export default function AppsPage({ rootRef = installedAppsRootRef }: { rootRef?: FileRef } = {}) {
  const [apps, setApps] = React.useState<InstalledAppItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [category, setCategory] = React.useState<string | null>(null)
  const [launching, setLaunching] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const page = await readFileDirectory(rootRef, {
        actor: "ui",
        permissions: [],
        intent: "directory",
      })
      const files = await Promise.all(
        page.entries.map((entry) =>
          statFile(entry.target, {
            actor: "ui",
            permissions: [],
            intent: "metadata",
          }).catch(() => null),
        ),
      )
      setApps(
        files.flatMap((file) => {
          if (!file) return []
          const app = installedAppFromFile(file)
          return app ? [{ ...app, fileRef: file.ref }] : []
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载应用列表失败")
    } finally {
      setLoading(false)
    }
  }, [rootRef])

  React.useEffect(() => {
    void load()
  }, [load])

  const { standardCategories, customCategories, customCategoryCounts, hasOtherGroup } =
    React.useMemo(() => {
      const set = new Set<string>()
      const counts = new Map<string, number>()
      let otherCount = 0
      for (const app of apps) {
        for (const c of appCategories(app)) {
          set.add(c)
          counts.set(c, (counts.get(c) ?? 0) + 1)
        }
        if (primaryDisplayCategory(app) === "其他") otherCount++
      }
      const { standard, custom } = splitCategories([...set])
      return {
        standardCategories: standard,
        customCategories: custom.filter((c) => c !== "其他"),
        customCategoryCounts: counts,
        hasOtherGroup: otherCount > 0,
      }
    }, [apps])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return apps.filter((app) => {
      if (category) {
        const matches =
          category === "其他"
            ? primaryDisplayCategory(app) === "其他"
            : appCategories(app).includes(category)
        if (!matches) return false
      }
      if (!q) return true
      const hay = [app.name, app.comment ?? "", app.id, ...app.categories].join(" ").toLowerCase()
      return hay.includes(q)
    })
  }, [apps, query, category])

  const grouped = React.useMemo(() => groupByPrimaryCategory(filtered), [filtered])
  const showGrouped = !query.trim() && !category

  const handleLaunch = async (app: InstalledAppItem) => {
    setLaunching(app.id)
    try {
      await invokeFileAction(app.fileRef, "launch", undefined, {
        actor: "ui",
        permissions: [],
        intent: "action",
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败")
    } finally {
      setLaunching(null)
    }
  }

  if (!isTauri()) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <PageHeader total={0} filtered={0} loading={false} />
        <EmptyState icon={AppWindow} title="本机应用列表仅在桌面 App 中可用" bordered />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 pb-8">
      <PageHeader total={apps.length} filtered={filtered.length} loading={loading} />

      <div className="rounded-lg border border-border/60 bg-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索应用名称、说明或分类…"
              className="h-10 border-border/60 bg-background pl-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            刷新
          </Button>
        </div>

        {(standardCategories.length > 0 || customCategories.length > 0) && (
          <CategoryBar
            category={category}
            onCategoryChange={setCategory}
            standardCategories={standardCategories}
            customCategories={customCategories}
            customCategoryCounts={customCategoryCounts}
            hasOtherGroup={hasOtherGroup}
          />
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <AppsSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={AppWindow}
          title={apps.length === 0 ? "未识别到已安装应用" : "没有匹配的应用"}
          action={
            apps.length === 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                重新扫描
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("")
                  setCategory(null)
                }}
              >
                清除筛选
              </Button>
            )
          }
        />
      ) : showGrouped ? (
        <div className="flex flex-col gap-6">
          {[...grouped.entries()].map(([cat, items]) => (
            <Card key={cat} className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-baseline gap-2 text-base font-semibold">
                  {cat}
                  <span className="text-xs font-normal tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {items.map((app) => (
                    <AppTile
                      key={`${cat}:${app.id}`}
                      app={app}
                      launching={launching === app.id}
                      onLaunch={(a) => void handleLaunch(a)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-baseline gap-2 text-base font-semibold">
              搜索结果
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {filtered.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map((app) => (
                <AppTile
                  key={app.id}
                  app={app}
                  launching={launching === app.id}
                  onLaunch={(a) => void handleLaunch(a)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function PageHeader({
  total,
  filtered,
  loading,
}: {
  total: number
  filtered: number
  loading: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">应用</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            识别并启动本机已安装的应用。点击图标即可打开。
          </p>
        </div>
        {!loading && total > 0 && (
          <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {filtered === total ? `${total} 个应用` : `${filtered} / ${total} 个应用`}
          </p>
        )}
      </div>
    </div>
  )
}

function CategoryPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function CategoryBar({
  category,
  onCategoryChange,
  standardCategories,
  customCategories,
  customCategoryCounts,
  hasOtherGroup,
}: {
  category: string | null
  onCategoryChange: (cat: string | null) => void
  standardCategories: string[]
  customCategories: string[]
  customCategoryCounts: Map<string, number>
  hasOtherGroup: boolean
}) {
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [moreQuery, setMoreQuery] = React.useState("")
  const customActive = category !== null && category !== "其他" && !isStandardCategory(category)

  const filteredCustom = React.useMemo(() => {
    const q = moreQuery.trim().toLowerCase()
    if (!q) return customCategories
    return customCategories.filter((c) => c.toLowerCase().includes(q))
  }, [customCategories, moreQuery])

  const pickCategory = (cat: string | null) => {
    onCategoryChange(cat)
    setMoreOpen(false)
    setMoreQuery("")
  }

  return (
    <div className="mt-5 space-y-3 border-t border-border/50 pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <CategoryPill active={category === null} onClick={() => pickCategory(null)}>
          全部
        </CategoryPill>
        {standardCategories.map((c) => (
          <CategoryPill
            key={c}
            active={category === c}
            onClick={() => pickCategory(category === c ? null : c)}
          >
            {c}
          </CategoryPill>
        ))}
        {hasOtherGroup && (
          <CategoryPill
            active={category === "其他"}
            onClick={() => pickCategory(category === "其他" ? null : "其他")}
          >
            其他
          </CategoryPill>
        )}
        {customCategories.length > 0 && (
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  customActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {customActive ? category : `更多分类 (${customCategories.length})`}
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-0">
              <div className="border-b border-border/60 p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={moreQuery}
                    onChange={(e) => setMoreQuery(e.target.value)}
                    placeholder="搜索更多分类…"
                    className="h-8 border-border/60 bg-background pl-8 text-xs"
                  />
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto p-2">
                {filteredCustom.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">无匹配分类</p>
                ) : (
                  filteredCustom.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => pickCategory(c)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                        category === c
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-foreground hover:bg-muted/60",
                      )}
                    >
                      <span className="min-w-0 truncate">{c}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {customCategoryCounts.get(c) ?? 0}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {customActive && (
        <p className="text-xs text-muted-foreground">
          已选更多分类：<span className="font-medium text-foreground">{category}</span>
          <button
            type="button"
            className="ml-2 text-primary hover:underline"
            onClick={() => pickCategory(null)}
          >
            清除
          </button>
        </p>
      )}
    </div>
  )
}
