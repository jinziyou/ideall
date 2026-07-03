"use client"

// 键盘快捷键基础库 (纯工具, 不含具体绑定): 组合键解析 / 事件匹配 / 按平台格式化展示。
// 具体绑定表在 workspace/global-shortcuts.tsx (单点 window keydown); 此前全应用唯一的
// 全局快捷键是 ⌘K (command-palette 自持监听, 保留其开/关切换语义, 不经本注册表)。
//
// combo 语法: "mod+w" / "ctrl+tab" / "mod+shift+t" / "mod+1".
//   mod = mac 的 ⌘ (metaKey), 其余平台的 Ctrl —— 展示随平台 (修复硬编码 ⌘K 对 Win/Linux 的误导)。

import * as React from "react"

export type ShortcutDef = {
  id: string
  combo: string
  label: string
  /** 焦点在输入框 / contenteditable (编辑器) 内是否仍生效。默认 false, 防抢编辑键 (如 mod+b 加粗)。 */
  inEditable?: boolean
  run: () => void
}

/** mac 系平台 (⌘ 修饰键)。SSR / 预渲染期返回 false。 */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false
  type NavWithUAData = Navigator & { userAgentData?: { platform?: string } }
  const p = (navigator as NavWithUAData).userAgentData?.platform ?? navigator.platform ?? ""
  return /mac|iphone|ipad|ipod/i.test(p)
}

type ParsedCombo = { mod: boolean; ctrl: boolean; shift: boolean; alt: boolean; key: string }

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split("+")
  const key = parts[parts.length - 1]
  return {
    mod: parts.includes("mod"),
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    key,
  }
}

/** keydown 事件是否命中组合键 (mod 按平台落到 meta/ctrl; 另一修饰键必须为假, 防串键)。 */
export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const c = parseCombo(combo)
  const mac = isMacPlatform()
  const wantMeta = c.mod && mac
  const wantCtrl = c.ctrl || (c.mod && !mac)
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl) return false
  if (e.shiftKey !== c.shift || e.altKey !== c.alt) return false
  const k = e.key.toLowerCase()
  if (c.key === "tab") return k === "tab"
  if (c.key === "pageup") return k === "pageup"
  if (c.key === "pagedown") return k === "pagedown"
  return k === c.key
}

const KEY_LABEL: Record<string, string> = {
  tab: "Tab",
  pageup: "PgUp",
  pagedown: "PgDn",
  escape: "Esc",
}

/** 按当前平台格式化组合键展示串: mac "⌘⇧T" / 其他 "Ctrl+Shift+T"。 */
export function formatShortcut(combo: string, mac: boolean = isMacPlatform()): string {
  const c = parseCombo(combo)
  const key = KEY_LABEL[c.key] ?? c.key.toUpperCase()
  if (mac) {
    return [c.ctrl ? "⌃" : "", c.alt ? "⌥" : "", c.shift ? "⇧" : "", c.mod ? "⌘" : "", key].join("")
  }
  return [c.ctrl || c.mod ? "Ctrl" : "", c.alt ? "Alt" : "", c.shift ? "Shift" : "", key]
    .filter(Boolean)
    .join("+")
}

const noopSubscribe = () => () => {}

/** 组合键展示串 hook (SSR 安全): 服务端快照给非 mac 形态, 水合后按真实平台重渲染, 无 mismatch 警告。 */
export function useShortcutLabel(combo: string): string {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => formatShortcut(combo),
    () => formatShortcut(combo, false),
  )
}

/** 焦点是否在可编辑目标 (输入框 / 文本域 / contenteditable 编辑器) 内。 */
export function inEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el || typeof el.tagName !== "string") return false
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  return el.isContentEditable === true
}
