"use client"

import { useEffect, useState, type ReactNode } from "react"
import { registerAll, bootClientEffects } from "./boot"
import { describeBootFailure, type BootFailureDiagnostic } from "./boot-contract"
import { installTauriExternalLinks } from "@/lib/safe-url"
import { prepareCurrentDataEpoch } from "@/lib/data-epoch"

/**
 * 客户端启动前置步骤 —— 先建立数据 epoch，再把 app/plugin 能力注册进 protocol registry，
 * 完成前不渲染终端或插件 UI。registerAll 幂等。
 *
 * 另在 App (Tauri) 形态装一个全局外链点击委托 (浏览器 / SSR 为 no-op), 把 `<a target="_blank">`
 * 外链改交「浏览器」模块打开。挂在根 layout, 故全站锚点一处覆盖。
 */
export default function BootGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    | { status: "preparing" }
    | { status: "ready" }
    | { status: "failed"; failure: BootFailureDiagnostic }
  >({ status: "preparing" })

  useEffect(() => {
    let disposed = false
    let disposeExternalLinks: (() => void) | undefined
    void prepareCurrentDataEpoch()
      .then(() => {
        if (disposed) return
        registerAll()
        bootClientEffects()
        disposeExternalLinks = installTauriExternalLinks()
        setState({ status: "ready" })
      })
      .catch((error) => {
        if (!disposed) setState({ status: "failed", failure: describeBootFailure(error) })
      })
    return () => {
      disposed = true
      disposeExternalLinks?.()
    }
  }, [])

  if (state.status === "preparing") {
    return <main className="min-h-screen animate-pulse bg-muted/25" aria-label="正在准备本地数据" />
  }
  if (state.status === "failed") {
    const { failure } = state
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
