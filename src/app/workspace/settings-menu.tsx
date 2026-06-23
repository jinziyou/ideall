"use client"

// 右上角设置齿轮: 外观(主题切换) + 本机系统状态 (跨端同步 / 本地存储 / 发布身份)。
import { Settings } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import ThemeToggle from "@/app/shell/theme-toggle"
import { LocalDeviceStatus } from "@/app/shell/local-device-chip"

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
      </PopoverContent>
    </Popover>
  )
}
