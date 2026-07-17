import { isNodeKind, type NodeKind } from "@protocol/node"

export const AGENT_CONTEXT_TRAY_LIMIT = 8
export const AGENT_CONTEXT_URL_LIMIT = 8_192
const AGENT_CONTEXT_ID_LIMIT = 1_024
const AGENT_CONTEXT_TITLE_LIMIT = 256

export type AgentContextSource =
  | Readonly<{
      key: string
      type: "node"
      kind: NodeKind
      id: string
      title: string
    }>
  | Readonly<{
      key: string
      type: "url"
      url: string
      title: string
    }>

export type AddAgentContextResult = "added" | "exists" | "full"

const listeners = new Set<() => void>()
let snapshot: readonly AgentContextSource[] = Object.freeze([])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function isAgentContextSource(value: unknown): value is AgentContextSource {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.title !== "string" ||
    value.title.length > AGENT_CONTEXT_TITLE_LIMIT
  ) {
    return false
  }
  if (value.type === "node") {
    return (
      typeof value.kind === "string" &&
      isNodeKind(value.kind) &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      value.id.length <= AGENT_CONTEXT_ID_LIMIT &&
      value.key === `node:${value.kind}:${value.id}`
    )
  }
  if (value.type !== "url" || typeof value.url !== "string") return false
  return urlAgentContextSource(value.url, value.title)?.key === value.key
}

function publish(next: readonly AgentContextSource[]): void {
  snapshot = Object.freeze([...next])
  for (const listener of listeners) listener()
}

export function nodeAgentContextSource(
  kind: NodeKind,
  id: string,
  title: string,
): AgentContextSource {
  return {
    key: `node:${kind}:${id}`,
    type: "node",
    kind,
    id,
    title: (title.trim() || id).slice(0, AGENT_CONTEXT_TITLE_LIMIT),
  }
}

export function urlAgentContextSource(url: string, title: string): AgentContextSource | null {
  if (url.length > AGENT_CONTEXT_URL_LIMIT) return null
  try {
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) return null
    parsed.username = ""
    parsed.password = ""
    if (parsed.href.length > AGENT_CONTEXT_URL_LIMIT) return null
    return {
      key: `url:${parsed.href}`,
      type: "url",
      url: parsed.href,
      title: (title.trim() || parsed.hostname).slice(0, AGENT_CONTEXT_TITLE_LIMIT),
    }
  } catch {
    return null
  }
}

export function getAgentContextSources(): readonly AgentContextSource[] {
  return snapshot
}

export function getServerAgentContextSources(): readonly AgentContextSource[] {
  return []
}

export function subscribeAgentContextSources(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function addAgentContextSource(source: AgentContextSource): AddAgentContextResult {
  if (snapshot.some((candidate) => candidate.key === source.key)) return "exists"
  if (snapshot.length >= AGENT_CONTEXT_TRAY_LIMIT) return "full"
  publish([...snapshot, source])
  return "added"
}

export function removeAgentContextSource(key: string): void {
  const next = snapshot.filter((source) => source.key !== key)
  if (next.length !== snapshot.length) publish(next)
}

export function clearAgentContextSources(): void {
  if (snapshot.length > 0) publish([])
}
