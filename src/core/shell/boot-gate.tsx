"use client"

import { useState, type ReactNode } from "react"
import { registerAll } from "./boot"

/**
 * 客户端启动闸 —— 在任何中枢/插件 UI 渲染前, 把 app/plugin 能力注册进 protocol registry。
 * useState 初始化器在本组件渲染时同步执行一次 (父组件先于子树渲染),
 * 故订阅流 / 助手等使用 registry 时, 注册必已完成。registerAll 幂等。
 */
export default function BootGate({ children }: { children: ReactNode }) {
  useState(() => {
    registerAll()
    return null
  })
  return <>{children}</>
}
