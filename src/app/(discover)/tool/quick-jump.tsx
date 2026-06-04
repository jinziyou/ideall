"use client"

import { useRef, useState, useSyncExternalStore } from "react"
import { Clock, ExternalLink, LayoutGrid, Search, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PinToolButton } from "@/app/home/pin-tool-button"

const HISTORY_LIMIT = 10
const EMPTY_HISTORY: string[] = []

// localStorage 历史的轻量存储: 用 useSyncExternalStore 订阅, 既避免 SSR 水合不一致,
// 又能在同标签页内写入后即时刷新 (storage 事件只跨标签页触发, 故自维护通知)。
const listeners = new Set<() => void>()
const cache = new Map<string, { raw: string | null; value: string[] }>()

function readHistory(key: string): string[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    // localStorage 不可用
  }
  // 缓存解析结果, 保证 getSnapshot 返回稳定引用 (否则 useSyncExternalStore 会死循环)
  const cached = cache.get(key)
  if (cached && cached.raw === raw) return cached.value
  let value: string[] = EMPTY_HISTORY
  try {
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) value = parsed
    }
  } catch {
    // 数据损坏时视为空
  }
  cache.set(key, { raw, value })
  return value
}

function writeHistory(key: string, value: string[]) {
  const raw = JSON.stringify(value)
  try {
    localStorage.setItem(key, raw)
  } catch {
    // 写入失败 (隐私模式 / 配额) 时仅更新内存缓存
  }
  cache.set(key, { raw, value })
  listeners.forEach((l) => l())
}

function subscribeHistory(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export type Provider = {
  /** 展示名称 */
  name: string
  /** 站点首页 (无关键词或不支持关键词跳转时打开) */
  home: string
  /**
   * 带词跳转的 URL 模板, 用 `{q}` 占位关键词 (已编码), 例: `https://www.google.com/search?q={q}`。
   * 不提供则回退到复制关键词 + 打开首页。
   * 用字符串而非函数, 以便从 Server Component 序列化传入 Client Component。
   */
  queryUrl?: string
  /** 图标圆形背景色 (Tailwind class) */
  accent?: string
  /** 一句话说明 */
  hint?: string
}

type QuickJumpProps = {
  title: string
  description: string
  placeholder: string
  providers: Provider[]
  /** 提供则启用「最近搜索」历史, 用作 localStorage 存储键 (数据仅留在本机浏览器) */
  historyKey?: string
}

export default function QuickJump({
  title,
  description,
  placeholder,
  providers,
  historyKey,
}: QuickJumpProps) {
  const [keyword, setKeyword] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const history = useSyncExternalStore(
    subscribeHistory,
    () => (historyKey ? readHistory(historyKey) : EMPTY_HISTORY),
    () => EMPTY_HISTORY, // 服务端快照恒为空, 避免水合不一致
  )

  function recordHistory(value: string) {
    if (!historyKey) return
    const prev = readHistory(historyKey)
    const next = [value, ...prev.filter((k) => k !== value)].slice(0, HISTORY_LIMIT)
    writeHistory(historyKey, next)
  }

  function removeHistory(value: string) {
    if (!historyKey) return
    writeHistory(
      historyKey,
      readHistory(historyKey).filter((k) => k !== value),
    )
  }

  function clearHistory() {
    if (!historyKey) return
    writeHistory(historyKey, [])
  }

  function jump(provider: Provider) {
    const trimmed = keyword.trim()
    if (trimmed) recordHistory(trimmed)
    // 支持关键词的引擎: 直接带词跳转
    if (trimmed && provider.queryUrl) {
      const url = provider.queryUrl.replace("{q}", encodeURIComponent(trimmed))
      window.open(url, "_blank", "noopener,noreferrer")
      return
    }
    // 不支持关键词跳转: 复制到剪贴板后打开首页, 方便用户粘贴
    if (trimmed && !provider.queryUrl) {
      navigator.clipboard
        ?.writeText(trimmed)
        .then(() => toast.success(`已复制关键词, 在 ${provider.name} 中粘贴即可`))
        .catch(() => toast.info(`${provider.name} 暂不支持直接带词跳转, 请手动输入`))
    }
    window.open(provider.home, "_blank", "noopener,noreferrer")
  }

  function openAll() {
    const trimmed = keyword.trim()
    if (!trimmed) {
      toast.info("请先输入关键词")
      return
    }
    recordHistory(trimmed)
    // 仅批量打开支持带词跳转的站点 (复制粘贴类无法批量处理, 见 jump)
    const targets = providers.filter((p) => p.queryUrl)
    const manual = providers.length - targets.length
    const tail = manual > 0 ? `, 另 ${manual} 个需手动粘贴` : ""
    let blocked = 0
    for (const provider of targets) {
      const url = provider.queryUrl!.replace("{q}", encodeURIComponent(trimmed))
      const win = window.open(url, "_blank", "noopener,noreferrer")
      if (!win) blocked++
    }
    if (blocked > 0) {
      toast.warning(
        `已打开 ${targets.length - blocked} 个, ${blocked} 个被浏览器拦截, 请允许弹出窗口`,
      )
    } else {
      toast.success(`已打开 ${targets.length} 个站点${tail}`)
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (providers.length > 0) jump(providers[0])
  }

  function applyHistoryItem(value: string) {
    setKeyword(value)
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <form onSubmit={onSubmit} className="flex w-full max-w-2xl items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={placeholder}
            className="pl-9"
            autoFocus
          />
        </div>
        <Button type="submit" className="gap-1.5">
          <ExternalLink className="h-4 w-4" />
          跳转
        </Button>
        <Button type="button" variant="outline" className="gap-1.5" onClick={openAll}>
          <LayoutGrid className="h-4 w-4" />
          全部打开
        </Button>
      </form>

      {historyKey && history.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              最近搜索
            </span>
            <button
              type="button"
              onClick={clearHistory}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              清空
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {history.map((item) => (
              <span
                key={item}
                className="group inline-flex items-center gap-1 rounded-full border bg-card py-1 pl-3 pr-1.5 text-sm text-card-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => applyHistoryItem(item)}
                  className="max-w-[12rem] truncate"
                  title={item}
                >
                  {item}
                </button>
                <button
                  type="button"
                  onClick={() => removeHistory(item)}
                  className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={`删除 ${item}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {providers.map((provider) => (
          <div key={provider.name} className="relative">
            <button
              type="button"
              onClick={() => jump(provider)}
              className="group flex w-full items-start gap-3 rounded-lg border bg-card p-3 pr-8 text-left text-card-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-accent"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white ${
                  provider.accent ?? "bg-primary"
                }`}
              >
                {provider.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-medium">
                  {provider.name}
                  <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                </span>
                {provider.hint ? (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {provider.hint}
                  </span>
                ) : null}
              </span>
            </button>
            <PinToolButton
              name={provider.name}
              url={provider.home}
              className="absolute right-1.5 top-1.5"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
