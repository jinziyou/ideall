"use client"

// 右侧 AI 对话栏 (AI 原生): 宽屏 (lg+) 右停靠列, 移动端与平板 (<lg) 全屏覆盖。
//
// keep-alive: 首次打开后保持挂载, 关闭 = 隐藏 (w-0/opacity-0 + inert), 与 tab-host 的
// 「切标签不重载」同一哲学 —— 输入到一半的 prompt、流式中的回复、滚动位置不再随关闭丢失。
// 开合有 200ms 过渡 (桌面宽度滑入与二级侧栏对齐; 移动淡入上滑), motion-reduce 由全局样式兜底。
//
// 移动可访问性: <lg 是全屏覆盖层 → dialog 语义 (role/aria-modal) + 打开时焦点移入 + Esc 关闭
// (壳层同时对被遮内容 inert, 见 workspace-shell); safe-area 内边距防刘海/Home 指示条遮挡。
import * as React from "react"
import { Bot, Maximize2, Plus, Settings, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/lib/use-media-query"
import AgentPanel, { type AgentPanelHandle } from "@/plugins/agent/views/agent-panel"
import { getActiveWorkspace } from "@/plugins/agent/lib/agent-workspace"
import {
  getAgentSettings,
  isConfigured,
  subscribeAgentSettings,
} from "@/plugins/agent/lib/agent-settings"
import { SurfacePanel } from "@/ui/panel"
import { IconButton } from "@/ui/icon-button"
import { useRightPanelOpen, setRightPanel, openAiTasks, openAiSettings } from "./store"

export default function RightAiPanel() {
  const open = useRightPanelOpen()
  const isLg = useMediaQuery("(min-width: 1024px)")
  const panelRef = React.useRef<AgentPanelHandle>(null)
  const asideRef = React.useRef<HTMLElement>(null)
  const settings = React.useSyncExternalStore(
    subscribeAgentSettings,
    getAgentSettings,
    getAgentSettings,
  )
  const configured = isConfigured(settings)

  // keep-alive: 首次打开才挂载 (不为从未用过 AI 的会话付出面板成本), 之后关闭仅隐藏。
  const [everOpened, setEverOpened] = React.useState(false)
  React.useEffect(() => {
    if (open) setEverOpened(true)
  }, [open])

  // 移动全屏覆盖打开时把焦点移入面板 (dialog 语义的最低要求; 关闭后焦点自然回文档)。
  React.useEffect(() => {
    if (open && !isLg) asideRef.current?.focus()
  }, [open, isLg])

  // 移动端系统返回优先关面板: 打开覆盖层时压一条同 URL 哨兵历史, Android 返回键 /
  // iOS 边缘滑动先弹哨兵 (关面板), 不直接导航离开。经 X/Esc 关闭则吃掉哨兵, 保持历史干净。
  const sentinelRef = React.useRef(false)
  const isMobileOverlay = open && !isLg
  React.useEffect(() => {
    if (!isMobileOverlay) return
    window.history.pushState({ ideallAiPanel: true }, "", window.location.href)
    sentinelRef.current = true
    const onPop = () => {
      sentinelRef.current = false
      setRightPanel(false)
    }
    window.addEventListener("popstate", onPop)
    return () => {
      window.removeEventListener("popstate", onPop)
      if (sentinelRef.current) {
        sentinelRef.current = false
        // 宽屏断点升级 (旋转/缩放) 时勿弹历史 —— 用户并未关面板。
        if (window.matchMedia("(max-width: 1023px)").matches) {
          window.history.back()
        }
      }
    }
  }, [isMobileOverlay])

  if (!everOpened) return null

  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      // <lg 是全屏覆盖层 → dialog 语义; lg+ 是静态停靠列 (普通 complementary), 不冒充对话框。
      role={!isLg ? "dialog" : undefined}
      aria-modal={!isLg && open ? true : undefined}
      aria-label="AI 助手"
      inert={!open}
      aria-hidden={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape") setRightPanel(false)
      }}
      className={cn(
        // 移动: 全屏覆盖 (淡入上滑); 桌面 lg+: 停靠列 (宽度过渡, 内容列定宽防折叠期挤压)
        "fixed inset-0 z-50 flex flex-col bg-muted/25 outline-none transition-[opacity,transform] duration-200",
        "lg:static lg:inset-auto lg:z-auto lg:shrink-0 lg:transform-none lg:overflow-hidden lg:transition-[width,opacity]",
        open
          ? "translate-y-0 opacity-100 lg:w-[25rem] lg:border-l"
          : "pointer-events-none translate-y-4 opacity-0 lg:w-0 lg:border-l-0",
      )}
    >
      <div
        className={cn(
          // safe-area: 刘海 (top) / Home 指示条 (bottom); viewportFit:cover 下 env() 才有值。
          "flex h-full w-full flex-col p-3",
          "pt-[max(env(safe-area-inset-top),0.75rem)] pb-[max(env(safe-area-inset-bottom),0.75rem)]",
          "lg:w-[25rem] lg:p-4",
        )}
      >
        <SurfacePanel>
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg border bg-background">
                <Bot className="h-4 w-4 text-muted-foreground" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold leading-tight">AI 助手</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {configured ? settings.model : "未配置模型"}
                </span>
              </span>
            </span>
            <div className="flex items-center gap-0.5">
              <IconButton
                onClick={() => panelRef.current?.newChat()}
                aria-label="新对话"
                title="新对话"
              >
                <Plus className="h-4 w-4" />
              </IconButton>
              <IconButton
                onClick={() => {
                  const ws = getActiveWorkspace()
                  if (ws) openAiTasks(ws.id, ws.name)
                  else openAiSettings()
                  // keep-alive 后关栏不再卸载: 流式中的回复在后台继续, 重开即见。
                  setRightPanel(false)
                }}
                aria-label="展开为工作区任务"
                title="展开为任务"
              >
                <Maximize2 className="h-4 w-4" />
              </IconButton>
              <IconButton onClick={() => openAiSettings()} aria-label="AI 设置" title="设置">
                <Settings className="h-4 w-4" />
              </IconButton>
              <IconButton
                onClick={() => setRightPanel(false)}
                aria-label="关闭 AI 对话栏"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <AgentPanel ref={panelRef} compact />
          </div>
        </SurfacePanel>
      </div>
    </aside>
  )
}
