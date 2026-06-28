"use client"

// 本地模式「应用」视图: 列举本机已安装应用, 支持搜索/分类筛选与一键启动。

import * as React from "react"
import { AppWindow, Loader2, RefreshCw, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  appIconSrc,
  launchInstalledApp,
  listInstalledApps,
  type InstalledApp,
} from "@/lib/installed-apps"
import { isTauri } from "@/lib/tauri"
import { Input } from "@/ui/input"
import { Button } from "@/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card"
import { EmptyState } from "@/ui/empty-state"

function AppIcon({ app, size = "md" }: { app: InstalledApp; size?: "md" | "lg" }) {
  const [src, setSrc] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState(false)
  const dim = size === "lg" ? "h-12 w-12" : "h-11 w-11"
  const text = size === "lg" ? "text-base" : "text-sm"

  React.useEffect(() => {
    let cancelled = false
    setFailed(false)
    void appIconSrc(app.iconPath).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [app.iconPath])

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 本机图标经 Rust 读为 data URL
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className={cn(dim, "shrink-0 rounded-[14px] object-contain shadow-sm ring-1 ring-border/30")}
      />
    )
  }

  return (
    <span
      className={cn(
        dim,
        "flex shrink-0 items-center justify-center rounded-[14px] bg-muted/80 font-semibold text-muted-foreground ring-1 ring-border/30",
        text,
      )}
    >
      {app.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function groupByCategory(apps: InstalledApp[]): Map<string, InstalledApp[]> {
  const map = new Map<string, InstalledApp[]>()
  for (const app of apps) {
    const cats = app.categories.length > 0 ? app.categories : ["其他"]
    for (const cat of cats) {
      const list = map.get(cat) ?? []
      list.push(app)
      map.set(cat, list)
    }
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  }
  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b, "zh-CN")))
}

function AppsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i} className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <div className="h-4 w-24 animate-pulse rounded bg-muted/60" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((__, j) => (
                <div
                  key={j}
                  className="flex flex-col items-center gap-3 rounded-xl bg-muted/20 p-5"
                >
                  <div className="h-11 w-11 animate-pulse rounded-[14px] bg-muted/50" />
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
  app: InstalledApp
  launching: boolean
  onLaunch: (app: InstalledApp) => void
}) {
  return (
    <button
      type="button"
      title={app.comment ?? app.id}
      disabled={launching}
      onClick={() => onLaunch(app)}
      className={cn(
        "group flex flex-col items-center gap-3 rounded-xl p-5 text-center transition-[background-color,box-shadow,transform]",
        "bg-background/50 ring-1 ring-border/40",
        "hover:bg-background hover:shadow-sm hover:ring-spoke-tool/25",
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

export default function AppsPage() {
  const [apps, setApps] = React.useState<InstalledApp[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [category, setCategory] = React.useState<string | null>(null)
  const [launching, setLaunching] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listInstalledApps()
      setApps(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载应用列表失败")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const categories = React.useMemo(() => {
    const set = new Set<string>()
    for (const app of apps) {
      for (const c of app.categories.length > 0 ? app.categories : ["其他"]) set.add(c)
    }
    return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"))
  }, [apps])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return apps.filter((app) => {
      if (category && !(app.categories.length > 0 ? app.categories : ["其他"]).includes(category)) {
        return false
      }
      if (!q) return true
      const hay = [app.name, app.comment ?? "", app.id, ...app.categories].join(" ").toLowerCase()
      return hay.includes(q)
    })
  }, [apps, query, category])

  const grouped = React.useMemo(() => groupByCategory(filtered), [filtered])
  const showGrouped = !query.trim() && !category

  const handleLaunch = async (app: InstalledApp) => {
    setLaunching(app.id)
    try {
      await launchInstalledApp(app.id)
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
        <EmptyState
          icon={AppWindow}
          title="本机应用列表仅在桌面 App 中可用"
          description="请使用 pnpm app:dev 启动 Tauri 桌面客户端。"
          bordered
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 pb-8">
      <PageHeader total={apps.length} filtered={filtered.length} loading={loading} />

      <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
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

        {categories.length > 1 && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border/50 pt-5">
            <CategoryPill active={category === null} onClick={() => setCategory(null)}>
              全部
            </CategoryPill>
            {categories.map((c) => (
              <CategoryPill
                key={c}
                active={category === c}
                onClick={() => setCategory(c === category ? null : c)}
              >
                {c}
              </CategoryPill>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <AppsSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={AppWindow}
          title={apps.length === 0 ? "未识别到已安装应用" : "没有匹配的应用"}
          description={
            apps.length === 0
              ? "请确认系统已安装桌面应用，或尝试刷新列表。"
              : "试试调整搜索词或清除分类筛选。"
          }
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
            <Card key={cat} className="border-border/60 shadow-sm">
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
        <Card className="border-border/60 shadow-sm">
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
