import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileRef } from "@protocol/file-system"
import { FileSystemError } from "@/filesystem/types"
import type { FileSystemWatchEvent } from "@/filesystem/types"
import {
  DATABASE_ACTIONS,
  createDatabaseFileSystem,
  databaseRowRef,
  databaseRowsDirectoryRef,
  databaseTableRef,
  type DatabaseFileSystemDeps,
} from "./database-file-system"
import type { DataRow, DataTable } from "./database-store"

function table(id: string, updatedAt = 10): DataTable {
  return { id, name: id, columns: ["value"], createdAt: 1, updatedAt }
}

function databaseDeps(overrides: Partial<DatabaseFileSystemDeps> = {}): DatabaseFileSystemDeps {
  let deps: DatabaseFileSystemDeps
  deps = {
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
    async getRow(tableId, rowId) {
      return (await deps.listRows(tableId)).find((row) => row.id === rowId)
    },
    async getTable(id) {
      return (await deps.listTables()).find((item) => item.id === id)
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
  return deps
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

test("database filesystem: every row has a stable FileRef under a rows directory while tables remain engine files", async () => {
  const current = table("table:a")
  let rows: DataRow[] = [
    {
      id: "row/1",
      tableId: current.id,
      values: { value: "first" },
      createdAt: 2,
      updatedAt: 12,
    },
    {
      id: "row:2",
      tableId: current.id,
      values: { value: "second" },
      createdAt: 3,
      updatedAt: 13,
    },
  ]
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async listTables() {
        return [current]
      },
      async listRows() {
        return rows
      },
      async updateRow(id, tableId, values) {
        const previous = rows.find((row) => row.id === id) as DataRow
        const updated = { ...previous, tableId, values, updatedAt: previous.updatedAt + 1 }
        rows = rows.map((row) => (row.id === id ? updated : row))
        return updated
      },
    }),
  )
  const metadataCtx = { actor: "ui", permissions: [], intent: "metadata" } as const
  const directoryCtx = { actor: "ui", permissions: [], intent: "directory" } as const
  const contentCtx = { actor: "ui", permissions: [], intent: "content" } as const
  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const

  const tableRef = databaseTableRef(current.id)
  const tableFile = await fs.stat(tableRef, metadataCtx)
  assert.equal(tableFile?.kind, "file", "database engine continues to match/open table files")
  assert.equal(tableFile?.mediaType, "application/vnd.ideall.database+json")

  const rowsRef = databaseRowsDirectoryRef(current.id)
  assert.equal((await fs.stat(rowsRef, metadataCtx))?.kind, "directory")
  const first = await fs.readDirectory(rowsRef, directoryCtx)
  assert.deepEqual(
    first.entries.map((entry) => entry.target),
    rows.map((row) => databaseRowRef(current.id, row.id)),
  )
  const firstIdentity = Object.fromEntries(
    first.entries.map((entry) => [entry.properties?.rowId, entry.target.fileId]),
  )
  assert.deepEqual(first.entries[0].file?.ref, first.entries[0].target)
  assert.equal(
    first.entries[0].file?.properties?.values,
    undefined,
    "directory metadata snapshots cannot leak row content",
  )

  const rowRef = databaseRowRef(current.id, "row/1")
  const rowFile = await fs.stat(rowRef, metadataCtx)
  assert.equal(rowFile?.kind, "file")
  assert.equal(rowFile?.name, "行 row/1")
  assert.equal(rowFile?.properties?.values, undefined, "row metadata cannot leak cell content")
  assert.deepEqual((await fs.read(rowRef, contentCtx)).data, rows[0])

  rows = [...rows].reverse()
  const second = await fs.readDirectory(rowsRef, directoryCtx)
  assert.deepEqual(
    Object.fromEntries(
      second.entries.map((entry) => [entry.properties?.rowId, entry.target.fileId]),
    ),
    firstIdentity,
    "row FileRef does not depend on display order or values",
  )

  const updated = await fs.invoke(
    rowRef,
    DATABASE_ACTIONS.updateRow,
    { values: { value: "changed" } },
    actionCtx,
  )
  assert.deepEqual((updated as { ref: FileRef }).ref, rowRef)
  assert.equal(rows.find((row) => row.id === "row/1")?.values.value, "changed")
})

test("database filesystem: rows directory paginates with stable cursors and metadata snapshots", async () => {
  const current = table("paged")
  const rows: DataRow[] = Array.from({ length: 5 }, (_, index) => ({
    id: `row-${index}`,
    tableId: current.id,
    values: { value: String(index) },
    createdAt: 10 - index,
    updatedAt: 20 + index,
  }))
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async listTables() {
        return [current]
      },
      async listRows() {
        return rows
      },
    }),
  )
  const ref = databaseRowsDirectoryRef(current.id)
  const ctx = { actor: "ui", permissions: [], intent: "directory" } as const

  const first = await fs.readDirectory(ref, ctx, { limit: 2 })
  assert.deepEqual(
    first.entries.map((entry) => entry.file?.properties?.rowId),
    ["row-0", "row-1"],
  )
  assert.equal(first.nextCursor, "2")

  const second = await fs.readDirectory(ref, ctx, { cursor: first.nextCursor, limit: 2 })
  assert.deepEqual(
    second.entries.map((entry) => entry.file?.properties?.rowId),
    ["row-2", "row-3"],
  )
  assert.deepEqual(
    second.entries.map((entry) => entry.sortKey),
    ["000002", "000003"],
  )
  assert.equal(second.nextCursor, "4")

  const last = await fs.readDirectory(ref, ctx, { cursor: second.nextCursor, limit: 2 })
  assert.deepEqual(
    last.entries.map((entry) => entry.file?.properties?.rowId),
    ["row-4"],
  )
  assert.equal(last.nextCursor, undefined)

  await assert.rejects(
    fs.readDirectory(ref, ctx, { cursor: "01", limit: 2 }),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  await assert.rejects(
    fs.readDirectory(ref, ctx, { limit: 0 }),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
})

test("database filesystem: single-row stat uses direct key lookups instead of full scans", async () => {
  const current = table("direct")
  const row: DataRow = {
    id: "only-row",
    tableId: current.id,
    values: { value: "private" },
    createdAt: 1,
    updatedAt: 2,
  }
  let getTableCalls = 0
  let getRowCalls = 0
  let listTablesCalls = 0
  let listRowsCalls = 0
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async getTable(id) {
        getTableCalls += 1
        return id === current.id ? current : undefined
      },
      async getRow(tableId, rowId) {
        getRowCalls += 1
        return tableId === current.id && rowId === row.id ? row : undefined
      },
      async listTables() {
        listTablesCalls += 1
        return [current]
      },
      async listRows() {
        listRowsCalls += 1
        return [row]
      },
    }),
  )

  const result = await fs.stat(databaseRowRef(current.id, row.id), {
    actor: "ui",
    permissions: [],
    intent: "metadata",
  })
  assert.equal(result?.properties?.rowId, row.id)
  assert.equal(getTableCalls, 1)
  assert.equal(getRowCalls, 1)
  assert.equal(listTablesCalls, 0)
  assert.equal(listRowsCalls, 0)
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

test("database filesystem: deleting a table invalidates every open row FileRef", async () => {
  let tables = [table("watched")]
  let rows: DataRow[] = [
    {
      id: "row-1",
      tableId: "watched",
      values: { value: "open" },
      createdAt: 1,
      updatedAt: 1,
    },
  ]
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async deleteTable(id) {
        tables = tables.filter((item) => item.id !== id)
        rows = rows.filter((row) => row.tableId !== id)
      },
      async listRows(id) {
        return rows.filter((row) => row.tableId === id)
      },
      async listTables() {
        return tables
      },
    }),
  )
  const rowRef = databaseRowRef("watched", "row-1")
  const events: string[] = []
  const handle = fs.watch?.(rowRef, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    events.push(event.type),
  )

  await fs.invoke(databaseTableRef("watched"), DATABASE_ACTIONS.deleteTable, undefined, {
    actor: "ui",
    permissions: [],
    intent: "action",
  })

  assert.deepEqual(events, ["deleted"])
  assert.equal(await fs.stat(rowRef, { actor: "ui", permissions: [], intent: "metadata" }), null)
  handle?.dispose()
})

test("database filesystem: row mutations publish incremental link identity to row and root directories", async () => {
  const current = table("incremental")
  let rows: DataRow[] = []
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async addRow(tableId, values) {
        const row = { id: "new-row", tableId, values, createdAt: 1, updatedAt: 1 }
        rows.push(row)
        return row
      },
      async listTables() {
        return [current]
      },
      async listRows() {
        return rows
      },
      async updateRow(id, tableId, values) {
        const previous = rows.find((row) => row.id === id) as DataRow
        const updated = { ...previous, tableId, values, updatedAt: previous.updatedAt + 1 }
        rows = rows.map((row) => (row.id === id ? updated : row))
        return updated
      },
    }),
  )
  const rowsRef = databaseRowsDirectoryRef(current.id)
  const rootEvents: FileSystemWatchEvent[] = []
  const rowsEvents: FileSystemWatchEvent[] = []
  const rootWatch = fs.watch?.(
    fs.descriptor.root,
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => rootEvents.push(event),
  )
  const rowsWatch = fs.watch?.(
    rowsRef,
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => rowsEvents.push(event),
  )

  await fs.invoke(
    rowsRef,
    DATABASE_ACTIONS.addRow,
    { values: { value: "created" } },
    { actor: "ui", permissions: [], intent: "action" },
  )

  assert.equal(rootEvents.length, 1)
  assert.equal(rootEvents[0]?.ref.fileId, databaseTableRef(current.id).fileId)
  assert.equal(rootEvents[0]?.entryId, "table:incremental")
  assert.equal(rowsEvents.length, 1)
  const created = rowsEvents[0]
  assert.equal(created?.ref.fileId, databaseRowRef(current.id, "new-row").fileId)
  assert.equal(created?.entryId, "new-row")
  assert.equal(created?.newParent?.fileId, rowsRef.fileId)
  assert.equal(created?.version, "1")

  const rowRef = databaseRowRef(current.id, "new-row")
  await fs.invoke(
    rowRef,
    DATABASE_ACTIONS.updateRow,
    { values: { value: "updated" } },
    { actor: "ui", permissions: [], intent: "action" },
  )
  assert.equal(rowsEvents.length, 2)
  const changed = rowsEvents[1]
  assert.equal(changed?.type, "changed")
  assert.equal(changed?.ref.fileId, rowRef.fileId)
  assert.equal(changed?.entryId, "new-row")
  assert.equal(changed?.newParent?.fileId, rowsRef.fileId)
  assert.equal(changed?.version, "2")
  assert.equal(changed?.changes, undefined, "row updates must not be wrapped with directory self")
  rootWatch?.dispose()
  rowsWatch?.dispose()
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
  assert.deepEqual(rootActions[1], {
    id: "create-table",
    label: "新建表",
    kind: "invoke",
    idempotent: false,
    requires: ["create"],
    input: {
      type: "object",
      properties: {
        name: { type: "string", title: "表名", minLength: 1 },
        columns: {
          type: "string",
          title: "字段",
          description: "使用逗号或换行分隔字段。",
          format: "multiline",
          minLength: 1,
        },
      },
      required: ["name", "columns"],
      additionalProperties: false,
    },
  })

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
