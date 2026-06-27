"use client"

import { useEffect, useState, type ReactNode } from "react"
import { registerAll, bootClientEffects } from "./boot"
import { installTauriExternalLinks } from "@/lib/safe-url"

/**
 * 客户端启动闸 —— 在任何终端/插件 UI 渲染前, 把 app/plugin 能力注册进 protocol registry。
 * useState 初始化器在本组件渲染时同步执行一次 (父组件先于子树渲染),
 * 故关注流 / 助手等使用 registry 时, 注册必已完成。registerAll 幂等。
 *
 * 另在 App (Tauri) 形态装一个全局外链点击委托 (浏览器 / SSR 为 no-op), 把 `<a target="_blank">`
 * 外链改经系统浏览器打开。挂在根 layout, 故全站锚点一处覆盖。
 */
export default function BootGate({ children }: { children: ReactNode }) {
  useState(() => {
    registerAll()
    return null
  })
  useEffect(() => {
    bootClientEffects()
    return installTauriExternalLinks()
  }, [])
  return <>{children}</>
}
