"use client"

// 五分区活动栏。一级入口固定同时可见。

import { cn } from "@/lib/utils"
import { IDEALL_ROOT_REF } from "@/filesystem/root-ref"
import { NAVIGATION_SECTIONS, navigationSectionForEntry } from "./navigation-sections"
import { toggleFileRoot, useActiveRootId, useSidebarCollapsed } from "./store"
import { useNavigationDirectory } from "./use-navigation-directory"

export default function ActivityBar() {
  const activeRootId = useActiveRootId()
  const sidebarCollapsed = useSidebarCollapsed()
  const navigation = useNavigationDirectory(IDEALL_ROOT_REF)
  const loadedSections = navigation.items.flatMap(({ entry }) => {
    const section = navigationSectionForEntry(entry)
    return section ? [section] : []
  })
  const sections = loadedSections.length > 0 ? loadedSections : NAVIGATION_SECTIONS

  return (
    <aside className="hidden h-full w-14 shrink-0 flex-col items-center overflow-y-auto border-r bg-card px-2 py-2.5 md:flex">
      <div className="flex w-full flex-col gap-1">
        {sections.map((section) => {
          const Icon = section.icon
          const active = activeRootId === section.id
          return (
            <button
              key={section.id}
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => toggleFileRoot(section.id, section.path)}
              aria-current={active ? "true" : undefined}
              aria-expanded={active && !sidebarCollapsed}
              title={section.label}
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
                  active ? "text-primary" : section.colorClass,
                )}
              />
              <span className="max-w-12 truncate leading-none">{section.label}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
