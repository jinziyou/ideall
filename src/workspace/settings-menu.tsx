"use client"

// 右上角设置齿轮: 外观(主题切换) + 本机系统状态 (跨端同步 / 本地存储 / 发布身份)。
import { Settings } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover"
import { Separator } from "@/ui/separator"
import ThemeToggle from "@/shell/theme-toggle"
import { LocalDeviceStatus } from "@/shell/local-device-chip"
import { ConnectedApps } from "@/plugins/embed/connected-apps"

export default function SettingsMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="设置"
          title="设置"
          className="flex h-8 w-8 items-center justify-center rounded-shell text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="h-[1.1rem] w-[1.1rem]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">外观</span>
          <ThemeToggle />
        </div>
        <Separator className="my-3" />
        <LocalDeviceStatus />
        <ConnectedApps />
      </PopoverContent>
    </Popover>
  )
}
