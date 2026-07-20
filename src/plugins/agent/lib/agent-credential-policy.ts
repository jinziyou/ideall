import { clearMcpAuth } from "./agent-oauth"
import type { McpEnvVar, McpServer } from "./agent-mcp-registry"

export function httpEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
      ? `${url.origin}${url.pathname}`
      : null
  } catch {
    return null
  }
}

function restoreBindingSecrets(
  next: McpEnvVar[],
  current: readonly McpEnvVar[] | undefined,
): McpEnvVar[] {
  if (!current?.length) return next
  return next.map((item, index) => {
    if (item.value) return item
    const previous =
      current[index]?.key.toLowerCase() === item.key.toLowerCase()
        ? current[index]
        : current.find((candidate) => candidate.key.toLowerCase() === item.key.toLowerCase())
    return previous?.value ? { ...item, value: previous.value } : item
  })
}

function clearBindingValues(value: readonly McpEnvVar[] | undefined): McpEnvVar[] {
  return (value ?? []).map((item) => ({ key: item.key, value: "" }))
}

function restoreMcpUrlSecrets(nextValue: string, currentValue: string | undefined): string {
  if (!currentValue) return nextValue
  try {
    const next = new URL(nextValue)
    const current = new URL(currentValue)
    if (!next.username && current.username) next.username = current.username
    if (!next.password && current.password) next.password = current.password
    for (const key of [...next.searchParams.keys()]) {
      if (next.searchParams.get(key)) continue
      const previous = current.searchParams.get(key)
      if (previous) next.searchParams.set(key, previous)
    }
    return next.toString()
  } catch {
    return nextValue
  }
}

function clearMcpUrlSecrets(value: string | undefined): string {
  if (!value) return value ?? ""
  try {
    const url = new URL(value)
    url.username = ""
    url.password = ""
    url.hash = ""
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "")
    return url.toString()
  } catch {
    return ""
  }
}

export function isRemoteTransport(value: unknown): value is "http" | "sse" {
  return value === "http" || value === "sse"
}

function sameMcpCredentialTarget(
  next: Partial<McpServer>,
  previous: Partial<McpServer> | undefined,
): boolean {
  if (!previous || next.transport !== previous.transport) return false
  if (isRemoteTransport(next.transport)) {
    const endpoint = httpEndpoint(next.url)
    return endpoint !== null && endpoint === httpEndpoint(previous.url)
  }
  return (
    next.transport === "stdio" &&
    previous.transport === "stdio" &&
    (next.command ?? "") === (previous.command ?? "")
  )
}

/**
 * 只在凭据目标未改变时把 public JSON 中的空白脱敏位还原为现有本机值：远端绑定
 * transport+endpoint，stdio 绑定 command。改目标时宁可丢失旧凭据，也绝不把它重定向过去。
 */
export function mergeAgentMcpPublicConfig(
  next: readonly Partial<McpServer>[],
  currentServers: readonly Partial<McpServer>[],
): Partial<McpServer>[] {
  const current = new Map(
    currentServers
      .filter(
        (server): server is Partial<McpServer> & { id: string } => typeof server.id === "string",
      )
      .map((server) => [server.id, server]),
  )
  return next.map((server) => {
    const previous = typeof server.id === "string" ? current.get(server.id) : undefined
    const sameTarget = sameMcpCredentialTarget(server, previous)
    const sameRemoteTarget = sameTarget && isRemoteTransport(server.transport)
    const sameStdioTarget = sameTarget && server.transport === "stdio"
    return {
      ...server,
      command: server.command,
      args:
        previous && (sameStdioTarget || sameRemoteTarget) && server.args === ""
          ? previous.args
          : server.args,
      url:
        previous && sameRemoteTarget
          ? restoreMcpUrlSecrets(server.url ?? "", previous.url)
          : clearMcpUrlSecrets(server.url),
      env:
        previous && sameStdioTarget
          ? restoreBindingSecrets(server.env ?? [], previous.env)
          : clearBindingValues(server.env),
      headers:
        previous && sameRemoteTarget
          ? restoreBindingSecrets(server.headers ?? [], previous.headers)
          : clearBindingValues(server.headers),
    }
  })
}

export function clearMcpOAuthForChangedTargets(
  next: readonly Partial<McpServer>[],
  current: readonly Partial<McpServer>[],
): void {
  const currentById = new Map(
    current
      .filter(
        (server): server is Partial<McpServer> & { id: string } => typeof server.id === "string",
      )
      .map((server) => [server.id, server]),
  )
  const nextIds = new Set<string>()
  for (const server of next) {
    if (typeof server.id !== "string") continue
    nextIds.add(server.id)
    const previous = currentById.get(server.id)
    if (!sameMcpCredentialTarget(server, previous) || server.auth !== "oauth") {
      clearMcpAuth(server.id)
    }
  }
  for (const previous of current) {
    if (typeof previous.id === "string" && !nextIds.has(previous.id)) clearMcpAuth(previous.id)
  }
}
