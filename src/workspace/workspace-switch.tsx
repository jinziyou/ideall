"use client"

import { AudioLines, Code2, Files } from "lucide-react"
import { cn } from "@/lib/utils"
import { IconButton } from "@/ui/icon-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import type { WorkspaceKind } from "./types"
import { setWorkspaceKind, useWorkspaceKind } from "./store"

const WORKSPACES = [
  { id: "files", label: "文件", icon: Files },
  { id: "audio", label: "音频", icon: AudioLines },
  { id: "development", label: "开发", icon: Code2 },
] as const satisfies readonly {
  id: WorkspaceKind
  label: string
  icon: typeof Files
}[]

function CompactWorkspaceSwitch() {
  const workspace = useWorkspaceKind()
  const current = WORKSPACES.find((item) => item.id === workspace) ?? WORKSPACES[0]
  const CurrentIcon = current.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={`切换工作区，当前：${current.label}`}
          title={`${current.label}工作区`}
        >
          <CurrentIcon className="h-[1.05rem] w-[1.05rem]" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuLabel>工作区</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={workspace}
          onValueChange={(value) => setWorkspaceKind(value as WorkspaceKind)}
        >
          {WORKSPACES.map((item) => {
            const Icon = item.icon
            return (
              <DropdownMenuRadioItem key={item.id} value={item.id} className="gap-2 pl-8">
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function WorkspaceSwitch({ compact = false }: { compact?: boolean }) {
  const workspace = useWorkspaceKind()

  if (compact) return <CompactWorkspaceSwitch />

  return (
    <>
      <div className="xl:hidden">
        <CompactWorkspaceSwitch />
      </div>
      <div
        role="group"
        aria-label="工作区"
        className="hidden shrink-0 items-center gap-0.5 rounded-shell bg-secondary/60 p-0.5 xl:flex"
      >
        {WORKSPACES.map((item) => {
          const Icon = item.icon
          const active = workspace === item.id
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => setWorkspaceKind(item.id)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-shell px-2.5 py-1 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          )
        })}
      </div>
    </>
  )
}
