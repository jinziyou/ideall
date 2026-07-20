"use client"

import { useEffect, useState, type ReactNode } from "react"
import { registerAll, bootClientEffects } from "./boot"
import { describeBootFailure, type BootFailureDiagnostic } from "./boot-contract"
import { installTauriExternalLinks } from "@/lib/safe-url"

/**
 * 客户端启动前置步骤 —— 在任何终端/插件 UI 渲染前, 把 app/plugin 能力注册进 protocol registry。
 * useState 初始化器在本组件渲染时同步执行一次 (父组件先于子树渲染),
 * 故关注流 / 智能体等使用 registry 时, 注册必已完成。registerAll 幂等。
 *
 * 另在 App (Tauri) 形态装一个全局外链点击委托 (浏览器 / SSR 为 no-op), 把 `<a target="_blank">`
 * 外链改交「浏览器」模块打开。挂在根 layout, 故全站锚点一处覆盖。
 */
export default function BootGate({ children }: { children: ReactNode }) {
  const [failure] = useState<BootFailureDiagnostic | null>(() => {
    try {
      registerAll()
      return null
    } catch (error) {
      return describeBootFailure(error)
    }
  })
  useEffect(() => {
    if (failure) return
    bootClientEffects()
    return installTauriExternalLinks()
  }, [failure])
  if (failure) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <section role="alert" className="w-full max-w-lg rounded-lg border bg-card p-6">
          <h1 className="text-lg font-semibold">{failure.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            终端外壳没有进入工作区，以免在文件系统或导航映射不完整时继续运行。
          </p>
          <dl className="mt-4 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">错误码</dt>
            <dd className="font-mono">{failure.code}</dd>
            <dt className="text-muted-foreground">详情</dt>
            <dd className="break-words">{failure.detail}</dd>
          </dl>
          <button
            type="button"
            className="mt-5 rounded-md border px-3 py-2 text-sm hover:bg-accent"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </section>
      </main>
    )
  }
  return <>{children}</>
}
