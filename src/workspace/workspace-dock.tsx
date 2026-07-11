"use client"

import * as React from "react"
import {
  AudioLines,
  Database,
  GitBranch,
  Loader2,
  PanelBottomClose,
  Terminal,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { IconButton } from "@/ui/icon-button"
import { setDevelopmentTool, setWorkspaceKind, useDevelopmentTool, useWorkspaceKind } from "./store"

const AudioPage = React.lazy(() => import("@/plugins/audio/audio-page"))
const DatabasePage = React.lazy(() => import("@/plugins/database/database-page"))
const GitPage = React.lazy(() => import("@/plugins/git/git-page"))
const ShellPage = React.lazy(() => import("@/plugins/shell/shell-page"))

const fallback = (
  <div className="grid h-full place-items-center text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" />
  </div>
)

export default function WorkspaceDock() {
  const workspace = useWorkspaceKind()
  const developmentTool = useDevelopmentTool()
  const [audioMounted, setAudioMounted] = React.useState(workspace === "audio")
  const [developmentMounted, setDevelopmentMounted] = React.useState(workspace === "development")

  React.useEffect(() => {
    if (workspace === "audio") setAudioMounted(true)
    if (workspace === "development") setDevelopmentMounted(true)
  }, [workspace])

  const visible = workspace !== "files"
  if (!visible && !audioMounted && !developmentMounted) return null

  return (
    <section
      aria-label={workspace === "audio" ? "音频工作区工具" : "开发工作区工具"}
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        "relative z-20 flex shrink-0 flex-col overflow-hidden bg-card transition-[height,border-color] duration-200",
        visible
          ? "h-[min(48dvh,30rem)] border-t border-border md:h-[min(42dvh,28rem)]"
          : "h-0 border-t border-transparent",
      )}
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2.5">
        {workspace === "audio" ? (
          <div className="flex items-center gap-2 text-sm font-medium">
            <AudioLines className="h-4 w-4 text-primary" />
            音频播放
          </div>
        ) : (
          <div role="group" aria-label="开发工具" className="flex h-full items-center gap-0.5">
            <DockTab
              active={developmentTool === "git"}
              icon={GitBranch}
              label="Git"
              onClick={() => setDevelopmentTool("git")}
            />
            <DockTab
              active={developmentTool === "database"}
              icon={Database}
              label="数据库"
              onClick={() => setDevelopmentTool("database")}
            />
            <DockTab
              active={developmentTool === "shell"}
              icon={Terminal}
              label="终端"
              onClick={() => setDevelopmentTool("shell")}
            />
          </div>
        )}
        <IconButton
          size="sm"
          title="返回文件工作区"
          aria-label="关闭工作区工具"
          onClick={() => setWorkspaceKind("files")}
        >
          <PanelBottomClose className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden pb-[calc(4rem+max(env(safe-area-inset-bottom),0.35rem))] md:pb-0">
        {audioMounted && (
          <div className={cn("h-full overflow-auto", workspace !== "audio" && "hidden")}>
            <React.Suspense fallback={fallback}>
              <AudioPage embedded />
            </React.Suspense>
          </div>
        )}
        {developmentMounted && (
          <div className={cn("h-full", workspace !== "development" && "hidden")}>
            <div
              inert={developmentTool !== "git"}
              className={cn("h-full overflow-auto", developmentTool !== "git" && "hidden")}
            >
              <React.Suspense fallback={fallback}>
                <GitPage embedded />
              </React.Suspense>
            </div>
            <div
              inert={developmentTool !== "database"}
              className={cn("h-full overflow-auto", developmentTool !== "database" && "hidden")}
            >
              <React.Suspense fallback={fallback}>
                <DatabasePage embedded />
              </React.Suspense>
            </div>
            <div
              inert={developmentTool !== "shell"}
              className={cn("h-full", developmentTool !== "shell" && "hidden")}
            >
              <React.Suspense fallback={fallback}>
                <ShellPage embedded />
              </React.Suspense>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function DockTab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: typeof GitBranch
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-shell px-2.5 text-xs font-medium transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
