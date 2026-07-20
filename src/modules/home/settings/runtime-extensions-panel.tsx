"use client"

import * as React from "react"
import {
  Download,
  ExternalLink,
  FileWarning,
  KeyRound,
  Loader2,
  Puzzle,
  RefreshCw,
  RotateCcw,
  ShieldOff,
  Trash2,
} from "lucide-react"
import type {
  RuntimeExtensionPublisherCandidate,
  RuntimeExtensionPublisherRotationCandidate,
  RuntimeExtensionPublisherSettingsDocument,
  RuntimeExtensionRegistrySettings,
  RuntimeExtensionSettingsDocument,
  RuntimeExtensionSettingsHealth,
  RuntimeExtensionUpdateCandidate,
} from "./settings-contract"
import { openExternal } from "@/lib/safe-url"
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
  "revocation-failed": {
    label: "撤销待重试",
    tone: "error",
    description: "扩展已停止，但系统凭据尚未确认删除；请重试撤销。",
  },
  revoked: { label: "已撤销", tone: "idle", description: "扩展授权已撤销。" },
  rejected: {
    label: "包已拒绝",
    tone: "error",
    description: "扩展包未通过来源、清单或文件摘要校验，没有进入可授权与可执行目录。",
  },
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
  authorize: boolean
  retry: boolean
  revoke: boolean
  uninstall: boolean
}> {
  const hasGrant = state.desired
  if (state.health === "revocation-failed") {
    return { authorize: false, retry: false, revoke: true, uninstall: false }
  }
  const authorize =
    state.source?.kind === "package" &&
    !hasGrant &&
    ["discovered", "verified", "consent-required", "degraded", "revoked"].includes(state.health)
  const retry =
    state.health === "quarantined" ||
    (["ready", "degraded", "consent-required"].includes(state.health) &&
      (state.source?.kind === "builtin" || hasGrant))
  const revoke = state.source?.kind === "package" && state.health !== "revoked" && hasGrant
  const uninstall =
    state.source?.kind !== "builtin" &&
    state.health !== "rejected" &&
    (state.source?.kind === "package" ||
      state.desired ||
      ["activating", "active", "tearing-down", "degraded", "quarantined", "unavailable"].includes(
        state.health,
      ))
  return { authorize, retry, revoke, uninstall }
}

type DangerousAction =
  | Readonly<{
      kind: "revoke" | "uninstall" | "rollback"
      extension: RuntimeExtensionSettingsDocument
    }>
  | Readonly<{
      kind: "revoke-publisher"
      publisher: RuntimeExtensionPublisherSettingsDocument
    }>

export type RuntimeExtensionPanelAction = "authorize" | "retry" | "revoke" | "uninstall"
export type RuntimeExtensionManagementAction =
  | "install-package"
  | "refresh-registry"
  | "prepare-update"
  | "apply-update"
  | "discard-update"
  | "inspect-publisher"
  | "inspect-publisher-rotation"
  | "apply-publisher-rotation"
  | "trust-publisher"
  | "revoke-publisher"
  | "import-revocations"
  | "rollback-package"

const EMPTY_REGISTRY: RuntimeExtensionRegistrySettings = {
  status: "unavailable",
  source: null,
  fetchedAt: null,
  generatedAt: null,
  expiresAt: null,
  sequence: null,
  failureCode: null,
  entries: [],
}

export function RuntimeExtensionsPanel({
  extensions,
  publishers = [],
  registry = EMPTY_REGISTRY,
  nativeAvailable = false,
  loading = false,
  disabled = false,
  onAction,
  onManagement,
}: {
  extensions: readonly RuntimeExtensionSettingsDocument[]
  publishers?: readonly RuntimeExtensionPublisherSettingsDocument[]
  registry?: RuntimeExtensionRegistrySettings
  nativeAvailable?: boolean
  loading?: boolean
  disabled?: boolean
  onAction(id: string, action: RuntimeExtensionPanelAction): Promise<boolean>
  onManagement?(action: RuntimeExtensionManagementAction, input?: unknown): Promise<unknown>
}) {
  const [busy, setBusy] = React.useState<{ id: string; action: string } | null>(null)
  const [actionFailure, setActionFailure] = React.useState<{ id: string; message: string } | null>(
    null,
  )
  const [dangerousAction, setDangerousAction] = React.useState<DangerousAction | null>(null)
  const [publisherCandidate, setPublisherCandidate] =
    React.useState<RuntimeExtensionPublisherCandidate | null>(null)
  const [rotationCandidate, setRotationCandidate] =
    React.useState<RuntimeExtensionPublisherRotationCandidate | null>(null)
  const [updateCandidate, setUpdateCandidate] =
    React.useState<RuntimeExtensionUpdateCandidate | null>(null)
  const updateConfirmed = React.useRef(false)
  const [notice, setNotice] = React.useState<string | null>(null)

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

  const runManagement = React.useCallback(
    async (action: RuntimeExtensionManagementAction, input?: unknown) => {
      if (!onManagement) return
      setBusy({ id: "$management", action })
      setActionFailure(null)
      setNotice(null)
      try {
        const result = await onManagement(action, input)
        if (action === "inspect-publisher") {
          setPublisherCandidate(result as RuntimeExtensionPublisherCandidate | null)
          return
        }
        if (action === "inspect-publisher-rotation") {
          setRotationCandidate(result as RuntimeExtensionPublisherRotationCandidate | null)
          return
        }
        if (action === "prepare-update") {
          setUpdateCandidate(result as RuntimeExtensionUpdateCandidate)
          return
        }
        if (result && typeof result === "object" && "cancelled" in result && result.cancelled) {
          return
        }
        if (action === "install-package") {
          const operation =
            result && typeof result === "object" && "operation" in result
              ? (result as { operation?: unknown }).operation
              : null
          setNotice(
            operation === "updated"
              ? "扩展已更新；旧授权已撤销，请核对新版本权限后重新授权。"
              : operation === "unchanged"
                ? "所选扩展包与当前版本一致。"
                : "扩展包已安装；验证权限后可单独授权启用。",
          )
        } else if (action === "refresh-registry") {
          setUpdateCandidate(null)
          const snapshot = result as { source?: unknown; failureCode?: unknown } | null
          setNotice(
            snapshot?.source === "cache" && snapshot.failureCode
              ? "联网刷新失败，已继续使用本地重新验签的目录缓存。"
              : "联网扩展目录已刷新并完成逐页验签。",
          )
        } else if (action === "import-revocations") {
          setNotice("签名撤销清单已导入，受影响扩展已停止并从可执行目录隔离。")
        } else if (action === "trust-publisher") {
          setPublisherCandidate(null)
          setNotice("publisher 信任根已保存；其扩展仍需逐个验证和授权。")
        } else if (action === "revoke-publisher") {
          setNotice("publisher 信任已撤销，其扩展已停止且不会再通过复验。")
        } else if (action === "apply-publisher-rotation") {
          setRotationCandidate(null)
          setNotice(
            "publisher 密钥已轮换；旧密钥和旧签名扩展已退役，请安装重新签名的包并逐项授权。",
          )
        } else if (action === "apply-update") {
          setUpdateCandidate(null)
          setNotice("扩展已更新并保留上一可信版本；旧授权已撤销，请核对新版本后重新授权。")
        } else if (action === "rollback-package") {
          setNotice("已恢复上一签名版本；原授权已撤销，请重新核对并授权。")
        }
      } catch (error) {
        setActionFailure({
          id: "$management",
          message: runtimeExtensionFailureMessage(error) ?? "扩展管理操作失败",
        })
      } finally {
        setBusy(null)
      }
    },
    [onManagement],
  )

  return (
    <Panel title="运行时扩展">
      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        安装包先由桌面宿主验证
        publisher、签名、摘要与撤销状态；代码安装不等于授权，权限仍需逐个明确确认。
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!nativeAvailable || disabled || busy !== null || !onManagement}
          onClick={() => void runManagement("install-package")}
        >
          {busy?.action === "install-package" ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          安装 / 更新签名包
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!nativeAvailable || disabled || busy !== null || !onManagement}
          onClick={() => void runManagement("inspect-publisher")}
        >
          <KeyRound className="mr-1.5 h-4 w-4" />
          导入 publisher 根
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!nativeAvailable || disabled || busy !== null || !onManagement}
          onClick={() => void runManagement("inspect-publisher-rotation")}
        >
          {busy?.action === "inspect-publisher-rotation" ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="mr-1.5 h-4 w-4" />
          )}
          导入密钥轮换
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!nativeAvailable || disabled || busy !== null || !onManagement}
          onClick={() => void runManagement("import-revocations")}
        >
          <FileWarning className="mr-1.5 h-4 w-4" />
          导入撤销清单
        </Button>
      </div>

      {!nativeAvailable ? (
        <p className="mb-4 rounded-md border bg-muted/30 p-3 text-[13px] text-muted-foreground">
          浏览器预览只展示扩展状态；安装、publisher 与撤销管理仅在桌面 App 中可用。
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mb-4 rounded-md border border-success/30 bg-success/10 p-3 text-[13px] text-success"
        >
          {notice}
        </p>
      ) : null}
      {actionFailure?.id === "$management" ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[13px] text-destructive"
        >
          {actionFailure.message}
        </p>
      ) : null}

      <section className="mb-5 space-y-2" aria-labelledby="runtime-extension-registry">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="runtime-extension-registry" className="text-sm font-medium">
              联网扩展目录
            </h3>
            <Chip
              tone={
                registry.status === "current"
                  ? "ok"
                  : registry.status === "stale"
                    ? "warn"
                    : "neutral"
              }
            >
              {registry.status === "current"
                ? registry.source === "network"
                  ? "已联网验签"
                  : "可信缓存"
                : registry.status === "stale"
                  ? "缓存已过期"
                  : "尚未获取"}
            </Chip>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!nativeAvailable || disabled || busy !== null || !onManagement}
            onClick={() => void runManagement("refresh-registry")}
          >
            {busy?.action === "refresh-registry" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            刷新目录
          </Button>
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          目录页由官方 Registry 签名；已安装扩展可由宿主安全下载并复验更新，确认安装后仍需重新授权。
          {registry.sequence !== null
            ? ` 当前序列 ${registry.sequence}，有效期至 ${new Date(registry.expiresAt ?? 0).toISOString()}。`
            : ""}
        </p>
        {registry.failureCode ? (
          <p className="rounded-md border border-warning/30 bg-warning/10 p-2 text-[12px] text-warning">
            {registry.status === "unavailable" ? "目录不可用" : "本次刷新未完成"}：
            {registry.failureCode}
          </p>
        ) : null}
        {registry.entries.length > 0 ? (
          <div className="divide-y rounded-md border">
            {registry.entries.map((entry) => {
              const installed = extensions.find((extension) => extension.id === entry.id)
              const hasUpdate =
                installed?.source?.kind === "package" && installed.version < entry.version
              const availability = installed
                ? hasUpdate
                  ? `可更新 · 已安装 v${installed.version}`
                  : `已安装 v${installed.version}`
                : "未安装"
              return (
                <article
                  key={entry.id}
                  className="flex flex-wrap items-start justify-between gap-3 p-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{entry.label}</span>
                      <Chip tone={hasUpdate ? "warn" : "neutral"}>{availability}</Chip>
                    </div>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                      {entry.summary}
                    </p>
                    <p className="break-all font-mono text-[11px] text-muted-foreground">
                      {entry.id} · v{entry.version} · {entry.publisher}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      权限：{entry.permissions.join("、")}
                    </p>
                  </div>
                  {hasUpdate ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        registry.status !== "current" ||
                        !nativeAvailable ||
                        disabled ||
                        busy !== null ||
                        !onManagement
                      }
                      onClick={() => void runManagement("prepare-update", { id: entry.id })}
                    >
                      {busy?.action === "prepare-update" ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-1.5 h-4 w-4" />
                      )}
                      下载并检查更新
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled || busy !== null}
                      onClick={() => openExternal(entry.packageUrl)}
                    >
                      <ExternalLink className="mr-1.5 h-4 w-4" />
                      获取签名包
                    </Button>
                  )}
                </article>
              )
            })}
          </div>
        ) : registry.status !== "unavailable" ? (
          <p className="rounded-md border bg-muted/20 p-3 text-[12px] text-muted-foreground">
            当前可信目录没有可用扩展。
          </p>
        ) : null}
      </section>

      {publishers.length > 0 ? (
        <section className="mb-5 space-y-2" aria-labelledby="runtime-extension-publishers">
          <h3 id="runtime-extension-publishers" className="text-sm font-medium">
            Publisher 信任根
          </h3>
          <div className="divide-y rounded-md border">
            {publishers.map((publisher) => (
              <div
                key={publisher.publisher}
                className="flex flex-wrap items-start justify-between gap-3 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{publisher.label}</span>
                    <Chip
                      tone={
                        publisher.status === "revoked"
                          ? "error"
                          : publisher.status === "official"
                            ? "info"
                            : "ok"
                      }
                    >
                      {publisher.status === "official"
                        ? "官方内置"
                        : publisher.status === "trusted"
                          ? "已信任"
                          : "已撤销"}
                    </Chip>
                  </div>
                  <p className="break-all font-mono text-[11px] text-muted-foreground">
                    {publisher.publisher} · {publisher.fingerprint}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    撤销序列 {publisher.revocationSequence ?? "未导入"} · 已撤销摘要{" "}
                    {publisher.revokedDigestCount}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    密钥序列 {publisher.keySequence} · 已退役密钥 {publisher.retiredKeyCount}
                    {publisher.rotatedAt
                      ? ` · 最近轮换 ${new Date(publisher.rotatedAt).toISOString()}`
                      : ""}
                  </p>
                </div>
                {publisher.status === "trusted" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={disabled || busy !== null || !onManagement}
                    onClick={() => setDangerousAction({ kind: "revoke-publisher", publisher })}
                  >
                    <ShieldOff className="mr-1.5 h-4 w-4" />
                    撤销根信任
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
                  {extension.source?.kind === "package" ? (
                    <>
                      <div>
                        <dt className="text-muted-foreground">来源验证</dt>
                        <dd className="break-all">
                          {extension.verification
                            ? `${extension.verification.verifierId} · ${new Date(extension.verification.verifiedAt).toISOString()}`
                            : "尚未验证"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Publisher 指纹</dt>
                        <dd className="break-all font-mono text-[11px]">
                          {extension.publisherFingerprint ?? "不可用"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">可回滚版本</dt>
                        <dd>
                          {extension.rollbackVersion === null
                            ? "无"
                            : `v${extension.rollbackVersion}`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">授权凭据</dt>
                        <dd>
                          {extension.grantedAt !== null
                            ? `已恢复 · ${new Date(extension.grantedAt).toISOString()}`
                            : extension.desired
                              ? "等待系统凭据库恢复"
                              : "未授权"}
                        </dd>
                      </div>
                    </>
                  ) : null}
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

                {policy.authorize ||
                policy.retry ||
                policy.revoke ||
                policy.uninstall ||
                extension.rollbackVersion !== null ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {policy.authorize ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => void run(extension.id, "authorize")}
                      >
                        {busy?.id === extension.id && busy.action === "authorize" ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : null}
                        验证并授权
                      </Button>
                    ) : null}
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
                    {extension.rollbackVersion !== null ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy || busy !== null || !onManagement}
                        onClick={() => setDangerousAction({ kind: "rollback", extension })}
                      >
                        <RotateCcw className="mr-1.5 h-4 w-4" />
                        回滚至 v{extension.rollbackVersion}
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
            : dangerousAction?.kind === "uninstall"
              ? `卸载「${dangerousAction.extension.label}」及其代码？`
              : dangerousAction?.kind === "rollback"
                ? `回滚「${dangerousAction.extension.label}」？`
                : dangerousAction?.kind === "revoke-publisher"
                  ? `撤销「${dangerousAction.publisher.label}」的根信任？`
                  : "确认扩展管理操作？"
        }
        description={
          dangerousAction?.kind === "revoke"
            ? "扩展会被停止并撤销当前信任凭据；再次使用前必须重新验证和授权。"
            : dangerousAction?.kind === "uninstall"
              ? "扩展会停止，授权凭据会撤销，当前代码和回滚副本会删除；扩展产生的个人数据不会删除。"
              : dangerousAction?.kind === "rollback"
                ? "当前扩展会停止并撤销授权，然后恢复上一已验证版本；回滚后需要重新授权。"
                : "该 publisher 的全部扩展会立即停止并拒绝复验；已有代码不会执行。"
        }
        confirmLabel={
          dangerousAction?.kind === "revoke"
            ? "撤销授权"
            : dangerousAction?.kind === "uninstall"
              ? "卸载代码"
              : dangerousAction?.kind === "rollback"
                ? "确认回滚"
                : "撤销根信任"
        }
        destructive
        onConfirm={() => {
          const action = dangerousAction
          setDangerousAction(null)
          if (!action) return
          if (action.kind === "revoke-publisher") {
            void runManagement("revoke-publisher", {
              publisher: action.publisher.publisher,
              fingerprint: action.publisher.fingerprint,
            })
          } else if (action.kind === "rollback") {
            void runManagement("rollback-package", { id: action.extension.id })
          } else {
            void run(action.extension.id, action.kind)
          }
        }}
      />

      <ConfirmDialog
        open={updateCandidate !== null}
        onOpenChange={(open) => {
          if (!open) {
            if (updateConfirmed.current) {
              updateConfirmed.current = false
              return
            }
            const candidate = updateCandidate
            setUpdateCandidate(null)
            if (candidate) void runManagement("discard-update", { token: candidate.token })
          }
        }}
        title={`更新「${updateCandidate?.label ?? "扩展"}」？`}
        description={`候选包已完成 Registry、下载 SHA-256、publisher 签名、manifest 摘要和撤销状态复验。确认后会停止旧版本并撤销旧授权，再原子安装新版本并保留一个回滚副本。\n\nv${updateCandidate?.currentVersion ?? ""} → v${updateCandidate?.nextVersion ?? ""}\n新增权限：${updateCandidate?.addedPermissions.join("、") || "无"}\n移除权限：${updateCandidate?.removedPermissions.join("、") || "无"}\nPublisher：${updateCandidate?.publisherFingerprint ?? ""}`}
        confirmLabel="停止旧版本并安装更新"
        destructive
        onConfirm={() => {
          const candidate = updateCandidate
          updateConfirmed.current = true
          setUpdateCandidate(null)
          if (candidate) void runManagement("apply-update", candidate)
        }}
      />

      <ConfirmDialog
        open={rotationCandidate !== null}
        onOpenChange={(open) => {
          if (!open) setRotationCandidate(null)
        }}
        title={`轮换「${rotationCandidate?.label ?? "publisher"}」的签名密钥？`}
        description={`宿主已验证当前密钥授权和下一密钥持有证明。轮换后旧密钥永久退役，所有旧密钥签名的已安装包和回滚副本会停止通过复验，且原授权会被撤销。请先确认发行方已准备重新签名的包。\n\n序列：${rotationCandidate?.sequence ?? ""}\n当前：${rotationCandidate?.currentFingerprint ?? ""}\n下一：${rotationCandidate?.nextFingerprint ?? ""}`}
        confirmLabel="确认轮换并停用旧包"
        destructive
        onConfirm={() => {
          const candidate = rotationCandidate
          setRotationCandidate(null)
          if (candidate) void runManagement("apply-publisher-rotation", candidate)
        }}
      />

      <ConfirmDialog
        open={publisherCandidate !== null}
        onOpenChange={(open) => {
          if (!open) setPublisherCandidate(null)
        }}
        title={`信任「${publisherCandidate?.label ?? "publisher"}」？`}
        description={`请通过独立渠道核对 publisher ID 与公钥指纹。建立根信任只允许其扩展进入逐包授权流程，不会自动运行代码。\n\n${publisherCandidate?.publisher ?? ""}\n${publisherCandidate?.fingerprint ?? ""}`}
        confirmLabel="指纹已核对，建立信任"
        onConfirm={() => {
          const candidate = publisherCandidate
          if (candidate) void runManagement("trust-publisher", candidate)
        }}
      />
    </Panel>
  )
}
