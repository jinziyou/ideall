"use client"

import { AlertTriangle, ShieldCheck } from "lucide-react"
import { Button } from "@/ui/button"
import type { SecurityDiagnostics } from "./security-diagnostics"
import { SectionTitle } from "./code-page-chrome"

export function SecurityPanel({
  diagnostics,
  onMigrate,
}: {
  diagnostics: SecurityDiagnostics | null
  onMigrate: () => void
}) {
  const issueCount = diagnostics?.issues.length ?? 0
  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <SectionTitle icon={ShieldCheck} title="安全存储" />
      <div className="space-y-3 p-4 text-sm">
        {!diagnostics ? (
          <div className="text-muted-foreground">正在读取安全存储状态</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {diagnostics.secureStore.native ? "系统凭据后端" : "本地存储降级"}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {diagnostics.secureStore.backend}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={onMigrate}>
                迁移/清理敏感值
              </Button>
            </div>
            <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">AI Key</dt>
              <dd>{diagnostics.agentSettings.localApiKeyPresent ? "需清理" : "未见明文本地值"}</dd>
              <dt className="text-muted-foreground">工作区 Key</dt>
              <dd>
                {diagnostics.agentWorkspaces.localApiKeyCount
                  ? `${diagnostics.agentWorkspaces.localApiKeyCount} 个需清理`
                  : `${diagnostics.agentWorkspaces.total} 个工作区 / 未见明文本地值`}
              </dd>
              <dt className="text-muted-foreground">MCP 密钥</dt>
              <dd>
                {diagnostics.agentSecrets.localValueCount
                  ? `${diagnostics.agentSecrets.localValueCount} 个需清理`
                  : `${diagnostics.agentSecrets.total} 个名称 / 未见明文本地值`}
              </dd>
              <dt className="text-muted-foreground">OAuth</dt>
              <dd>
                {diagnostics.mcpOAuth.localTokenCount || diagnostics.mcpOAuth.localVerifierCount
                  ? `${diagnostics.mcpOAuth.localTokenCount} token / ${diagnostics.mcpOAuth.localVerifierCount} verifier 需清理`
                  : `${diagnostics.mcpOAuth.cachedTokenCount} 个 token 已载入安全缓存`}
              </dd>
              <dt className="text-muted-foreground">统一端口</dt>
              <dd>
                {diagnostics.secureInventory.fallbackValueCount} /{" "}
                {diagnostics.secureInventory.registeredCount} 个注册项有 fallback 值
              </dd>
            </dl>
            {issueCount > 0 ? (
              <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
                {diagnostics.issues.map((issue) => (
                  <div key={issue} className="flex gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-700">
                未发现可自动迁移的明文敏感值
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
