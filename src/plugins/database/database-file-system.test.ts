import assert from "node:assert/strict"
import { test } from "node:test"
import { FileSystemError } from "@/filesystem/types"
import {
  DATABASE_ACTIONS,
  createDatabaseFileSystem,
  type DatabaseFileSystemDeps,
} from "./database-file-system"
import type { DataRow, DataTable } from "./database-store"

function table(id: string, updatedAt = 10): DataTable {
  return { id, name: id, columns: ["value"], createdAt: 1, updatedAt }
}

function databaseDeps(overrides: Partial<DatabaseFileSystemDeps> = {}): DatabaseFileSystemDeps {
  return {
    async addRow(tableId, values) {
      return { id: "new-row", tableId, values, createdAt: 1, updatedAt: 1 }
    },
    async createTable(name, columns) {
      return { id: "new-table", name, columns, createdAt: 1, updatedAt: 1 }
    },
    async deleteRow() {},
    async deleteTable() {},
    async exportDatabaseJson() {
      return "exported"
    },
    async importDatabaseJson() {
      return { tables: 0, rows: 0 }
    },
    async listRows() {
      return []
    },
    async listTables() {
      return []
    },
    normalizeColumns(input) {
      return input
        .split(/[,\n]/)
        .map((column) => column.trim())
        .filter(Boolean)
    },
    rowValuesForColumns(columns, draft) {
      return Object.fromEntries(columns.map((column) => [column, draft[column]?.trim() ?? ""]))
    },
    async updateRow(id, tableId, values) {
      return { id, tableId, values, createdAt: 1, updatedAt: 2 }
    },
    ...overrides,
  }
}

test("database filesystem: table entries stay stable and JSON ranges are readable", async () => {
  let tables = [table("a"), table("b")]
  const rows: DataRow[] = [
    { id: "r1", tableId: "a", values: { value: "x" }, createdAt: 2, updatedAt: 12 },
  ]
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async deleteTable() {},
      async listRows(id) {
        return id === "a" ? rows : []
      },
      async listTables() {
        return tables
      },
    }),
  )
  const directoryCtx = { actor: "ui", permissions: [], intent: "directory" } as const
  const first = await fs.readDirectory(fs.descriptor.root, directoryCtx)
  assert.deepEqual(first.entries[0].properties?.columns, ["value"])
  tables = [...tables].reverse()
  const second = await fs.readDirectory(fs.descriptor.root, directoryCtx)
  const ids = (page: typeof first) =>
    Object.fromEntries(page.entries.map((entry) => [entry.target.fileId, entry.entryId]))
  assert.deepEqual(ids(second), ids(first))

  const ref = first.entries[0].target
  const full = JSON.stringify({ table: tables.find((item) => item.id === "a"), rows })
  const result = await fs.read(
    ref,
    { actor: "engine", permissions: [], activeFile: ref, intent: "content" },
    { encoding: "text", range: { start: 1, end: 9 } },
  )
  assert.equal(result.data, full.slice(1, 9))
  assert.equal(result.size, 8)
  assert.equal(result.version, "12")
})

test("database filesystem: stat returns null for a missing table while reads stay strict", async () => {
  const fs = createDatabaseFileSystem(databaseDeps())
  const missing = { fileSystemId: fs.descriptor.fileSystemId, fileId: "table:missing" }

  assert.equal(await fs.stat(missing, { actor: "ui", permissions: [], intent: "metadata" }), null)
  await assert.rejects(
    fs.read(missing, { actor: "ui", permissions: [], intent: "content" }),
    (error) => error instanceof FileSystemError && error.code === "not-found",
  )
  await assert.rejects(
    fs.actions(missing, { actor: "ui", permissions: [], intent: "action" }),
    (error) => error instanceof FileSystemError && error.code === "not-found",
  )
})

test("database filesystem: operations enforce intent and mutation permission", async () => {
  const current = table("a")
  let deleted = false
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async deleteTable() {
        deleted = true
      },
      async listRows() {
        return []
      },
      async listTables() {
        return [current]
      },
    }),
  )
  const ref = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target

  await assert.rejects(
    fs.invoke(ref, "delete", null, {
      actor: "system",
      permissions: [],
      intent: "action",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  await assert.rejects(
    fs.invoke(ref, "delete", null, {
      actor: "system",
      permissions: ["fs:write"],
      intent: "content",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  assert.equal(deleted, false)
  await fs.invoke(ref, "delete", null, {
    actor: "system",
    permissions: ["fs:write"],
    intent: "action",
  })
  assert.equal(deleted, true)

  await assert.rejects(
    fs.write(ref, { data: {} }, { actor: "system", permissions: [], intent: "write" }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  await assert.rejects(
    fs.write(ref, { data: {} }, { actor: "system", permissions: ["fs:write"], intent: "write" }),
    (error) => error instanceof FileSystemError && error.code === "unsupported",
  )
  assert.equal(fs.descriptor.capabilities?.includes("watch"), true)
})

test("database filesystem: root and table actions own every store mutation", async () => {
  const tables = [table("a"), table("b")]
  const rows = new Map<string, DataRow[]>([
    ["a", [{ id: "a-row", tableId: "a", values: { value: "old" }, createdAt: 1, updatedAt: 1 }]],
    ["b", [{ id: "b-row", tableId: "b", values: { value: "other" }, createdAt: 1, updatedAt: 1 }]],
  ])
  let imported = ""
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async addRow(tableId, values) {
        const row = { id: "added", tableId, values, createdAt: 2, updatedAt: 2 }
        rows.get(tableId)?.push(row)
        return row
      },
      async createTable(name, columns) {
        const created = { id: "created", name, columns, createdAt: 2, updatedAt: 2 }
        tables.push(created)
        rows.set(created.id, [])
        return created
      },
      async deleteRow(id) {
        for (const [tableId, current] of rows) {
          rows.set(
            tableId,
            current.filter((row) => row.id !== id),
          )
        }
      },
      async exportDatabaseJson() {
        return "all-tables"
      },
      async importDatabaseJson(content) {
        imported = content
        return { tables: 2, rows: 3 }
      },
      async listRows(tableId) {
        return rows.get(tableId) ?? []
      },
      async listTables() {
        return tables
      },
      async updateRow(id, tableId, values) {
        const current = rows.get(tableId) ?? []
        const updated = { id, tableId, values, createdAt: 1, updatedAt: 3 }
        rows.set(
          tableId,
          current.map((row) => (row.id === id ? updated : row)),
        )
        return updated
      },
    }),
  )
  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const
  const rootEvents: string[] = []
  const rootWatch = fs.watch?.(
    fs.descriptor.root,
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => rootEvents.push(event.type),
  )
  assert.ok(rootWatch)
  const rootActions = await fs.actions(fs.descriptor.root, actionCtx)
  assert.deepEqual(
    rootActions.map((action) => action.id),
    ["open", "create-table", "import", "export"],
  )

  const created = await fs.invoke(
    fs.descriptor.root,
    DATABASE_ACTIONS.createTable,
    { name: "Tasks", columns: "title, done" },
    actionCtx,
  )
  assert.equal((created as { table: DataTable }).table.id, "created")
  assert.deepEqual(tables.at(-1)?.columns, ["title", "done"])
  assert.equal(
    await fs.invoke(fs.descriptor.root, DATABASE_ACTIONS.export, undefined, actionCtx),
    "all-tables",
  )
  assert.deepEqual(
    await fs.invoke(fs.descriptor.root, DATABASE_ACTIONS.import, { content: "backup" }, actionCtx),
    { tables: 2, rows: 3 },
  )
  assert.equal(imported, "backup")

  const aRef = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries.find((entry) => entry.name === "a")?.target
  assert.ok(aRef)
  const tableEvents: string[] = []
  const tableWatch = fs.watch?.(aRef, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    tableEvents.push(event.type),
  )
  assert.ok(tableWatch)
  await fs.invoke(aRef, DATABASE_ACTIONS.addRow, { values: { value: " new " } }, actionCtx)
  assert.equal(rows.get("a")?.at(-1)?.values.value, "new")
  await fs.invoke(
    aRef,
    DATABASE_ACTIONS.updateRow,
    { id: "a-row", values: { value: "changed" } },
    actionCtx,
  )
  assert.equal(rows.get("a")?.find((row) => row.id === "a-row")?.values.value, "changed")
  await assert.rejects(
    fs.invoke(aRef, DATABASE_ACTIONS.deleteRow, { id: "b-row" }, actionCtx),
    (error) => error instanceof FileSystemError && error.code === "not-found",
  )
  await fs.invoke(aRef, DATABASE_ACTIONS.deleteRow, { id: "a-row" }, actionCtx)
  assert.equal(
    rows.get("a")?.some((row) => row.id === "a-row"),
    false,
  )
  assert.match(
    String(await fs.invoke(aRef, DATABASE_ACTIONS.export, undefined, actionCtx)),
    /"table"/,
  )
  assert.deepEqual(tableEvents, ["changed", "changed", "changed"])
  assert.deepEqual(rootEvents, ["changed", "changed", "changed", "changed", "changed"])
  tableWatch.dispose()
  rootWatch.dispose()
})
