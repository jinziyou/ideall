"use client"

// 工作区壳 (挂在根布局, 跨路由持久存在 → TabHost keep-alive)。
// 桌面 (md+): 活动栏 + 二级侧栏 + 标签条 + 主区 + 状态栏。
// 移动 (<md): 沿用现有顶栏(Header) + 底部标签栏(BottomTabBar), 主区显示当前激活标签。
// children = 各路由页的 OpenWorkspaceTab 标记 (无 UI), 隐藏渲染仅触发开标签副作用。
// /auth 跳出工作区, 纯页面渲染。

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { isTauri, browserHide } from "@/lib/tauri"
import { Header } from "@/shell/header"
import BottomTabBar from "@/shell/bottom-tab-bar"
import TopBar from "./top-bar"
import ActivityBar from "./activity-bar"
import RightAiPanel from "./right-ai-panel"
import SecondarySidebar from "./secondary-sidebar"
import MobileDrillBar from "./mobile-drill-bar"
import TabBar from "./tab-bar"
import TabHost from "./tab-host"
import GlobalShortcuts from "./global-shortcuts"
import {
  getActiveId,
  getTabs,
  hydrateWorkspace,
  tabKey,
  useActiveId,
  useHydrated,
  useRightPanelOpen,
  useSidebarCollapsed,
  useTabs,
} from "./store"
import { useMediaQuery } from "@/lib/use-media-query"
import { useWindowViewport } from "@/lib/use-window-viewport"
import { descriptorForNode, descriptorForPath } from "./modules"

// URL 同步抽成独立子组件: 它用 useSearchParams (output:export 下必须包 <Suspense>)。
// 仅在「真正切换标签」时把地址栏换成激活标签的规范路由 (深链 / 刷新可恢复)。
//
// 两道关键设计:
//  1. 沿用 dc7ce06「页面自动狂切」消环机制: 读 store 实时快照 (getTabs()/getActiveId()),
//     而非组件渲染闭包里的旧值 —— 路由标记 OpenWorkspaceTab 的 openTab effect 已把 activeId
//     对齐当前 URL, 这里读实时值即可立即收敛, 不与 marker 互相用对方旧值覆盖。
//  2. 节点标签共享 /home/notes 壳、仅 query 区分; usePathname 不含 query, 故按 pathname+search
//     比对并「优先 descriptorForNode(search)」解析。收敛靠 tabKey(cur)===t.id 命中 (而非 URL 串
//     比对, 避开 ":" vs "%3A" 编码不一致导致永不相等 → 每次都 replace 的狂切)。
function UrlSync() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const hydrated = useHydrated()
  const activeId = useActiveId()
  const tabs = useTabs()
  const search = searchParams.toString()
  const isMdUp = useMediaQuery("(min-width: 768px)")
  // 首次同步 (恢复会话 / 深链归一) 用 replace, 不该堆历史; 之后移动端的标签导航才 push。
  const syncedOnceRef = React.useRef(false)

  React.useEffect(() => {
    if (pathname?.startsWith("/auth")) return
    // 未水合前不抢路由: 此刻 store 仍空, 避免对地址栏做任何同步。
    if (!hydrated) return
    const liveTabs = getTabs()
    const liveActiveId = getActiveId()
    // /home/agent = 「打开右侧 AI 栏」虚拟命令路由 (无对应标签): 开栏后弹回激活标签 (或 /home)。
    if (pathname?.startsWith("/home/agent")) {
      const at = liveTabs.find((x) => x.id === liveActiveId)
      router.replace(at?.path ?? "/home")
      return
    }
    if (liveTabs.length === 0) {
      // 深链 / 刷新挂载期: hydrate 可能先于路由标记 openTab (tabs 仍空)。
      // 若当前路径 / ?node= 能解析成标签 → 不抢, 保住深链; 仅真正孤儿路由或已是 /home 才落 /home。
      const p = pathname || "/"
      if (p !== "/home" && !descriptorForPath(p) && !descriptorForNode(search)) {
        router.replace("/home")
      }
      return
    }
    const t = liveTabs.find((x) => x.id === liveActiveId)
    if (!t?.path) return
    // 先认 node (含 query), 再认普通路径; URL 已归属激活标签 (含嵌入应用经 host.nav 改写的子路径) → 保留。
    const cur = descriptorForNode(search) ?? descriptorForPath(pathname || "/")
    if (cur && tabKey(cur) === t.id) {
      syncedOnceRef.current = true
      return
    }
    const curUrl = (pathname || "") + (search ? `?${search}` : "")
    if (t.path !== curUrl) {
      // 移动端 (<md) 没有可见标签条, 系统返回 (Android 返回键 / iOS 边缘滑动) 是最高频导航原语:
      // 用 push 让「下钻/切标签」进 history, 回退落到上一个路由后由 OpenWorkspaceTab 标记
      // 重开对应标签 (预览方式) —— 返回手势从此可撤销下钻, 不再直接退出 App。
      // 桌面标签条自带完整导航, 保持 replace (地址栏只是激活标签的镜像, 不堆历史)。
      if (!isMdUp && syncedOnceRef.current) router.push(t.path)
      else router.replace(t.path)
    }
    syncedOnceRef.current = true
  }, [hydrated, activeId, tabs, pathname, search, router, isMdUp])

  return null
}

export default function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  useWindowViewport()
  const sidebarCollapsed = useSidebarCollapsed()
  const rightPanelOpen = useRightPanelOpen()
  const isMdUp = useMediaQuery("(min-width: 768px)")
  const isLg = useMediaQuery("(min-width: 1024px)")
  // 仅移动全屏 AI 覆盖 (<md) 时对主内容 inert; md+ 活动栏/侧栏/标签条始终可点。
  const aiMainInert = rightPanelOpen && !isMdUp
  // md–lg AI 右侧浮层: 给主列留位, 避免标签条右侧被盖住点不到。
  const aiDockMargin = rightPanelOpen && isMdUp && !isLg

  // 客户端挂载后恢复上次的标签。
  React.useEffect(() => {
    hydrateWorkspace()
  }, [])

  // 启动 / 刷新后若不在「浏览器」标签, 强制收起 Linux 原生 overlay (否则会挡全窗点击)。
  React.useEffect(() => {
    if (!isTauri()) return
    const t = getTabs().find((x) => x.id === getActiveId())
    if (t?.kind !== "browser-view") void browserHide().catch(() => {})
  }, [])

  // 认证页: 跳出工作区壳。
  if (pathname?.startsWith("/auth")) {
    return <div className="min-h-dvh bg-background">{children}</div>
  }

  return (
    <>
      {/* 路由标记 (无 UI)。隐藏容器兜底任何未转成标记的页面内容。 marker 在前: 其 openTab effect 先于 UrlSync 跑。 */}
      <div className="hidden">{children}</div>
      <React.Suspense fallback={null}>
        <UrlSync />
      </React.Suspense>
      <GlobalShortcuts />

      <div className="flex h-[var(--app-h,100dvh)] min-h-0 flex-col">
        {/* 移动顶栏 (md:hidden 由组件内部控制; Tauri 窄窗兼作标题栏) */}
        <Header />
        {/* 桌面顶边栏 (hidden md:flex; Tauri 下兼作标题栏, 窗控已并入) */}
        <TopBar />

        <div className="flex min-h-0 flex-1">
          <div className="relative z-10 flex min-w-0 flex-1">
            <ActivityBar />
            <SecondarySidebar collapsed={sidebarCollapsed} />
            <div
              className={
                aiDockMargin
                  ? "flex min-w-0 flex-1 flex-col md:max-lg:mr-[25rem]"
                  : "flex min-w-0 flex-1 flex-col"
              }
            >
              <TabBar />
              <MobileDrillBar />
              <div
                inert={aiMainInert}
                className="min-h-0 flex-1 pb-[calc(4rem+max(env(safe-area-inset-bottom),0.35rem))] md:pb-0"
              >
                <TabHost />
              </div>
            </div>
          </div>
          <RightAiPanel />
        </div>

        {/* 移动底栏 (md:hidden 由组件内部控制; fixed) */}
        <BottomTabBar />
      </div>
    </>
  )
}
