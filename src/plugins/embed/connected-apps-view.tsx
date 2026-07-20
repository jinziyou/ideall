"use client"

import { Unplug } from "lucide-react"
import { Button } from "@/ui/button"
import { Separator } from "@/ui/separator"

export type ConnectedAppViewItem = Readonly<{
  id: string
  name: string
  origin: string
  permissions: readonly string[]
}>

export function ConnectedAppsView({
  connections,
  disabled = false,
  onRevoke,
}: {
  connections: readonly ConnectedAppViewItem[]
  disabled?: boolean
  onRevoke(id: string): void
}) {
  if (connections.length === 0) return null
  return (
    <>
      <Separator className="my-3" />
      <div className="space-y-2">
        <div className="text-sm font-medium">已连接的应用</div>
        <ul className="space-y-1.5">
          {connections.map((connection) => (
            <li key={connection.id} className="rounded-shell border p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{connection.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {connection.origin}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                  disabled={disabled}
                  onClick={() => onRevoke(connection.id)}
                >
                  <Unplug className="mr-1 h-3.5 w-3.5" />
                  撤销授权
                </Button>
              </div>
              {connection.permissions.length > 0 ? (
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  已授权限：{connection.permissions.join("、")}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
