"use client"

// Tauri 无边框窗口的窗控按钮组 (Minus / Square / X) —— 并入顶栏 (桌面) / 顶部移动栏 (窄窗) 最右侧,
// 不再独占一条满宽标题栏 (与 VS Code / Linear / Arc 一致: 标题栏即顶栏)。
// 非 Tauri (web / PWA) 返回 null; 窗口拖拽由所在栏的 data-tauri-drag-region 提供。
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
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn(
        "flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  )
}

export default function WindowControls() {
  const [visible, setVisible] = React.useState(false)
  const [maximized, setMaximized] = React.useState(false)

  React.useEffect(() => {
    if (!isTauri()) return
    setVisible(true)
    let unlisten: (() => void) | undefined
    let alive = true
    ;(async () => {
      try {
        const { getCurrentWindow } = await getWindowApi()
        const win = getCurrentWindow()
        if (!alive) return
        setMaximized(await win.isMaximized())
        unlisten = await win.onResized(async () => {
          setMaximized(await win.isMaximized())
        })
      } catch {
        // Dev HMR 可能使动态 import 的 chunk 失效; 忽略至下次挂载/刷新。
      }
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [])

  if (!visible) return null

  // -mr-3 抵消所在栏的 px-3, 让关闭钮贴到窗口右上角 (惯例: 甩到角落即可关闭); self-stretch 撑满栏高。
  return (
    <div className="-mr-3 ml-1 flex shrink-0 items-stretch self-stretch">
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
  )
}
