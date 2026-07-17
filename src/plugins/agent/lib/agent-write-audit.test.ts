import assert from "node:assert/strict"
import { test } from "node:test"
import {
  completeAgentWriteAuditRecord,
  decodeAgentWriteAuditCompletion,
  decodeAgentWriteAuditInput,
  isAgentWriteAuditRecord,
  type AgentWriteAuditRecord,
} from "./agent-write-audit"

test("agent write audit guard accepts the bounded public record shape", () => {
  assert.equal(
    isAgentWriteAuditRecord({
      id: "audit-1",
      version: 1,
      source: "tool",
      operation: "fs.write",
      title: "修改笔记",
      summary: "已执行",
      status: "committed",
      effect: "write",
      risk: "medium",
      target: { kind: "note", id: "note-1", label: "note-1" },
      createdAt: 1,
      updatedAt: 1,
    }),
    true,
  )
})

test("agent write audit guard rejects raw argument extensions", () => {
  assert.equal(
    isAgentWriteAuditRecord({
      id: "audit-1",
      version: 1,
      source: "tool",
      operation: "browser.fill",
      title: "填写表单",
      summary: "已执行",
      status: "committed",
      effect: "external",
      risk: "high",
      argsText: '{"password":"secret"}',
      createdAt: 1,
      updatedAt: 1,
    }),
    false,
  )
})

test("agent write audit action input rejects raw arguments before storage", () => {
  assert.throws(
    () =>
      decodeAgentWriteAuditInput({
        source: "tool",
        operation: "browser.fill",
        title: "填写表单",
        summary: "已执行",
        status: "committed",
        effect: "external",
        risk: "high",
        argsText: '{"password":"secret"}',
      }),
    /Invalid Agent audit input/,
  )
})

test("agent write audit accepts only tool records in pending state", () => {
  const base = {
    id: "audit-pending",
    version: 1,
    operation: "fs.write",
    title: "修改笔记",
    summary: "已批准，等待执行",
    status: "pending",
    effect: "write",
    risk: "medium",
    createdAt: 1,
    updatedAt: 1,
  }
  assert.equal(isAgentWriteAuditRecord({ ...base, source: "tool" }), true)
  assert.equal(isAgentWriteAuditRecord({ ...base, source: "artifact" }), false)
  assert.throws(
    () =>
      decodeAgentWriteAuditInput({
        source: "artifact",
        operation: "artifact.note.create",
        title: "保存笔记",
        summary: "等待执行",
        status: "pending",
        effect: "write",
        risk: "medium",
      }),
    /Invalid Agent audit input/,
  )
})

test("agent write audit pending intent settles once without exposing raw data", () => {
  const current: AgentWriteAuditRecord = {
    id: "audit-1",
    version: 1,
    source: "tool",
    operation: "fs.write",
    title: "修改笔记",
    summary: "已批准，等待执行",
    status: "pending",
    effect: "write",
    risk: "medium",
    createdAt: 1,
    updatedAt: 1,
  }
  const completion = decodeAgentWriteAuditCompletion({
    id: current.id,
    status: "committed",
    summary: "已执行\u0000并提交",
  })
  const completed = completeAgentWriteAuditRecord(current, completion, 2)
  assert.equal(completed.status, "committed")
  assert.equal(completed.summary, "已执行 并提交")
  assert.equal(completed.updatedAt, 2)
  assert.throws(() => completeAgentWriteAuditRecord(completed, completion, 3), /already finalized/)
  assert.throws(
    () => completeAgentWriteAuditRecord(current, { ...completion, id: "audit-other" }, 3),
    /id mismatch/,
  )
  assert.throws(
    () =>
      decodeAgentWriteAuditCompletion({
        id: current.id,
        status: "failed",
        summary: "失败",
        argsText: "secret",
      }),
    /Invalid Agent audit completion/,
  )
})
