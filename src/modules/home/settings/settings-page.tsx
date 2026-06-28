"use client"

// 「我的 · 设置」标签内容 —— 外观 / 本机状态 / 已连接应用 (原顶栏设置弹层)。
import { Settings } from "lucide-react"
import ThemeToggle from "@/shell/theme-toggle"
import { LocalDeviceStatus } from "@/shell/local-device-chip"
import { ConnectedApps } from "@/plugins/embed/connected-apps"

export default function SettingsPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Settings className="h-6 w-6 text-muted-foreground" />
          设置
        </h1>
      </div>

      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">外观</span>
          <ThemeToggle />
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <LocalDeviceStatus />
      </section>

      <section className="rounded-lg border bg-card p-4">
        <ConnectedApps />
      </section>
    </div>
  )
}
