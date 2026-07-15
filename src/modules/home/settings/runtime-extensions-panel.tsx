"use client"

import * as React from "react"
import { Loader2, Puzzle, RefreshCw, ShieldOff, Trash2 } from "lucide-react"
import type {
  RuntimeExtensionSettingsDocument,
  RuntimeExtensionSettingsHealth,
} from "./settings-contract"
import { ConfirmDialog } from "@/shared/prompt-dialog"
import { Button } from "@/ui/button"
import { Chip } from "@/ui/chip"
import { EmptyState } from "@/ui/empty-state"
import { Panel } from "@/ui/panel"
import type { Tone } from "@/ui/status-dot"

type HealthPresentation = Readonly<{
  label: string
  tone: Tone | "neutral"
  description: string
}>

const HEALTH: Record<RuntimeExtensionSettingsHealth, HealthPresentation> = {
  discovered: {
    label: "待验证",
    tone: "idle",
    description: "扩展已被发现，尚未完成可信来源验证和用户授权。",
  },
  verifying: { label: "验证中", tone: "info", description: "宿主正在验证扩展来源与摘要。" },
  verified: { label: "已验证", tone: "info", description: "来源已验证，等待用户明确授权。" },
  "consent-required": {
    label: "等待授权",
    tone: "warn",
    description: "需要宿主提供验证与授权流程；不会自动授予权限或启用。",
  },
  ready: { label: "可启用", tone: "info", description: "信任条件已满足，可以启用扩展。" },
  activating: { label: "启用中", tone: "info", description: "正在挂载文件系统和渲染引擎。" },
  active: { label: "运行中", tone: "ok", description: "扩展贡献已挂载并可用。" },
  "tearing-down": {
    label: "卸载中",
    tone: "warn",
    description: "正在停止扩展并释放挂载资源。",
  },
  degraded: {
    label: "运行失败",
    tone: "error",
    description: "扩展未能正常启用或停止，可检查错误后重试。",
  },
  quarantined: {
    label: "已隔离",
    tone: "error",
    description: "部分资源清理失败，扩展已隔离；请重试清理。",
  },
  revoked: { label: "已撤销", tone: "idle", description: "扩展授权已撤销。" },
  unavailable: {
    label: "来源不可用",
    tone: "error",
    description: "保留了安装记录，但当前没有与之匹配的可信扩展包。",
  },
}

export function runtimeExtensionHealthPresentation(
  health: RuntimeExtensionSettingsHealth,
): HealthPresentation {
  return HEALTH[health]
}

export function runtimeExtensionSourceLabel(
  source: RuntimeExtensionSettingsDocument["source"],
): string {
  if (!source) return "未知来源"
  return `${source.kind === "builtin" ? "内置" : "软件包"} · ${source.id}`
}

export function runtimeExtensionFailureMessage(failure: unknown): string | null {
  if (failure == null) return null
  if (failure instanceof Error) return failure.message || failure.name
  if (typeof failure === "string") return failure
  try {
    return JSON.stringify(failure)
  } catch {
    return String(failure)
  }
}

export function runtimeExtensionActionPolicy(state: RuntimeExtensionSettingsDocument): Readonly<{
  retry: boolean
  revoke: boolean
  uninstall: boolean
}> {
  const hasGrant = state.desired
  const retry =
    state.health === "quarantined" ||
    (["ready", "degraded"].includes(state.health) && (state.source?.kind === "builtin" || hasGrant))
  const revoke = state.source?.kind === "package" && state.health !== "revoked" && hasGrant
  const uninstall =
    state.source?.kind !== "builtin" &&
    (state.desired ||
      ["activating", "active", "tearing-down", "degraded", "quarantined", "unavailable"].includes(
        state.health,
      ))
  return { retry, revoke, uninstall }
}

type DangerousAction = Readonly<{
  kind: "revoke" | "uninstall"
  extension: RuntimeExtensionSettingsDocument
}>

export type RuntimeExtensionPanelAction = "retry" | "revoke" | "uninstall"

export function RuntimeExtensionsPanel({
  extensions,
  loading = false,
  disabled = false,
  onAction,
}: {
  extensions: readonly RuntimeExtensionSettingsDocument[]
  loading?: boolean
  disabled?: boolean
  onAction(id: string, action: RuntimeExtensionPanelAction): Promise<boolean>
}) {
  const [busy, setBusy] = React.useState<{ id: string; action: string } | null>(null)
  const [actionFailure, setActionFailure] = React.useState<{ id: string; message: string } | null>(
    null,
  )
  const [dangerousAction, setDangerousAction] = React.useState<DangerousAction | null>(null)

  const run = React.useCallback(
    async (id: string, action: RuntimeExtensionPanelAction) => {
      setBusy({ id, action })
      setActionFailure(null)
      try {
        const changed = await onAction(id, action)
        if (action === "retry" && !changed) {
          setActionFailure({
            id,
            message: "无法自动恢复。该扩展仍需要宿主提供可信验证与明确授权。",
          })
        }
      } catch (error) {
        setActionFailure({
          id,
          message: runtimeExtensionFailureMessage(error) ?? "操作失败",
        })
      } finally {
        setBusy(null)
      }
    },
    [onAction],
  )

  return (
    <Panel title="运行时扩展">
      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        查看由可信宿主发现的文件系统与渲染引擎扩展。权限必须经过明确授权，卸载不会删除来源数据。
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取运行时扩展文件…
        </div>
      ) : extensions.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title="暂无运行时扩展"
          description="可信扩展被宿主发现后会显示在这里。"
          bordered={false}
          className="py-8"
        />
      ) : (
        <div className="divide-y rounded-md border">
          {extensions.map((extension) => {
            const status = runtimeExtensionHealthPresentation(extension.health)
            const policy = runtimeExtensionActionPolicy(extension)
            const failure =
              actionFailure?.id === extension.id
                ? actionFailure.message
                : runtimeExtensionFailureMessage(extension.failure)
            const isBusy = disabled || busy?.id === extension.id
            return (
              <article key={extension.id} className="space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium">{extension.label}</h3>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {extension.id}
                    </p>
                  </div>
                  <Chip tone={status.tone}>{status.label}</Chip>
                </div>

                <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">版本</dt>
                    <dd>v{extension.version}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">来源</dt>
                    <dd>{runtimeExtensionSourceLabel(extension.source)}</dd>
                  </div>
                </dl>

                <div className="space-y-2">
                  <p className="text-[13px] text-muted-foreground">{status.description}</p>
                  {extension.source === null ? (
                    <p className="text-[13px] text-warning">权限声明不可用，扩展不会被执行。</p>
                  ) : (
                    <>
                      {extension.source.kind === "builtin" ? (
                        <p className="text-[13px] text-muted-foreground">
                          内置扩展随 ideall 发行物提供，不能在此卸载或撤销信任。
                        </p>
                      ) : null}
                      {extension.permissions.length > 0 ? (
                        <div className="flex flex-wrap gap-2" aria-label="扩展权限">
                          {extension.permissions.map((permission) => (
                            <Chip key={permission} className="font-mono">
                              {permission}
                            </Chip>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[13px] text-muted-foreground">未声明额外权限</p>
                      )}
                    </>
                  )}
                </div>

                {extension.pendingCleanup.length > 0 ? (
                  <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-[13px] text-warning">
                    待清理：{extension.pendingCleanup.join("、")}
                  </div>
                ) : null}
                {failure ? (
                  <div
                    role="alert"
                    className="break-words rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[13px] text-destructive"
                  >
                    {failure}
                  </div>
                ) : null}

                {policy.retry || policy.revoke || policy.uninstall ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {policy.retry ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => void run(extension.id, "retry")}
                      >
                        {busy?.id === extension.id && busy.action === "retry" ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1.5 h-4 w-4" />
                        )}
                        {extension.health === "ready" ? "启用" : "重试"}
                      </Button>
                    ) : null}
                    {policy.revoke ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={isBusy}
                        onClick={() => setDangerousAction({ kind: "revoke", extension })}
                      >
                        <ShieldOff className="mr-1.5 h-4 w-4" />
                        撤销授权
                      </Button>
                    ) : null}
                    {policy.uninstall ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => setDangerousAction({ kind: "uninstall", extension })}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        卸载
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={dangerousAction !== null}
        onOpenChange={(open) => {
          if (!open) setDangerousAction(null)
        }}
        title={
          dangerousAction?.kind === "revoke"
            ? `撤销「${dangerousAction.extension.label}」的授权？`
            : `卸载「${dangerousAction?.extension.label ?? "扩展"}」？`
        }
        description={
          dangerousAction?.kind === "revoke"
            ? "扩展会被停止并撤销当前信任凭据；再次使用前必须重新验证和授权。"
            : "扩展提供的文件系统和渲染引擎会被移除，但不会删除其来源数据。"
        }
        confirmLabel={dangerousAction?.kind === "revoke" ? "撤销授权" : "卸载"}
        destructive
        onConfirm={() => {
          const action = dangerousAction
          setDangerousAction(null)
          if (action) void run(action.extension.id, action.kind)
        }}
      />
    </Panel>
  )
}
