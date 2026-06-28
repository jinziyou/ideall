"use client"

// Tauri 桌面自定义标题栏 —— 禁用系统装饰后自绘 Minus / Square / X, 避免 Windows 原生最小化钮图标异常。
import * as React from "react"
import { Minus, Square, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"

type WinApi = typeof import("@tauri-apps/api/window")

async function getWindowApi(): Promise<WinApi> {
  return import("@tauri-apps/api/window")
}

function TitleBarButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-8 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  )
}

export default function WindowTitleBar() {
  const [visible, setVisible] = React.useState(false)
  const [maximized, setMaximized] = React.useState(false)

  React.useEffect(() => {
    if (!isTauri()) return
    setVisible(true)
    let unlisten: (() => void) | undefined
    let alive = true
    ;(async () => {
      const { getCurrentWindow } = await getWindowApi()
      const win = getCurrentWindow()
      if (!alive) return
      setMaximized(await win.isMaximized())
      unlisten = await win.onResized(async () => {
        setMaximized(await win.isMaximized())
      })
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [])

  if (!visible) return null

  return (
    <header className="flex shrink-0 items-stretch border-b bg-card" data-tauri-drag-region>
      <div className="flex min-w-0 flex-1 items-center justify-center px-2" data-tauri-drag-region>
        <span className="text-xs font-medium tracking-wide text-muted-foreground">ideall</span>
      </div>
      <div className="flex shrink-0 items-stretch">
        <TitleBarButton
          label="最小化"
          onClick={() =>
            void getWindowApi().then(({ getCurrentWindow }) => getCurrentWindow().minimize())
          }
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={2.25} />
        </TitleBarButton>
        <TitleBarButton
          label={maximized ? "还原" : "最大化"}
          onClick={() =>
            void getWindowApi().then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
          }
        >
          <Square className="h-3 w-3" strokeWidth={2.25} />
        </TitleBarButton>
        <TitleBarButton
          label="关闭"
          onClick={() =>
            void getWindowApi().then(({ getCurrentWindow }) => getCurrentWindow().close())
          }
          className="hover:bg-destructive hover:text-destructive-foreground"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.25} />
        </TitleBarButton>
      </div>
    </header>
  )
}
