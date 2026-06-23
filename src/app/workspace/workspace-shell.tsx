"use client"

// 工作区壳 (挂在根布局, 跨路由持久存在 → TabHost keep-alive)。
// 桌面 (md+): 活动栏 + 二级侧栏 + 标签条 + 主区 + 状态栏。
// 移动 (<md): 沿用现有顶栏(Header) + 底部标签栏(BottomTabBar), 主区显示当前激活标签。
// children = 各路由页的 OpenWorkspaceTab 标记 (无 UI), 隐藏渲染仅触发开标签副作用。
// /auth 跳出工作区, 纯页面渲染。

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { Header } from "@/app/shell/header"
import BottomTabBar from "@/app/shell/bottom-tab-bar"
import TopBar from "./top-bar"
import ActivityBar from "./activity-bar"
import RightAiPanel from "./right-ai-panel"
import SecondarySidebar from "./secondary-sidebar"
import TabBar from "./tab-bar"
import TabHost from "./tab-host"
import StatusBar from "./status-bar"
import {
  hydrateWorkspace,
  tabKey,
  useSidebarCollapsed,
  useActiveId,
  useTabs,
} from "./store"
import { descriptorForPath } from "./modules"

export default function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const sidebarCollapsed = useSidebarCollapsed()
  const activeId = useActiveId()
  const tabs = useTabs()

  // 客户端挂载后恢复上次的标签。
  React.useEffect(() => {
    hydrateWorkspace()
  }, [])

  // URL 同步: 仅在「真正切换标签」时把地址栏换成激活标签的规范路由 (深链 / 刷新可恢复)。
  // 关键: 不抢「属于激活标签的更深路径」—— 包括嵌入应用经 host.nav 改写的 /info/* 等内部路由,
  // 否则会与嵌入应用的导航互相打架; 也处理标签全关 → 落到 /home。
  React.useEffect(() => {
    if (pathname?.startsWith("/auth")) return
    // /home/agent = 「打开右侧 AI 栏」的虚拟命令路由 (无对应标签):
    // 开栏后把地址栏弹回当前激活标签 (或 /home), 不让 URL 停在 /home/agent。
    if (pathname?.startsWith("/home/agent")) {
      const at = tabs.find((x) => x.id === activeId)
      router.replace(at?.path ?? "/home")
      return
    }
    if (tabs.length === 0) {
      if (pathname !== "/home") router.replace("/home")
      return
    }
    const t = tabs.find((x) => x.id === activeId)
    if (!t?.path) return
    const cur = descriptorForPath(pathname || "/")
    // 当前 URL 已归属激活标签 (含其子路径) → 保留 URL, 不打架。
    if (cur && tabKey(cur) === t.id) return
    if (t.path !== pathname) router.replace(t.path)
  }, [activeId, tabs, pathname, router])

  // 认证页: 跳出工作区壳。
  if (pathname?.startsWith("/auth")) {
    return <div className="min-h-dvh bg-background">{children}</div>
  }

  return (
    <>
      {/* 路由标记 (无 UI)。隐藏容器兜底任何未转成标记的页面内容。 */}
      <div className="hidden">{children}</div>

      <div className="flex h-dvh flex-col">
        {/* 移动顶栏 (md:hidden 由组件内部控制) */}
        <Header />
        {/* 桌面顶边栏 (hidden md:flex): 模式切换 + 设置 + 账户 */}
        <TopBar />

        <div className="flex min-h-0 flex-1">
          <ActivityBar />
          <SecondarySidebar collapsed={sidebarCollapsed} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TabBar />
            {/* 移动端底栏含安全区(刘海/Home 指示条), 预留 4rem + safe-area 防遮挡 */}
            <div className="min-h-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
              <TabHost />
            </div>
          </div>
          {/* 右侧 AI 对话栏 (桌面停靠 / 移动全屏覆盖; 关闭态不渲染) */}
          <RightAiPanel />
        </div>

        <StatusBar />

        {/* 移动底栏 (md:hidden 由组件内部控制; fixed) */}
        <BottomTabBar />
      </div>
    </>
  )
}
