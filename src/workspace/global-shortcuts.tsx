"use client"

// 工作区全局快捷键 (单点 window keydown, 挂 WorkspaceShell → /auth 之外全局生效):
// 标签操作 (关闭 / 循环切换 / 按序跳转) + 侧栏开合。「一切皆标签页」的外壳借用了 IDE/浏览器
// 的视觉语言, 此表兑现其键盘预期 —— 此前除 ⌘K 外全应用没有任何全局快捷键, 关标签只能鼠标悬停点 X。
// ⌘K 仍由 command-palette 自持 (保留其开/关切换语义); 本表条目同时供 ⌘K 命令面板展示键位提示。
//
// 已知边界: Web 浏览器里 Ctrl+W / Ctrl+Tab 是浏览器保留键, preventDefault 无效 —— 它们主要
// 服务 Tauri 桌面 App (主要分发形态); Web 端可用 Ctrl+PgUp/PgDn 与 mod+1..9 替代。
// 焦点陷在嵌入 iframe 内时 window 收不到按键 (跨 iframe 不冒泡), 需 Tauri accelerator 才能穿透, 暂不覆盖。

import * as React from "react"
import { inEditableTarget, matchesCombo, type ShortcutDef } from "@/lib/shortcuts"
import { activateAdjacentTab, activateTabAt, requestCloseActiveTab, toggleSidebar } from "./store"

/** 标签/布局快捷键绑定表 (⌘K 命令面板据此展示键位)。 */
export const WORKSPACE_SHORTCUTS: ShortcutDef[] = [
  {
    id: "tab.close",
    combo: "mod+w",
    label: "关闭当前标签",
    inEditable: true,
    run: requestCloseActiveTab,
  },
  {
    id: "tab.next",
    combo: "ctrl+tab",
    label: "下一个标签",
    inEditable: true,
    run: () => activateAdjacentTab(1),
  },
  {
    id: "tab.prev",
    combo: "ctrl+shift+tab",
    label: "上一个标签",
    inEditable: true,
    run: () => activateAdjacentTab(-1),
  },
  {
    id: "tab.next.alt",
    combo: "ctrl+pagedown",
    label: "下一个标签",
    inEditable: true,
    run: () => activateAdjacentTab(1),
  },
  {
    id: "tab.prev.alt",
    combo: "ctrl+pageup",
    label: "上一个标签",
    inEditable: true,
    run: () => activateAdjacentTab(-1),
  },
  // mod+1..9 按序跳转 (9 = 最后一个, 浏览器惯例)。
  ...Array.from({ length: 9 }, (_, i): ShortcutDef => {
    const n = i + 1
    return {
      id: `tab.goto.${n}`,
      combo: `mod+${n}`,
      label: n === 9 ? "最后一个标签" : `第 ${n} 个标签`,
      inEditable: true,
      run: () => activateTabAt(n),
    }
  }),
  {
    id: "layout.sidebar",
    combo: "mod+b",
    label: "显示 / 隐藏侧栏",
    // 编辑器内 mod+b = 加粗, 不抢。
    run: toggleSidebar,
  },
]

export default function GlobalShortcuts() {
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      for (const s of WORKSPACE_SHORTCUTS) {
        if (!matchesCombo(e, s.combo)) continue
        if (!s.inEditable && inEditableTarget(e)) return
        e.preventDefault()
        s.run()
        return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
  return null
}
