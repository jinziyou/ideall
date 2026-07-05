import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DATABASE_EXPORT_KIND,
  DATABASE_EXPORT_VERSION,
  createDatabaseExport,
  normalizeColumns,
  parseDatabaseExport,
  rowValuesForColumns,
  validateTableDraft,
} from "./database-store"

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

test("parseDatabaseExport: 校验版本并按表归属规范化行", () => {
  const raw = JSON.stringify({
    kind: DATABASE_EXPORT_KIND,
    version: DATABASE_EXPORT_VERSION,
    exportedAt: "2026-01-01T00:00:00.000Z",
    tables: [
      {
        table: {
          id: "t1",
          name: " Tasks ",
          columns: ["name", "done"],
          createdAt: 1,
          updatedAt: 2,
        },
        rows: [
          {
            id: "r1",
            tableId: "wrong",
            values: { name: "ship", done: "yes", ignored: 123 },
            createdAt: 3,
            updatedAt: 4,
          },
        ],
      },
    ],
  })

  assert.deepEqual(parseDatabaseExport(raw), {
    kind: DATABASE_EXPORT_KIND,
    version: DATABASE_EXPORT_VERSION,
    exportedAt: "2026-01-01T00:00:00.000Z",
    tables: [
      {
        table: { id: "t1", name: "Tasks", columns: ["name", "done"], createdAt: 1, updatedAt: 2 },
        rows: [
          {
            id: "r1",
            tableId: "t1",
            values: { name: "ship", done: "yes" },
            createdAt: 3,
            updatedAt: 4,
          },
        ],
      },
    ],
  })
  assert.throws(() => parseDatabaseExport(JSON.stringify({ kind: "bad", version: 1 })), /不支持/)
})

test("createDatabaseExport: 固定导出封套", () => {
  assert.deepEqual(createDatabaseExport([], "now"), {
    kind: DATABASE_EXPORT_KIND,
    version: DATABASE_EXPORT_VERSION,
    exportedAt: "now",
    tables: [],
  })
})
