"use client"

// 右侧 AI 智能体栏 (AI 原生): 宽屏 (lg+) 右停靠列; md–lg 右侧浮层; 移动 (<md) 全屏覆盖。
//
// keep-alive: 首次打开后保持挂载, 关闭 = 隐藏, 与 tab-host 同一哲学。
// 关闭时 (<lg) 完全 hidden, 避免 fixed + opacity-0 仍挡点击; 打开时 md+ 仅占右侧 25rem。
import * as React from "react"
import { Bot, Maximize2, Plus, Settings, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/lib/use-media-query"
import { isTauri } from "@/lib/tauri"
import {
  nodeAgentContextSource,
  urlAgentContextSource,
  type AgentContextSource,
} from "@/lib/agent-context-tray"
import { getBrowserUrl, subscribeBrowserState } from "@/lib/browser-state"
import AgentPanel, { type AgentPanelHandle } from "@/plugins/agent/views/agent-panel"
import { resolveWorkspaceRun } from "@/plugins/agent/lib/agent-resolve"
import { resolveSkills } from "@/plugins/agent/lib/agent-skills"
import {
  getServerWorkspacesState,
  getWorkspace,
  getWorkspacesState,
  isWorkspaceConfigured,
  resolveModel,
  subscribeWorkspaces,
} from "@/plugins/agent/lib/agent-workspace"
import {
  getAgentSettings,
  isConfigured,
  subscribeAgentSettings,
} from "@/plugins/agent/lib/agent-settings"
import {
  getAcpSettings,
  isExternalAcpConfigured,
  subscribeAcpSettings,
} from "@/plugins/agent/lib/acp/acp-settings"
import { SurfacePanel } from "@/ui/panel"
import { IconButton } from "@/ui/icon-button"
import { useRightPanelOpen, setRightPanel, openAiTasks, openAiSettings, useTabs } from "./store"
import { isBrowserResourceTab, nodeResourceRefForTab } from "./resource-tab"

export default function RightAiPanel() {
  const open = useRightPanelOpen()
  const isMdUp = useMediaQuery("(min-width: 768px)")
  const isLg = useMediaQuery("(min-width: 1024px)")
  const panelRef = React.useRef<AgentPanelHandle>(null)
  const asideRef = React.useRef<HTMLElement>(null)
  const settings = React.useSyncExternalStore(
    subscribeAgentSettings,
    getAgentSettings,
    getAgentSettings,
  )
  const acpSettings = React.useSyncExternalStore(
    subscribeAcpSettings,
    getAcpSettings,
    getAcpSettings,
  )
  const tabs = useTabs()
  const browserUrl = React.useSyncExternalStore(subscribeBrowserState, getBrowserUrl, () => null)
  const contextCandidates = React.useMemo(() => {
    const candidates = new Map<string, AgentContextSource>()
    for (const tab of tabs) {
      const node = nodeResourceRefForTab(tab)
      const source = node ? nodeAgentContextSource(node.kind, node.id, tab.title) : null
      if (source) candidates.set(source.key, source)
    }
    if (browserUrl && tabs.some(isBrowserResourceTab)) {
      const source = urlAgentContextSource(browserUrl, "浏览器当前页")
      if (source) candidates.set(source.key, source)
    }
    return [...candidates.values()]
  }, [browserUrl, tabs])
  const wsState = React.useSyncExternalStore(
    subscribeWorkspaces,
    getWorkspacesState,
    getServerWorkspacesState,
  )
  const configured = isConfigured(settings)
  const externalAcpSelected = acpSettings.executionBackend === "external-acp"
  const externalAcpRuntimeAvailable = isTauri()
  const panelWorkspace =
    wsState.workspaces.find((workspace) => workspace.id === wsState.activeId) ??
    wsState.workspaces[0] ??
    null
  const activeModel = panelWorkspace ? resolveModel(panelWorkspace) : null
  const panelConfigured = externalAcpSelected
    ? externalAcpRuntimeAvailable && isExternalAcpConfigured(acpSettings)
    : panelWorkspace
      ? isWorkspaceConfigured(panelWorkspace)
      : configured
  const panelModelLabel = externalAcpSelected
    ? `外部 · ${acpSettings.externalAgent.program.trim()}`
    : panelWorkspace
      ? panelWorkspace.model.useGlobal
        ? `${activeModel?.model ?? ""}（全局）`
        : (activeModel?.model ?? "")
      : settings.model
  const panelSkills = React.useMemo(
    () => (panelWorkspace ? resolveSkills(panelWorkspace.capabilities.skillIds) : undefined),
    [panelWorkspace],
  )

  const resolveRun = React.useCallback(
    async (useAgent: boolean, selectedContext: string) => {
      if (!panelWorkspace) return null
      const ws = getWorkspace(panelWorkspace.id)
      return ws ? resolveWorkspaceRun(ws, useAgent, selectedContext) : null
    },
    [panelWorkspace],
  )

  const openPanelSettings = React.useCallback(() => {
    if (externalAcpSelected) {
      openAiSettings()
      setRightPanel(false)
      return
    }
    if (panelWorkspace && !panelWorkspace.model.useGlobal) {
      openAiTasks(panelWorkspace.id, panelWorkspace.name)
      setRightPanel(false)
      return
    }
    openAiSettings()
    setRightPanel(false)
  }, [externalAcpSelected, panelWorkspace])

  const [everOpened, setEverOpened] = React.useState(false)
  React.useEffect(() => {
    if (open) setEverOpened(true)
  }, [open])

  React.useEffect(() => {
    if (open && !isLg) asideRef.current?.focus()
  }, [open, isLg])

  const isMobileOverlay = open && !isMdUp
  const sentinelRef = React.useRef(false)
  const sentinelCleanupRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (!isMobileOverlay) return
    if (sentinelCleanupRef.current !== null) {
      window.clearTimeout(sentinelCleanupRef.current)
      sentinelCleanupRef.current = null
    }
    if (window.history.state?.ideallAiPanel !== true) {
      window.history.pushState(
        { ...window.history.state, ideallAiPanel: true },
        "",
        window.location.href,
      )
    }
    sentinelRef.current = true
    const onPop = () => {
      sentinelRef.current = false
      setRightPanel(false)
    }
    window.addEventListener("popstate", onPop)
    return () => {
      window.removeEventListener("popstate", onPop)
      if (sentinelRef.current) {
        sentinelCleanupRef.current = window.setTimeout(() => {
          sentinelCleanupRef.current = null
          if (!sentinelRef.current) return
          sentinelRef.current = false
          if (window.matchMedia("(max-width: 767px)").matches) window.history.back()
        }, 0)
      }
    }
  }, [isMobileOverlay])

  if (!everOpened) return null

  // lg+: flex 列 (开/关均占位 w-0 / w-[25rem]); <lg: 仅打开时 fixed, 关闭时 hidden
  const showFixed = open && !isLg

  return (
    <aside
      ref={asideRef}
      tabIndex={showFixed ? -1 : undefined}
      role={showFixed ? "dialog" : undefined}
      aria-label="AI 智能体"
      aria-hidden={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape") setRightPanel(false)
      }}
      className={cn(
        "flex flex-col outline-none transition-[opacity,transform,width] duration-200",
        // lg+ 停靠列
        "lg:static lg:z-auto lg:shrink-0 lg:overflow-hidden lg:transform-none lg:transition-[width,opacity]",
        open
          ? "lg:w-[25rem] lg:border-l lg:opacity-100"
          : "lg:w-0 lg:border-l-0 lg:opacity-0 lg:pointer-events-none",
        // <lg 关闭: 不渲染命中区域
        !open && "max-lg:hidden",
        // <lg 打开: fixed; 移动全宽, md 仅右侧 25rem
        showFixed && [
          "fixed z-40 bg-muted/25",
          "inset-x-0 bottom-0 top-[calc(3.5rem+env(safe-area-inset-top))]",
          "md:inset-x-auto md:right-0 md:left-auto md:top-11 md:w-[25rem] md:max-w-full",
          "opacity-100",
        ],
      )}
    >
      <div
        className={cn(
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
                <span className="block truncate text-sm font-semibold leading-tight">
                  AI 智能体
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {panelConfigured
                    ? panelModelLabel
                    : externalAcpSelected
                      ? externalAcpRuntimeAvailable
                        ? "未配置外部 Agent"
                        : "外部 Agent 仅桌面可用"
                      : "未配置模型"}
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
                  if (panelWorkspace) openAiTasks(panelWorkspace.id, panelWorkspace.name)
                  else openAiSettings()
                  setRightPanel(false)
                }}
                aria-label={panelWorkspace ? "展开为工作区任务" : "打开 AI 设置"}
                title={panelWorkspace ? "展开为任务" : "打开设置"}
              >
                <Maximize2 className="h-4 w-4" />
              </IconButton>
              <IconButton onClick={openPanelSettings} aria-label="AI 设置" title="设置">
                <Settings className="h-4 w-4" />
              </IconButton>
              <IconButton
                onClick={() => setRightPanel(false)}
                aria-label="关闭 AI 智能体栏"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <AgentPanel
              ref={panelRef}
              compact
              resolveRun={panelWorkspace ? resolveRun : undefined}
              configured={panelConfigured}
              modelLabel={panelModelLabel}
              skills={panelSkills}
              onOpenSettings={openPanelSettings}
              defaultAgentMode={settings.defaultAgentMode}
              contextCandidates={contextCandidates}
            />
          </div>
        </SurfacePanel>
      </div>
    </aside>
  )
}
