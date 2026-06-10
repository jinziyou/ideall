"use client"

import * as React from "react"
import { Cloud, Copy, Loader2, Lock, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ServiceHeader } from "@/components/system/service-header"
import { generateSyncCode, isValidSyncCode } from "@/components/lib/sync-crypto"
import { clearSyncCode, getSyncCode, setSyncCode, subscribeSyncCode } from "@/components/lib/sync-code"
import { getSyncPort } from "@protocol/sync"
import { SUBSCRIPTIONS_SYNCED } from "@protocol/flowback"

/**
 * 跨端同步面板 —— 用同步码在多设备间同步订阅 (端到端加密)。
 * 同步码存本地 (useSyncExternalStore 读取); 已开启则进面板时自动同步一次。
 * 同步完成广播 `wonita:subscriptions-synced`, 订阅流监听后刷新。
 */
export default function SyncPanel() {
  const code = React.useSyncExternalStore(subscribeSyncCode, getSyncCode, () => null)
  const [busy, setBusy] = React.useState(false)
  const [input, setInput] = React.useState("")
  const [reveal, setReveal] = React.useState(false)

  const runSync = React.useCallback(async (c: string, silent = false) => {
    setBusy(true)
    try {
      const port = getSyncPort()
      if (!port) throw new Error("同步功能不可用")
      const r = await port.syncNow(c)
      window.dispatchEvent(new Event(SUBSCRIPTIONS_SYNCED))
      if (!silent)
        toast.success(r.added > 0 ? `同步完成 · 新增 ${r.added} 项` : "同步完成")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "同步失败")
    } finally {
      setBusy(false)
    }
  }, [])

  React.useEffect(() => {
    const c = getSyncCode()
    if (!c) return
    // 延后到下一 tick 再同步 —— 避免在 effect 同步阶段触发 setState
    const t = setTimeout(() => runSync(c, true), 0)
    return () => clearTimeout(t)
  }, [runSync])

  async function enable() {
    const c = generateSyncCode()
    setSyncCode(c)
    setReveal(true)
    await runSync(c)
  }

  async function joinWithCode() {
    const c = input.trim()
    if (!isValidSyncCode(c)) {
      toast.error("同步码格式不正确")
      return
    }
    setSyncCode(c)
    setInput("")
    await runSync(c)
  }

  function disable() {
    clearSyncCode()
    setReveal(false)
    toast.success("已关闭同步，服务器密文仍保留")
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
          code ? { label: "已开启 · 端到端加密", tone: "ok" } : { label: "未开启", tone: "off" }
        }
      />
      <p className="mt-2 text-xs text-muted-foreground">
        用同步码在多设备间同步订阅，服务器只存密文。取消的订阅可能被另一端带回。
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge
          variant="outline"
          className="gap-1 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
        >
          <Lock className="h-3 w-3" />
          订阅明文 · 只存本机
        </Badge>
        <Badge
          variant="outline"
          className="gap-1 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
        >
          <Cloud className="h-3 w-3" />
          同步密文 · 经服务器
        </Badge>
      </div>

      {code ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => runSync(code)} disabled={busy}>
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
            <Button size="sm" variant="ghost" onClick={disable}>
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
              <p className="text-xs text-muted-foreground">
                在其它设备的「我的 · 订阅」里粘贴此码。谁拿到同步码，都能读写你的订阅。
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button size="sm" onClick={enable} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            开启同步
          </Button>
          <span className="text-xs text-muted-foreground">或</span>
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="粘贴已有同步码"
              className="h-9 w-full sm:w-64"
            />
            <Button size="sm" variant="outline" onClick={joinWithCode} disabled={busy}>
              加入
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
