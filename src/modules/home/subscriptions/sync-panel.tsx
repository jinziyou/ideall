"use client"

import * as React from "react"
import { Cloud, Copy, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { ServiceHeader } from "@/shared/service-header"
import { generateSyncCode, isValidSyncCode } from "@/lib/sync-crypto"
import { clearSyncCode, getSyncCode, setSyncCode, subscribeSyncCode } from "@/lib/sync-code"
import { getSyncPort } from "@protocol/sync"
import { SUBSCRIPTIONS_SYNCED } from "@protocol/flowback"
import { useFlowProgress } from "@/lib/use-flow-progress"
import { getSession, subscribeSession } from "@/lib/auth/auth-store"

/**
 * 跨端同步面板 —— 用同步码在多设备间同步关注、笔记与书签 (端到端加密)。
 * 同步码存本地 (useSyncExternalStore 读取); 已开启则进面板时自动同步一次。
 * 同步完成广播 `ideall:subscriptions-synced`, 关注流监听后刷新。
 */
export default function SyncPanel() {
  const code = React.useSyncExternalStore(subscribeSyncCode, getSyncCode, () => null)
  const session = React.useSyncExternalStore(subscribeSession, getSession, () => null)
  const sessionToken = session?.token ?? null
  const [busy, setBusy] = React.useState(false)
  const [input, setInput] = React.useState("")
  const [reveal, setReveal] = React.useState(false)
  const progress = useFlowProgress()

  const runSync = React.useCallback(async (c: string, silent = false) => {
    setBusy(true)
    try {
      if (!getSession()) throw new Error("跨端同步已升级为账号绑定，请先登录")
      const port = getSyncPort()
      if (!port) throw new Error("同步功能不可用")
      const r = await port.syncNow(c)
      window.dispatchEvent(new Event(SUBSCRIPTIONS_SYNCED))
      if (!silent) toast.success(r.added > 0 ? `同步完成 · 新增 ${r.added} 项` : "同步完成")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "同步失败")
    } finally {
      setBusy(false)
    }
  }, [])

  React.useEffect(() => {
    if (!sessionToken) return
    const c = getSyncCode()
    if (!c) return
    // 延后到下一 tick 再同步 —— 避免在 effect 同步阶段触发 setState
    const t = setTimeout(() => runSync(c, true), 0)
    return () => clearTimeout(t)
  }, [runSync, sessionToken])

  async function enable() {
    const c = generateSyncCode()
    await setSyncCode(c)
    setReveal(true)
    await runSync(c)
  }

  async function joinWithCode() {
    const c = input.trim()
    if (!isValidSyncCode(c)) {
      toast.error("同步码格式不正确")
      return
    }
    await setSyncCode(c)
    setInput("")
    await runSync(c)
  }

  async function disable() {
    try {
      await clearSyncCode()
      setReveal(false)
      toast.success("已关闭同步，云端加密备份仍保留")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "关闭同步失败")
    }
  }

  function copyCode() {
    if (!code) return
    navigator.clipboard?.writeText(code).then(
      () => toast.success("同步码已复制"),
      () => toast.error("复制失败"),
    )
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <ServiceHeader
        icon={Cloud}
        title="跨端同步"
        status={
          !session
            ? { label: "需登录", tone: "warn" }
            : code
              ? { label: "已开启 · 端到端加密", tone: "ok" }
              : { label: "未开启", tone: "off" }
        }
      />
      {!session ? (
        <p className="mt-2 text-xs text-muted-foreground">
          V2 同步密文与当前账号绑定；登录后才会拉取或上传。
        </p>
      ) : null}
      {busy && progress?.kind === "sync" ? (
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          {progress.label}
          {progress.detail ? `（${progress.detail}）` : null}
        </p>
      ) : null}
      {code ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => runSync(code)} disabled={busy || !session}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              立即同步
            </Button>
            <Button size="sm" variant="outline" onClick={() => setReveal((v) => !v)}>
              {reveal ? "隐藏同步码" : "查看同步码"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void disable()}>
              关闭同步
            </Button>
          </div>
          {reveal && (
            <>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">
                  {code}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={copyCode}
                  title="复制同步码"
                >
                  <Copy className="h-4 w-4" />
                  <span className="sr-only">复制同步码</span>
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button size="sm" onClick={enable} disabled={busy || !session}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            开启同步
          </Button>
          <span className="text-xs text-muted-foreground">或</span>
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="粘贴已有同步码"
              aria-label="粘贴已有同步码"
              className="h-9 w-full sm:w-64"
            />
            <Button size="sm" variant="outline" onClick={joinWithCode} disabled={busy || !session}>
              加入
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
