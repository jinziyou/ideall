"use client"

// 「已连接的应用」面板 (设置齿轮内) —— 列出运行期已建桥的嵌入应用 (origin + 已授权限) 并可一键吊销。
// 兑现 SECURITY.md 记录的「嵌入自动授权、无运行期可见/吊销面板」缺口。无连接时不渲染 (含分隔线)。
import * as React from "react"
import { Unplug } from "lucide-react"
import { Button } from "@/ui/button"
import { Separator } from "@/ui/separator"
import {
  subscribeConnections,
  getConnectionsSnapshot,
  getServerSnapshot,
  revokeConnection,
} from "./connections"

export function ConnectedApps() {
  const conns = React.useSyncExternalStore(
    subscribeConnections,
    getConnectionsSnapshot,
    getServerSnapshot,
  )
  if (conns.length === 0) return null
  return (
    <>
      <Separator className="my-3" />
      <div className="space-y-2">
        <div className="text-sm font-medium">已连接的应用</div>
        <ul className="space-y-1.5">
          {conns.map((c) => (
            <li key={c.id} className="rounded-shell border p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{c.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{c.origin}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => revokeConnection(c.id)}
                >
                  <Unplug className="mr-1 h-3.5 w-3.5" />
                  断开
                </Button>
              </div>
              {c.permissions.length > 0 && (
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  已授权限：{c.permissions.join("、")}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
