"use client"

// 合成文件系统根目录不显示；活动栏展示根的直接子树。每个按钮只负责选择
// 一个空间锚点，二级侧栏再展示该目录的完整文件树。

import * as React from "react"
import { Fragment } from "react"
import { Folder } from "lucide-react"
import { cn } from "@/lib/utils"
import type { DirectoryEntry } from "@protocol/file-system"
import { readFileDirectory, watchFile } from "@/filesystem/registry"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import { CORE_FILE_ROOTS, mountedFileRootId } from "./file-roots"
import {
  toggleFileRoot,
  toggleMountedFileRoot,
  useActiveRootId,
  useSidebarCollapsed,
} from "./store"

function BarDivider() {
  return <div aria-hidden className="my-0.5 h-px w-8 shrink-0 bg-border" />
}

export default function ActivityBar() {
  const activeRootId = useActiveRootId()
  const sidebarCollapsed = useSidebarCollapsed()
  const [mounts, setMounts] = React.useState<DirectoryEntry[]>([])

  React.useEffect(() => {
    let alive = true
    const load = () =>
      readFileDirectory(ideallRootFileSystem.descriptor.root, {
        actor: "ui",
        permissions: [],
        intent: "directory",
      })
        .then((page) => {
          if (alive) setMounts(page.entries.filter((entry) => entry.kind === "mount"))
        })
        .catch(() => {})
    void load()
    let dispose: (() => void) | undefined
    try {
      dispose = watchFile(
        ideallRootFileSystem.descriptor.root,
        { actor: "ui", permissions: [], intent: "watch" },
        () => void load(),
      )?.dispose
    } catch {
      /* composition root may still be booting */
    }
    return () => {
      alive = false
      dispose?.()
    }
  }, [])

  return (
    <aside className="hidden h-full w-14 shrink-0 flex-col items-center overflow-y-auto border-r bg-card px-2 py-2.5 md:flex">
      <div className="flex w-full flex-col gap-1">
        {CORE_FILE_ROOTS.map((root, index) => {
          const Icon = root.icon
          const active = activeRootId === root.id
          const divider = root.id === "apps" || root.id === "info" || root.id === "system"
          return (
            <Fragment key={root.id}>
              {index > 0 && divider && <BarDivider />}
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => toggleFileRoot(root.id)}
                aria-current={active ? "true" : undefined}
                aria-expanded={active && !sidebarCollapsed}
                title={root.label}
                className={cn(
                  "relative flex w-full shrink-0 flex-col items-center justify-center gap-0.5 rounded-shell py-1.5 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {active && (
                  <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                )}
                <Icon
                  className={cn("h-[1.2rem] w-[1.2rem]", active ? "text-primary" : root.colorClass)}
                />
                <span className="max-w-12 truncate leading-none">{root.label}</span>
              </button>
            </Fragment>
          )
        })}
        {mounts.length > 0 && <BarDivider />}
        {mounts.map((entry) => {
          const id = mountedFileRootId(entry.target)
          const active = activeRootId === id
          return (
            <button
              key={entry.entryId}
              type="button"
              title={entry.name}
              aria-current={active ? "true" : undefined}
              aria-expanded={active && !sidebarCollapsed}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => toggleMountedFileRoot(entry.target)}
              className={cn(
                "relative flex w-full shrink-0 flex-col items-center justify-center gap-0.5 rounded-shell py-1.5 text-[11px] font-medium transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {active && (
                <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
              )}
              <Folder className={cn("h-[1.2rem] w-[1.2rem]", active && "text-primary")} />
              <span className="max-w-12 truncate leading-none">{entry.name}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
