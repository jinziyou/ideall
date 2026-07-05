import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeColumns, rowValuesForColumns, validateTableDraft } from "./database-store"

test("normalizeColumns: 支持中英文逗号/换行并按大小写去重", () => {
  assert.deepEqual(normalizeColumns(" name, Value，name\n VALUE ,, created_at "), [
    "name",
    "Value",
    "created_at",
  ])
})

test("validateTableDraft: trim 表名并拒绝空表名/空字段", () => {
  assert.deepEqual(validateTableDraft("  tasks  ", ["title"]), {
    name: "tasks",
    columns: ["title"],
  })
  assert.throws(() => validateTableDraft("  ", ["title"]), /需要表名/)
  assert.throws(() => validateTableDraft("tasks", []), /至少需要一个字段/)
})

test("rowValuesForColumns: 只按表字段出值并 trim 缺失字段", () => {
  assert.deepEqual(
    rowValuesForColumns(["name", "score", "note"], { name: " alpha ", score: " 42 " }),
    {
      name: "alpha",
      score: "42",
      note: "",
    },
  )
})
