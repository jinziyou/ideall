"use client"

import * as React from "react"
import { AppWindow, Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import type { IdeallFile } from "@protocol/file-system"
import { invokeFileAction } from "@/filesystem/registry"
import { installedAppFromFile } from "@/modules/apps/installed-app-file-system"
import { appIconSrc } from "@/lib/installed-apps"
import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { EmptyState } from "@/ui/empty-state"
import { Panel } from "@/ui/panel"

const UI_ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const

function errorDescription(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export default function InstalledAppEngine({ file }: { file: IdeallFile }) {
  const app = installedAppFromFile(file)
  const [iconSrc, setIconSrc] = React.useState<string | null>(null)
  const [iconFailed, setIconFailed] = React.useState(false)
  const [launching, setLaunching] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    setIconSrc(null)
    setIconFailed(false)
    if (!app?.iconPath) {
      return () => {
        alive = false
      }
    }
    void appIconSrc(app.id).then((src) => {
      if (alive) setIconSrc(src)
    })
    return () => {
      alive = false
    }
  }, [app?.iconPath, app?.id])

  if (!app) {
    return (
      <EmptyState
        icon={AppWindow}
        title="无法读取应用信息"
        description="此文件不包含有效的本机应用 metadata。"
        bordered={false}
        className="h-full"
      />
    )
  }

  const launch = async () => {
    setLaunching(true)
    try {
      await invokeFileAction(file.ref, "launch", undefined, UI_ACTION_CONTEXT)
      toast.success(`已启动 ${app.name}`)
    } catch (reason) {
      toast.error("启动应用失败", { description: errorDescription(reason) })
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="flex items-center gap-4">
          {iconSrc && !iconFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- 本机图标经 Rust 读为 data URL
            <img
              src={iconSrc}
              alt=""
              onError={() => setIconFailed(true)}
              className="h-16 w-16 shrink-0 rounded-lg object-contain ring-1 ring-border/30"
            />
          ) : (
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border/30">
              <AppWindow className="h-7 w-7" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{app.name}</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {app.comment || "本机已安装应用"}
            </p>
          </div>
          <Button onClick={() => void launch()} disabled={launching}>
            {launching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            启动应用
          </Button>
        </div>

        <Panel title="应用信息">
          <dl className="divide-y">
            <div className="flex items-start justify-between gap-4 pb-4">
              <dt className="text-sm text-muted-foreground">应用 ID</dt>
              <dd className="min-w-0 break-all text-right text-sm">{app.id}</dd>
            </div>
            <div className="flex items-start justify-between gap-4 py-4">
              <dt className="text-sm text-muted-foreground">数据来源</dt>
              <dd className="text-right text-sm">{file.source.label ?? file.source.id}</dd>
            </div>
            <div className="flex items-start justify-between gap-4 pt-4">
              <dt className="text-sm text-muted-foreground">分类</dt>
              <dd className="flex max-w-md flex-wrap justify-end gap-2">
                {app.categories.length > 0 ? (
                  app.categories.map((category) => <Chip key={category}>{category}</Chip>)
                ) : (
                  <span className="text-sm text-muted-foreground">未分类</span>
                )}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  )
}
