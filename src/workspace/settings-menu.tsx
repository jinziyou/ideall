"use client"

// 右上角设置齿轮 → 打开「设置」标签页 (与其他面板一致, 不再用弹层)。
import { Settings } from "lucide-react"
import { openSettings } from "./store"
import { IconButton } from "@/ui/icon-button"

export default function SettingsMenu() {
  return (
    <IconButton
      aria-label="设置"
      title="设置"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => openSettings()}
    >
      <Settings className="h-[1.1rem] w-[1.1rem]" />
    </IconButton>
  )
}
