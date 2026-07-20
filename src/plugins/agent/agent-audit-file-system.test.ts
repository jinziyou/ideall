import assert from "node:assert/strict"
import { test } from "node:test"
import { AGENT_AUDIT_FILE_REF, AGENT_AUDIT_MEDIA_TYPE } from "@/filesystem/builtin-app-roots"
import { FileSystemError, type FileSystemAccessContext } from "@/filesystem/types"
import { createAgentAuditFileSystem } from "./agent-audit-file-system"
import {
  AGENT_AUDIT_APPEND_ACTION,
  AGENT_AUDIT_COMPLETE_ACTION,
  AGENT_AUDIT_WRITE_PERMISSION,
} from "./agent-audit-file-contract"

const metadata: FileSystemAccessContext = { actor: "ui", permissions: [], intent: "metadata" }
const content: FileSystemAccessContext = { actor: "ui", permissions: [], intent: "content" }
const action: FileSystemAccessContext = { actor: "ui", permissions: [], intent: "action" }
const agentAction: FileSystemAccessContext = {
  actor: "agent",
  permissions: [AGENT_AUDIT_WRITE_PERMISSION],
  intent: "action",
}

test("agent audit filesystem keeps a stable read-only file when storage is unavailable", async () => {
  const provider = createAgentAuditFileSystem()
  const file = await provider.stat(AGENT_AUDIT_FILE_REF, metadata)
  assert.equal(file?.kind, "file")
  assert.equal(file?.mediaType, AGENT_AUDIT_MEDIA_TYPE)
  assert.deepEqual(file?.capabilities, ["read", "watch"])
  assert.equal(file?.properties?.redacted, true)
})

test("agent audit filesystem fails closed for content and mutation without IndexedDB", async () => {
  const provider = createAgentAuditFileSystem()
  await assert.rejects(
    () => provider.read(AGENT_AUDIT_FILE_REF, content),
    (error) => error instanceof FileSystemError && error.code === "offline",
  )
  await assert.rejects(
    () => provider.write(AGENT_AUDIT_FILE_REF, { data: null }, content),
    (error) => error instanceof FileSystemError && error.code === "unsupported",
  )
})

test("agent audit filesystem exposes only validated append and completion actions", async () => {
  const provider = createAgentAuditFileSystem()
  assert.deepEqual(
    (await provider.actions(AGENT_AUDIT_FILE_REF, action)).map((item) => item.id),
    [AGENT_AUDIT_APPEND_ACTION, AGENT_AUDIT_COMPLETE_ACTION],
  )
  await assert.rejects(
    () =>
      provider.invoke(
        AGENT_AUDIT_FILE_REF,
        AGENT_AUDIT_APPEND_ACTION,
        { title: "missing allowlisted fields", argsText: "secret" },
        action,
      ),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  await assert.rejects(
    () =>
      provider.invoke(
        AGENT_AUDIT_FILE_REF,
        AGENT_AUDIT_COMPLETE_ACTION,
        { id: "audit-1", status: "rejected", summary: "invalid terminal state" },
        agentAction,
      ),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
})

test("agent audit runtime permission is explicit and fail closed", async () => {
  const provider = createAgentAuditFileSystem()
  await assert.rejects(
    () =>
      provider.actions(AGENT_AUDIT_FILE_REF, {
        actor: "agent",
        permissions: [],
        intent: "action",
      }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  assert.deepEqual(
    (await provider.actions(AGENT_AUDIT_FILE_REF, agentAction)).map((item) => item.id),
    [AGENT_AUDIT_APPEND_ACTION, AGENT_AUDIT_COMPLETE_ACTION],
  )
})
