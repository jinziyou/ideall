import {
  IDB_DATABASE_NAME,
  IDB_DATABASE_VERSION,
  INDEX_AGENT_WRITE_AUDIT_UPDATED_AT,
  STORE_AGENT_WRITE_AUDIT,
  idbGetAll,
  idbReadModifyWrite,
  idbRunTransaction,
} from "@/lib/idb"
import type { AgentToolEffect, AgentToolRisk } from "./agent-tool-preview"

export const AGENT_WRITE_AUDIT_SCHEMA = {
  databaseName: IDB_DATABASE_NAME,
  databaseVersion: IDB_DATABASE_VERSION,
  storeName: STORE_AGENT_WRITE_AUDIT,
  recordVersion: 1,
} as const

export const MAX_AGENT_WRITE_AUDIT_RECORDS = 1_000
export const DEFAULT_AGENT_WRITE_AUDIT_LIMIT = 200

export type AgentWriteAuditStatus = "pending" | "committed" | "failed" | "rejected" | "undone"
export type AgentWriteAuditSource = "artifact" | "tool"

export type AgentWriteAuditRecord = Readonly<{
  id: string
  version: 1
  source: AgentWriteAuditSource
  operation: string
  title: string
  summary: string
  status: AgentWriteAuditStatus
  effect: AgentToolEffect
  risk: AgentToolRisk
  target?: Readonly<{
    kind?: string
    id?: string
    label: string
  }>
  threadId?: string
  messageId?: string
  createdAt: number
  updatedAt: number
}>

export type AgentWriteAuditInput = Omit<
  AgentWriteAuditRecord,
  "id" | "version" | "createdAt" | "updatedAt"
>

export type AgentWriteAuditCompletion = Readonly<{
  id: string
  status: "committed" | "failed"
  summary: string
}>

const MAX_TEXT_LENGTH = 240
const listeners = new Set<() => void>()
let channel: BroadcastChannel | null = null

function bounded(value: string, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim()
  if (!normalized) return fallback
  return normalized.length > MAX_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_TEXT_LENGTH - 1)}…`
    : normalized
}

function ensureChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel
  channel = new BroadcastChannel("ideall:agent-write-audit:v1")
  channel.onmessage = () => {
    for (const listener of listeners) listener()
  }
  return channel
}

function publish(): void {
  for (const listener of listeners) listener()
  try {
    ensureChannel()?.postMessage({ type: "changed" })
  } catch {}
}

function makeId(now: number): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ? `audit-${uuid}` : `audit-${now}-${Math.random().toString(36).slice(2, 12)}`
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isTarget(value: unknown): value is NonNullable<AgentWriteAuditRecord["target"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const target = value as Record<string, unknown>
  return (
    Object.keys(target).every((key) => key === "kind" || key === "id" || key === "label") &&
    isString(target.label) &&
    (target.kind === undefined || typeof target.kind === "string") &&
    (target.id === undefined || typeof target.id === "string")
  )
}

export function isAgentWriteAuditRecord(value: unknown): value is AgentWriteAuditRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const allowedKeys = new Set([
    "id",
    "version",
    "source",
    "operation",
    "title",
    "summary",
    "status",
    "effect",
    "risk",
    "target",
    "threadId",
    "messageId",
    "createdAt",
    "updatedAt",
  ])
  return (
    Object.keys(item).every((key) => allowedKeys.has(key)) &&
    isString(item.id) &&
    item.version === 1 &&
    (item.source === "artifact" || item.source === "tool") &&
    isString(item.operation) &&
    isString(item.title) &&
    isString(item.summary) &&
    ["pending", "committed", "failed", "rejected", "undone"].includes(String(item.status)) &&
    (item.status !== "pending" || item.source === "tool") &&
    ["read", "write", "delete", "navigation", "external"].includes(String(item.effect)) &&
    ["low", "medium", "high"].includes(String(item.risk)) &&
    (item.target === undefined || isTarget(item.target)) &&
    (item.threadId === undefined || typeof item.threadId === "string") &&
    (item.messageId === undefined || typeof item.messageId === "string") &&
    typeof item.createdAt === "number" &&
    Number.isFinite(item.createdAt) &&
    typeof item.updatedAt === "number" &&
    Number.isFinite(item.updatedAt)
  )
}

export function decodeAgentWriteAuditInput(value: unknown): AgentWriteAuditInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent audit input must be an object")
  }
  const item = value as Record<string, unknown>
  const allowedKeys = new Set([
    "source",
    "operation",
    "title",
    "summary",
    "status",
    "effect",
    "risk",
    "target",
    "threadId",
    "messageId",
  ])
  const candidate = { ...item, id: "audit-input", version: 1, createdAt: 0, updatedAt: 0 }
  if (
    !Object.keys(item).every((key) => allowedKeys.has(key)) ||
    !isAgentWriteAuditRecord(candidate)
  ) {
    throw new TypeError("Invalid Agent audit input")
  }
  return {
    source: candidate.source,
    operation: candidate.operation,
    title: candidate.title,
    summary: candidate.summary,
    status: candidate.status,
    effect: candidate.effect,
    risk: candidate.risk,
    ...(candidate.target ? { target: candidate.target } : {}),
    ...(candidate.threadId ? { threadId: candidate.threadId } : {}),
    ...(candidate.messageId ? { messageId: candidate.messageId } : {}),
  }
}

export function decodeAgentWriteAuditCompletion(value: unknown): AgentWriteAuditCompletion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent audit completion must be an object")
  }
  const item = value as Record<string, unknown>
  if (
    !Object.keys(item).every((key) => key === "id" || key === "status" || key === "summary") ||
    !isString(item.id) ||
    (item.status !== "committed" && item.status !== "failed") ||
    !isString(item.summary)
  ) {
    throw new TypeError("Invalid Agent audit completion")
  }
  return { id: item.id, status: item.status, summary: item.summary }
}

/** 纯状态机：只有待确认的工具意图可以结算，防止迟到回执覆盖既有终态。 */
export function completeAgentWriteAuditRecord(
  current: AgentWriteAuditRecord | undefined,
  completion: AgentWriteAuditCompletion,
  now = Date.now(),
): AgentWriteAuditRecord {
  if (!current) throw new Error("Agent audit intent not found")
  if (current.id !== completion.id) throw new Error("Agent audit intent id mismatch")
  if (current.source !== "tool" || current.status !== "pending") {
    throw new Error("Agent audit intent is already finalized")
  }
  return {
    ...current,
    status: completion.status,
    summary: bounded(completion.summary, "已记录工具执行结果"),
    updatedAt: now,
  }
}

/**
 * 新增一条脱敏审计，并在同一事务中从最旧记录开始裁剪。审计是用户可见的
 * 本机活动历史，不随 Agent 配置导出，也不包含原始参数或产物正文。
 */
export async function appendAgentWriteAudit(
  input: AgentWriteAuditInput,
): Promise<AgentWriteAuditRecord> {
  const now = Date.now()
  const record: AgentWriteAuditRecord = {
    id: makeId(now),
    version: 1,
    source: input.source,
    operation: bounded(input.operation, "unknown"),
    title: bounded(input.title, "Agent 写操作"),
    summary: bounded(input.summary, "已记录写操作结果"),
    status: input.status,
    effect: input.effect,
    risk: input.risk,
    ...(input.target
      ? {
          target: {
            ...(input.target.kind ? { kind: bounded(input.target.kind, "unknown") } : {}),
            ...(input.target.id ? { id: bounded(input.target.id, "unknown") } : {}),
            label: bounded(input.target.label, "未命名目标"),
          },
        }
      : {}),
    ...(input.threadId ? { threadId: bounded(input.threadId, "unknown") } : {}),
    ...(input.messageId ? { messageId: bounded(input.messageId, "unknown") } : {}),
    createdAt: now,
    updatedAt: now,
  }

  await idbRunTransaction<void>(
    [STORE_AGENT_WRITE_AUDIT],
    "readwrite",
    (transaction, setResult, abort) => {
      const store = transaction.objectStore(STORE_AGENT_WRITE_AUDIT)
      store.put(record)
      const count = store.count()
      count.onerror = () => abort(count.error)
      count.onsuccess = () => {
        let remaining = Math.max(0, count.result - MAX_AGENT_WRITE_AUDIT_RECORDS)
        if (remaining === 0) return
        const cursor = store.index(INDEX_AGENT_WRITE_AUDIT_UPDATED_AT).openCursor()
        cursor.onerror = () => abort(cursor.error)
        cursor.onsuccess = () => {
          const current = cursor.result
          if (!current) {
            if (remaining > 0) abort(new Error("Agent audit outbox is full of pending intents"))
            return
          }
          // 未结算意图不能因容量裁剪而消失；若 1,000 条全是 pending，则回滚本次追加并阻止新工具。
          if ((current.value as { status?: unknown } | null)?.status !== "pending") {
            store.delete(current.primaryKey)
            remaining -= 1
          }
          if (remaining === 0) return
          current.continue()
        }
      }
      setResult(undefined)
    },
  )
  publish()
  return record
}

/**
 * 原子结算一条 pending outbox。读取、状态校验与写回位于同一 IndexedDB 事务，
 * 重复或迟到的结算会冲突而不是覆盖已经可见的结果。
 */
export async function completeAgentWriteAudit(
  completion: AgentWriteAuditCompletion,
): Promise<AgentWriteAuditRecord> {
  const completed = await idbReadModifyWrite<AgentWriteAuditRecord>(
    STORE_AGENT_WRITE_AUDIT,
    completion.id,
    (current) => completeAgentWriteAuditRecord(current, completion),
  )
  if (!completed) throw new Error("Agent audit intent not found")
  publish()
  return completed
}

export async function listAgentWriteAudits(
  limit = DEFAULT_AGENT_WRITE_AUDIT_LIMIT,
): Promise<AgentWriteAuditRecord[]> {
  const boundedLimit = Math.max(1, Math.min(MAX_AGENT_WRITE_AUDIT_RECORDS, Math.floor(limit)))
  return (await idbGetAll<unknown>(STORE_AGENT_WRITE_AUDIT))
    .filter(isAgentWriteAuditRecord)
    .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id))
    .slice(0, boundedLimit)
}

export function subscribeAgentWriteAudits(listener: () => void): () => void {
  listeners.add(listener)
  ensureChannel()
  return () => listeners.delete(listener)
}
