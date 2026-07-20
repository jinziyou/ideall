"use client"

// Tauri 无边框窗口的窗控按钮组 (Minus / Square / X) —— 并入顶栏 (桌面) / 顶部移动栏 (窄窗) 最右侧,
// 不再独占一条满宽标题栏 (与 VS Code / Linear / Arc 一致: 标题栏即顶栏)。
// 非 Tauri (web / PWA) 返回 null; 窗口拖拽由所在栏的 data-tauri-drag-region 提供。
//
// 点击走 pointerdown + 自定义 invoke (与最大化同路径), 避免:
// 1) Windows 无边框窗右上角系统缩放热区吞掉 click;
// 2) 动态 import("@tauri-apps/api/window") 在 HMR 下失效而最大化仍可用。
import * as React from "react"
import { Minus, Square, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  isTauri,
  windowClose,
  windowMinimize,
  windowQueryMaximized,
  windowToggleMaximize,
} from "@/lib/tauri"

/** Windows 式「还原」图标 (两个重叠方框, 非最小化减号)。 */
function RestoreIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={className} aria-hidden>
      <rect
        x="3.5"
        y="0.75"
        width="7.5"
        height="7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <rect
        x="0.75"
        y="3.5"
        width="7.5"
        height="7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
      />
    </svg>
  )
}

function TitleBarButton({
  label,
  onAction,
  className,
  children,
}: {
  label: string
  onAction: () => void | Promise<unknown>
  className?: string
  children: React.ReactNode
}) {
  const fired = React.useRef(false)
  const runAction = () => {
    void Promise.resolve(onAction()).catch(() => {})
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // 无边框窗: 拖拽区 / 系统缩放边框会吞 mousedown→click; 显式 no-drag + pointerdown 触发。
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        e.preventDefault()
        fired.current = true
        runAction()
      }}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        // pointerdown 已触发则跳过, 避免双次调用; 触控/键盘仍可走 click。
        if (fired.current) {
          fired.current = false
          return
        }
        runAction()
      }}
      className={cn(
        "relative flex h-full w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
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
        setMaximized(await windowQueryMaximized())
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        if (!alive) return
        unlisten = await getCurrentWindow().onResized(async () => {
          setMaximized(await windowQueryMaximized())
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

  // 勿贴死右缘: Windows 无边框窗边缘是系统缩放命中区, 会抢走关闭钮。
  // pr-2 (~8px) 把关闭钮移出热区; 仍靠右, 符合窗控惯例。
  return (
    <div className="relative z-60 ml-1 flex shrink-0 items-stretch self-stretch pr-2 pointer-events-auto">
      <TitleBarButton label="最小化" onAction={() => windowMinimize()}>
        <Minus className="h-3.5 w-3.5" strokeWidth={2.25} />
      </TitleBarButton>
      <TitleBarButton
        label={maximized ? "还原" : "最大化"}
        onAction={() => windowToggleMaximize().then((m) => setMaximized(m))}
      >
        {maximized ? (
          <RestoreIcon className="h-3 w-3" />
        ) : (
          <Square className="h-3 w-3" strokeWidth={2.25} />
        )}
      </TitleBarButton>
      <TitleBarButton
        label="关闭"
        onAction={() => windowClose()}
        className="hover:bg-destructive hover:text-destructive-foreground"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.25} />
      </TitleBarButton>
    </div>
  )
}
