"use client"

// 合成文件系统根目录不显示；活动栏展示根的直接子树。每个按钮只负责选择
// 一个空间锚点，二级侧栏再展示该目录的完整文件树。

import { Folder } from "lucide-react"
import { cn } from "@/lib/utils"
import { coreFileRoot, isCoreFileRootId, mountedFileRootId } from "./file-roots"
import {
  toggleFileRoot,
  toggleMountedFileRoot,
  useActiveRootId,
  useSidebarCollapsed,
} from "./store"
import { useRootDirectoryEntries } from "./use-root-directory-entries"

export default function ActivityBar() {
  const activeRootId = useActiveRootId()
  const sidebarCollapsed = useSidebarCollapsed()
  const rootEntries = useRootDirectoryEntries()

  return (
    <aside className="hidden h-full w-14 shrink-0 flex-col items-center overflow-y-auto border-r bg-card px-2 py-2.5 md:flex">
      <div className="flex w-full flex-col gap-1">
        {rootEntries.map((entry) => {
          const core = isCoreFileRootId(entry.entryId) ? coreFileRoot(entry.entryId) : null
          const rootId = core?.id ?? mountedFileRootId(entry.target)
          const Icon = core?.icon ?? Folder
          const active = activeRootId === rootId
          return (
            <button
              key={entry.entryId}
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() =>
                core ? toggleFileRoot(core.id) : toggleMountedFileRoot(entry.target)
              }
              aria-current={active ? "true" : undefined}
              aria-expanded={active && !sidebarCollapsed}
              title={entry.name}
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
                className={cn(
                  "h-[1.2rem] w-[1.2rem]",
                  active ? "text-primary" : core?.colorClass,
                )}
              />
              <span className="max-w-12 truncate leading-none">{entry.name}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
