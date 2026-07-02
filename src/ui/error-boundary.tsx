"use client"

// 通用 React 错误边界 (类组件是唯一实现方式)。主要消费方: 标签内容 (registry.TabContent) ——
// 多标签工作台里单个标签渲染崩溃 (或懒加载 chunk 在版本更新/离线后 404) 的爆炸半径必须是
// 「该标签面板内的一张错误卡」, 而不是击穿 layout 落到 global-error 把整个外壳替换掉。
import * as React from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/ui/button"

/** 懒加载 chunk 获取失败 (部署更新后旧 chunk 404 / 离线): 重试无用, 需要整页刷新拿新版本。 */
function isChunkLoadError(error: Error): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /loading chunk|dynamically imported module|failed to fetch/i.test(error.message)
  )
}

type Props = {
  children: React.ReactNode
  /** 错误卡标题里的语境名 (如「此标签」), 默认「此内容」。 */
  label?: string
}
type State = { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[error-boundary]", error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunkStale = isChunkLoadError(error)
    return (
      <div className="flex h-full items-start justify-center overflow-y-auto p-4 sm:p-8">
        <div className="w-full max-w-lg rounded-lg border bg-card p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 space-y-1">
              <h2 className="text-base font-semibold leading-tight">
                {this.props.label ?? "此内容"}加载出错
              </h2>
              <p className="text-sm text-muted-foreground">
                {chunkStale
                  ? "应用可能已更新或当前离线，刷新后可加载新版本。其他标签不受影响。"
                  : "渲染发生错误。其他标签不受影响，可重试或关闭此标签。"}
              </p>
            </div>
          </div>
          <div className="mt-3 rounded-md border bg-muted/40 p-3 text-xs break-all text-muted-foreground">
            {error.message || "未知错误"}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {chunkStale && (
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                刷新应用
              </Button>
            )}
            <Button size="sm" onClick={this.reset}>
              重试
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
