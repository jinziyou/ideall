import { test } from "node:test"
import assert from "node:assert/strict"
import { listLocalDataSchemas } from "@/plugins/shared/local-data-schema"
import { parseInstallSnapshot } from "./persistence"

/**
 * 共享诊断层（plugins/shared 的 shell.runtime-extensions schema）与生产解析器
 * （persistence.parseInstallSnapshot）的判定 parity 锁定：两边必须同时接受或拒绝，
 * 防止健康视图对 loader 会整体丢弃的快照误报「结构正常」，以及修复写出 loader 仍拒绝的数据。
 */

function runtimeExtensionsSchema() {
  const schema = listLocalDataSchemas().find((item) => item.id === "shell.runtime-extensions")
  assert.ok(schema, "shell.runtime-extensions schema 未注册")
  assert.ok(schema.validate && schema.repair)
  return schema
}

const VALID_RECORD = {
  id: "example.ext",
  version: 1,
  digest: "d".repeat(16),
  permissionDigest: "p".repeat(16),
  consentReceipt: "c".repeat(16),
}

function snapshotOf(records: readonly unknown[], extras: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 2, records, ...extras })
}

const CASES: ReadonlyArray<readonly [string, string, boolean]> = [
  ["有效快照", snapshotOf([VALID_RECORD]), true],
  ["空 records", snapshotOf([]), true],
  ["consentReceipt 为空串", snapshotOf([{ ...VALID_RECORD, consentReceipt: "" }]), false],
  ["记录 id 重复", snapshotOf([VALID_RECORD, VALID_RECORD]), false],
  ["顶层多余键", snapshotOf([VALID_RECORD], { extra: 1 }), false],
  ["记录多余键", snapshotOf([{ ...VALID_RECORD, extra: 1 }]), false],
  ["id 含大写", snapshotOf([{ ...VALID_RECORD, id: "Example.Ext" }]), false],
  ["id 含空格", snapshotOf([{ ...VALID_RECORD, id: "bad id" }]), false],
  ["digest 超长", snapshotOf([{ ...VALID_RECORD, digest: "d".repeat(513) }]), false],
  ["digest 含控制字符", snapshotOf([{ ...VALID_RECORD, digest: "dd" }]), false],
  ["version 不是 2", snapshotOf([VALID_RECORD]).replace('"version":2', '"version":1'), false],
  ["records 不是数组", JSON.stringify({ version: 2, records: {} }), false],
  ["顶层不是对象", JSON.stringify([VALID_RECORD]), false],
  [
    "超出 64 条",
    snapshotOf(Array.from({ length: 65 }, (_, i) => ({ ...VALID_RECORD, id: `ext-${i}` }))),
    false,
  ],
  ["超出 64KB", snapshotOf([{ ...VALID_RECORD, digest: "d".repeat(70 * 1024) }]), false],
]

test("install snapshot parity: 共享校验与生产解析器同接受同拒绝", () => {
  const schema = runtimeExtensionsSchema()
  for (const [name, raw, expected] of CASES) {
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      value = raw
    }
    const issues = schema.validate!(value, raw)
    assert.equal(
      issues.length === 0,
      expected,
      `${name}：schema=${issues.length === 0 ? "接受" : `拒绝(${issues.join(";")})`}，期望 ${expected ? "接受" : "拒绝"}`,
    )
    assert.equal(
      parseInstallSnapshot(raw) !== null,
      expected,
      `${name}：生产解析器期望 ${expected ? "接受" : "拒绝"}`,
    )
  }
})

test("install snapshot parity: 修复写回的数据一定通过生产解析器", () => {
  const schema = runtimeExtensionsSchema()
  const rescuable = snapshotOf([
    VALID_RECORD,
    { ...VALID_RECORD, id: "broken id" },
    { ...VALID_RECORD, consentReceipt: "" },
    VALID_RECORD, // 重复 id：去重保留首个
  ])
  const value = JSON.parse(rescuable)
  assert.ok(schema.validate!(value, rescuable).length > 0, "前置应为 warning")
  const patch = schema.repair!(value, rescuable)
  assert.ok(patch)
  assert.equal(patch.action, "write")
  const written = JSON.stringify(patch.action === "write" ? patch.value : null)
  assert.ok(parseInstallSnapshot(written), "修复写回必须被生产解析器接受")
  const snapshot = parseInstallSnapshot(written)!
  assert.deepEqual(
    snapshot.records.map((record) => record.id),
    ["example.ext"],
  )

  // 完全无可救条目时移除而不是写出 loader 拒绝的数据。
  const hopeless = snapshotOf([{ id: "", version: 1 }])
  const hopelessPatch = schema.repair!(JSON.parse(hopeless), hopeless)
  assert.ok(hopelessPatch)
  assert.equal(hopelessPatch.action, "remove")
})
