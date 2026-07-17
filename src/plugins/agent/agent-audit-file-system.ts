import { fileRefKey, sameFileRef, type IdeallFile } from "@protocol/file-system"
import {
  AGENT_AUDIT_FILE_REF,
  AGENT_AUDIT_FILE_SYSTEM_ID,
  AGENT_AUDIT_MEDIA_TYPE,
} from "@/filesystem/builtin-app-roots"
import { FileSystemError } from "@/filesystem/types"
import type {
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchHandle,
} from "@/filesystem/types"
import {
  appendAgentWriteAudit,
  completeAgentWriteAudit,
  decodeAgentWriteAuditCompletion,
  decodeAgentWriteAuditInput,
  listAgentWriteAudits,
  MAX_AGENT_WRITE_AUDIT_RECORDS,
  subscribeAgentWriteAudits,
} from "./lib/agent-write-audit"
import {
  AGENT_AUDIT_APPEND_ACTION,
  AGENT_AUDIT_COMPLETE_ACTION,
  AGENT_AUDIT_WRITE_PERMISSION,
} from "./agent-audit-file-contract"

const SOURCE = {
  kind: "app",
  id: "agent-write-audit",
  label: "AI 写入审计",
  readOnly: true,
} as const

function assertRef(ref: IdeallFile["ref"]): void {
  if (!sameFileRef(ref, AGENT_AUDIT_FILE_REF)) {
    throw new FileSystemError("not-found", `Agent audit not found: ${fileRefKey(ref)}`, ref)
  }
}

function assertIntent(
  ref: IdeallFile["ref"],
  ctx: FileSystemAccessContext,
  intent: FileSystemAccessContext["intent"],
): void {
  if (ctx.intent !== intent) {
    throw new FileSystemError("permission-denied", `Agent audit requires ${intent} intent`, ref)
  }
  if (ctx.actor === "ui" || ctx.permissions.includes("fs:read")) return
  if (ctx.actor === "engine" && ctx.activeFile && sameFileRef(ctx.activeFile, ref)) return
  throw new FileSystemError("permission-denied", "Missing fs:read permission", ref)
}

function assertTrustedAction(ref: IdeallFile["ref"], ctx: FileSystemAccessContext): void {
  if (
    ctx.intent === "action" &&
    (ctx.actor === "ui" ||
      (ctx.actor === "agent" && ctx.permissions.includes(AGENT_AUDIT_WRITE_PERMISSION)))
  ) {
    return
  }
  throw new FileSystemError(
    "permission-denied",
    "Only the trusted UI or Agent audit runtime may write Agent audit records",
    ref,
  )
}

async function snapshot() {
  const records = await listAgentWriteAudits(MAX_AGENT_WRITE_AUDIT_RECORDS)
  const text = JSON.stringify({ version: 1, records }, null, 2)
  const bytes = new TextEncoder().encode(text)
  const newest = records[0]
  return {
    records,
    text,
    bytes,
    version: `agent-write-audit-v1:${records.length}:${newest?.updatedAt ?? 0}:${newest?.id ?? "empty"}`,
  }
}

async function auditFile(includeContentMetadata: boolean): Promise<IdeallFile> {
  const current = includeContentMetadata ? await snapshot() : null
  return {
    ref: AGENT_AUDIT_FILE_REF,
    kind: "file",
    name: "AI 写入审计",
    mediaType: AGENT_AUDIT_MEDIA_TYPE,
    capabilities: ["read", "watch"],
    source: SOURCE,
    ...(current
      ? {
          size: current.bytes.byteLength,
          updatedAt: current.records[0]?.updatedAt,
          version: current.version,
        }
      : {}),
    properties: {
      agentManagementSurface: "audit",
      localOnly: true,
      redacted: true,
    },
  }
}

export function createAgentAuditFileSystem(): FileSystemProvider {
  return {
    descriptor: {
      fileSystemId: AGENT_AUDIT_FILE_SYSTEM_ID,
      name: "AI 写入审计",
      root: AGENT_AUDIT_FILE_REF,
      source: SOURCE,
      capabilities: ["read", "watch"],
    },
    async stat(ref, ctx) {
      assertIntent(ref, ctx, "metadata")
      if (!sameFileRef(ref, AGENT_AUDIT_FILE_REF)) return null
      try {
        return await auditFile(true)
      } catch {
        // 审计库暂不可读时仍保持稳定 FileRef 可寻址，实际 read 再返回错误。
        return auditFile(false)
      }
    },
    async readDirectory(ref) {
      assertRef(ref)
      throw new FileSystemError("unsupported", "Agent audit is not a directory", ref)
    },
    async read(ref, ctx, options: FileReadOptions = {}): Promise<FileReadResult> {
      assertRef(ref)
      assertIntent(ref, ctx, "content")
      if ((options.encoding === undefined || options.encoding === "json") && options.range) {
        throw new FileSystemError("invalid-input", "JSON reads do not support byte ranges", ref)
      }
      let current: Awaited<ReturnType<typeof snapshot>>
      try {
        current = await snapshot()
      } catch {
        throw new FileSystemError("offline", "Unable to read the local Agent audit", ref)
      }
      if (options.encoding === undefined || options.encoding === "json") {
        return {
          data: { version: 1, records: current.records },
          mediaType: AGENT_AUDIT_MEDIA_TYPE,
          size: current.bytes.byteLength,
          version: current.version,
        }
      }
      const start = options.range?.start ?? 0
      const end = options.range?.end ?? current.bytes.byteLength
      if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < start) {
        throw new FileSystemError("invalid-input", "Invalid Agent audit byte range", ref)
      }
      const bytes = current.bytes.slice(start, end)
      return {
        data: options.encoding === "binary" ? bytes : new TextDecoder().decode(bytes),
        mediaType: AGENT_AUDIT_MEDIA_TYPE,
        size: bytes.byteLength,
        version: current.version,
      }
    },
    async write(ref) {
      assertRef(ref)
      throw new FileSystemError("unsupported", "Agent audit is append-only", ref)
    },
    async actions(ref, ctx) {
      assertRef(ref)
      assertTrustedAction(ref, ctx)
      return [
        {
          id: AGENT_AUDIT_APPEND_ACTION,
          label: "追加脱敏审计",
          kind: "specialized",
          risk: "caution",
          reason: "只接受固定字段的脱敏本机写入回执",
        },
        {
          id: AGENT_AUDIT_COMPLETE_ACTION,
          label: "结算待确认审计",
          kind: "specialized",
          risk: "caution",
          reason: "只允许把 pending 工具意图原子结算为成功或失败",
        },
      ]
    },
    async invoke(ref, action, input, ctx) {
      assertRef(ref)
      if (action === AGENT_AUDIT_APPEND_ACTION) {
        assertTrustedAction(ref, ctx)
        let decoded: ReturnType<typeof decodeAgentWriteAuditInput>
        try {
          decoded = decodeAgentWriteAuditInput(input)
        } catch {
          throw new FileSystemError("invalid-input", "Invalid Agent audit append input", ref)
        }
        try {
          return await appendAgentWriteAudit(decoded)
        } catch {
          throw new FileSystemError("offline", "Unable to append the local Agent audit", ref)
        }
      }
      if (action === AGENT_AUDIT_COMPLETE_ACTION) {
        assertTrustedAction(ref, ctx)
        let decoded: ReturnType<typeof decodeAgentWriteAuditCompletion>
        try {
          decoded = decodeAgentWriteAuditCompletion(input)
        } catch {
          throw new FileSystemError("invalid-input", "Invalid Agent audit completion input", ref)
        }
        try {
          return await completeAgentWriteAudit(decoded)
        } catch (error) {
          if (error instanceof Error && /not found|already finalized/u.test(error.message)) {
            throw new FileSystemError("conflict", "Agent audit intent cannot be finalized", ref)
          }
          throw new FileSystemError("offline", "Unable to finalize the local Agent audit", ref)
        }
      }
      throw new FileSystemError("unsupported", "Agent audit has no actions", ref)
    },
    watch(ref, ctx, notify): FileSystemWatchHandle | null {
      assertRef(ref)
      assertIntent(ref, ctx, "watch")
      return {
        dispose: subscribeAgentWriteAudits(() => {
          try {
            notify({ type: "changed", ref })
          } catch {}
        }),
      }
    },
  }
}

export const agentAuditFileSystem = createAgentAuditFileSystem()
