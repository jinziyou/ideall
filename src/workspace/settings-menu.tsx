"use client"

// 右上角设置齿轮 → 打开「设置」标签页 (与其他面板一致, 不再用弹层)。
import { Settings } from "lucide-react"
import { openSettings } from "./store"

export default function SettingsMenu() {
  return (
    <button
      type="button"
      aria-label="设置"
      title="设置"
      onClick={() => openSettings()}
      className="flex h-8 w-8 items-center justify-center rounded-shell text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Settings className="h-[1.1rem] w-[1.1rem]" />
    </button>
  )
}
