"use client"

// 「我的 · 设置」标签内容 —— 外观 / 本机状态 / 已连接应用 (原顶栏设置弹层)。
import { Settings } from "lucide-react"
import ThemeToggle from "@/shell/theme-toggle"
import { LocalDeviceStatus } from "@/shell/local-device-chip"
import { ConnectedApps } from "@/plugins/embed/connected-apps"
import { Panel, SettingRow } from "@/ui/panel"
import { RuntimeExtensionsPanel } from "./runtime-extensions-panel"

export default function SettingsPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Settings className="h-6 w-6 text-muted-foreground" />
          设置
        </h1>
      </div>

      <Panel>
        <SettingRow label="外观">
          <ThemeToggle />
        </SettingRow>
      </Panel>

      <Panel>
        <LocalDeviceStatus />
      </Panel>

      <Panel>
        <ConnectedApps />
      </Panel>

      <RuntimeExtensionsPanel />
    </div>
  )
}
