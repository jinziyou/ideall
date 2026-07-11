"use client"

import { hydrateSessionTokenSecure } from "@/lib/auth/auth-store"
import { hydrateSyncCodeSecure } from "@/lib/sync-code"
import {
  secureStoreSecuritySnapshot,
  secureStoreStatus,
  type SecureStoreSecuritySnapshot,
  type SecureStoreStatus,
} from "@/lib/secure-store"
import {
  agentSettingsSecuritySnapshot,
  hydrateAgentSettingsSecure,
} from "@/plugins/agent/lib/agent-settings"
import {
  agentWorkspacesSecuritySnapshot,
  hydrateAgentWorkspaceSecretsSecure,
} from "@/plugins/agent/lib/agent-workspace"
import {
  agentSecretsSecuritySnapshot,
  hydrateAgentSecretsSecure,
} from "@/plugins/agent/lib/agent-secrets"
import { getMcpServers } from "@/plugins/agent/lib/agent-mcp-registry"
import {
  hydrateMcpOAuthSecureForServers,
  mcpOAuthSecuritySnapshot,
} from "@/plugins/agent/lib/agent-oauth"

export type SecurityDiagnostics = {
  secureStore: SecureStoreStatus
  secureInventory: SecureStoreSecuritySnapshot
  agentSettings: ReturnType<typeof agentSettingsSecuritySnapshot>
  agentWorkspaces: ReturnType<typeof agentWorkspacesSecuritySnapshot>
  agentSecrets: ReturnType<typeof agentSecretsSecuritySnapshot>
  mcpOAuth: ReturnType<typeof mcpOAuthSecuritySnapshot>
  issues: string[]
}

export async function readSecurityDiagnostics(): Promise<SecurityDiagnostics> {
  const secureStore = await secureStoreStatus()
  const secureInventory = secureStoreSecuritySnapshot()
  const agentSettings = agentSettingsSecuritySnapshot()
  const agentWorkspaces = agentWorkspacesSecuritySnapshot()
  const agentSecrets = agentSecretsSecuritySnapshot()
  const mcpOAuth = mcpOAuthSecuritySnapshot()
  const issues = [
    !secureStore.native ? "当前环境未使用系统凭据后端" : "",
    secureInventory.legacyValueCount
      ? `${secureInventory.legacyValueCount} 个旧公开敏感键可迁移`
      : "",
    agentSettings.localApiKeyPresent ? "全局 AI API Key 仍存在于 localStorage" : "",
    agentWorkspaces.localApiKeyCount
      ? `${agentWorkspaces.localApiKeyCount} 个工作区模型覆盖 API Key 仍存在于 localStorage`
      : "",
    agentSecrets.localValueCount
      ? `${agentSecrets.localValueCount} 个 MCP 密钥值仍存在于 localStorage`
      : "",
    mcpOAuth.localTokenCount
      ? `${mcpOAuth.localTokenCount} 个旧 MCP OAuth token 仍存在于公开 localStorage`
      : "",
    mcpOAuth.localVerifierCount
      ? `${mcpOAuth.localVerifierCount} 个旧 MCP OAuth verifier 仍存在于公开 localStorage`
      : "",
  ].filter((issue): issue is string => Boolean(issue))

  return {
    secureStore,
    secureInventory,
    agentSettings,
    agentWorkspaces,
    agentSecrets,
    mcpOAuth,
    issues,
  }
}

/** 将已知敏感配置迁移到安全存储；schema 修复前也复用同一迁移序列。 */
export async function migrateSensitiveDataToSecureStore(): Promise<void> {
  await Promise.all([
    hydrateSessionTokenSecure(),
    hydrateSyncCodeSecure(),
    hydrateAgentSettingsSecure(),
    hydrateAgentWorkspaceSecretsSecure(),
    hydrateAgentSecretsSecure(),
    hydrateMcpOAuthSecureForServers(getMcpServers().map((server) => server.id)),
  ])
}
