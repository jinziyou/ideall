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
  databaseTableSnapshotVersion,
  databaseTableRef,
  type DatabaseFileSystemDeps,
} from "./database-file-system"
import type { DataRow, DataTable } from "./database-store"

function table(id: string, updatedAt = 10): DataTable {
  return { id, name: id, columns: ["value"], createdAt: 1, updatedAt }
}

test("database snapshot version covers complete table and row content", async () => {
  const current = table("versioned", 10)
  const rows: DataRow[] = [
    {
      id: "high",
      tableId: current.id,
      values: { z: "last", a: "first" },
      createdAt: 2,
      updatedAt: 100,
    },
    {
      id: "low",
      tableId: current.id,
      values: { value: "before" },
      createdAt: 3,
      updatedAt: 20,
    },
  ]
  const initial = await databaseTableSnapshotVersion(current, rows)
  assert.match(initial, /^database-v3:[0-9a-f]{64}$/)

  assert.notEqual(
    await databaseTableSnapshotVersion(current, [rows[0], { ...rows[1], updatedAt: 21 }]),
    initial,
    "updating a non-maximum row must still advance the collection token",
  )
  assert.notEqual(await databaseTableSnapshotVersion(current, [rows[0]]), initial)
  assert.equal(await databaseTableSnapshotVersion(current, [...rows].reverse()), initial)
  assert.equal(
    await databaseTableSnapshotVersion(current, [
      { ...rows[0], values: { a: "first", z: "last" } },
      rows[1],
    ]),
    initial,
    "row value key insertion order must not affect the token",
  )
  assert.notEqual(
    await databaseTableSnapshotVersion(current, [
      rows[0],
      { ...rows[1], values: { value: "changed-with-the-same-timestamp" } },
    ]),
    initial,
    "row content changes must invalidate the token even when updatedAt is unchanged",
  )
  assert.notEqual(
    await databaseTableSnapshotVersion(
      { ...current, name: "renamed-with-the-same-timestamp" },
      rows,
    ),
    initial,
    "table content changes must invalidate the token even when updatedAt is unchanged",
  )
  assert.notEqual(
    await databaseTableSnapshotVersion({ ...current, columns: ["value", "added"] }, rows),
    initial,
    "table column changes must invalidate the token even when updatedAt is unchanged",
  )
})

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
  const expectedVersion = await databaseTableSnapshotVersion(tables[1], rows)
  assert.equal(result.version, expectedVersion)
  const rowsRef = databaseRowsDirectoryRef("a")
  const [tableStat, rowsStat, rowsRead] = await Promise.all([
    fs.stat(ref, { actor: "ui", permissions: [], intent: "metadata" }),
    fs.stat(rowsRef, { actor: "ui", permissions: [], intent: "metadata" }),
    fs.read(rowsRef, { actor: "ui", permissions: [], intent: "content" }),
  ])
  assert.equal(
    first.entries.find((entry) => entry.target.fileId === ref.fileId)?.file?.version,
    expectedVersion,
  )
  assert.equal(
    first.entries.find((entry) => entry.target.fileId === rowsRef.fileId)?.file?.version,
    expectedVersion,
  )
  assert.equal(tableStat?.version, expectedVersion)
  assert.equal(rowsStat?.version, expectedVersion)
  assert.equal(rowsRead.version, expectedVersion)
})

test("database filesystem: root pagination loads only page tables and preserves pair offsets", async () => {
  const tables = [table("a", 30), table("b", 20), table("c", 10)]
  const rowsByTable = new Map<string, DataRow[]>(
    tables.map((current, index) => [
      current.id,
      [
        {
          id: `row-${current.id}`,
          tableId: current.id,
          values: { value: current.id },
          createdAt: index + 1,
          updatedAt: index + 11,
        },
      ],
    ]),
  )
  const rowReads = new Map<string, number>()
  let tableReads = 0
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async listRows(tableId) {
        rowReads.set(tableId, (rowReads.get(tableId) ?? 0) + 1)
        return rowsByTable.get(tableId) ?? []
      },
      async listTables() {
        tableReads += 1
        return tables
      },
    }),
  )
  const ctx = { actor: "ui", permissions: [], intent: "directory" } as const

  const pair = await fs.readDirectory(fs.descriptor.root, ctx, { cursor: "2", limit: 2 })
  assert.deepEqual(
    pair.entries.map((entry) => entry.entryId),
    ["table:b", "rows:b"],
  )
  assert.deepEqual(
    pair.entries.map((entry) => entry.sortKey),
    ["000002", "000003"],
  )
  assert.equal(pair.nextCursor, "4")
  assert.deepEqual(Object.fromEntries(rowReads), { b: 1 }, "page-external tables stay unloaded")
  const expectedB = await databaseTableSnapshotVersion(tables[1], rowsByTable.get("b") ?? [])
  assert.deepEqual(
    pair.entries.map((entry) => entry.file?.version),
    [expectedB, expectedB],
    "one table/rows pair reuses one semantic snapshot",
  )

  rowReads.clear()
  const crossPair = await fs.readDirectory(fs.descriptor.root, ctx, { cursor: "1", limit: 2 })
  assert.deepEqual(
    crossPair.entries.map((entry) => entry.entryId),
    ["rows:a", "table:b"],
  )
  assert.deepEqual(
    crossPair.entries.map((entry) => entry.sortKey),
    ["000001", "000002"],
  )
  assert.equal(crossPair.nextCursor, "3")
  assert.deepEqual(Object.fromEntries(rowReads), { a: 1, b: 1 })

  rowReads.clear()
  const full = await fs.readDirectory(fs.descriptor.root, ctx)
  assert.deepEqual(
    full.entries.map((entry) => entry.entryId),
    ["table:a", "rows:a", "table:b", "rows:b", "table:c", "rows:c"],
  )
  assert.equal(full.nextCursor, undefined)
  assert.deepEqual(Object.fromEntries(rowReads), { a: 1, b: 1, c: 1 })

  rowReads.clear()
  tableReads = 0
  await assert.rejects(
    fs.readDirectory(fs.descriptor.root, ctx, { cursor: "01", limit: 2 }),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  await assert.rejects(
    fs.readDirectory(fs.descriptor.root, ctx, { limit: 0 }),
    (error) => error instanceof FileSystemError && error.code === "invalid-input",
  )
  assert.equal(tableReads, 0, "invalid pagination fails before table reads")
  assert.deepEqual(Object.fromEntries(rowReads), {}, "invalid pagination fails before row reads")

  const beyond = await fs.readDirectory(fs.descriptor.root, ctx, { cursor: "99", limit: 2 })
  assert.deepEqual(beyond, { entries: [], nextCursor: undefined })
  assert.equal(tableReads, 1, "a valid cursor still reads the collection size")
  assert.deepEqual(Object.fromEntries(rowReads), {}, "an empty page does not read any rows")
})

test("database filesystem: root snapshots use bounded ordered concurrency", async () => {
  const tables = Array.from({ length: 9 }, (_, index) => table(`bounded-${index}`, 20 - index))
  let active = 0
  let maximumActive = 0
  let started = 0
  let releaseRows!: () => void
  const rowsMayFinish = new Promise<void>((resolve) => {
    releaseRows = resolve
  })
  let markFirstStarted!: () => void
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve
  })
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async listRows() {
        started += 1
        active += 1
        maximumActive = Math.max(maximumActive, active)
        if (started === 1) markFirstStarted()
        await rowsMayFinish
        active -= 1
        return []
      },
      async listTables() {
        return tables
      },
    }),
  )

  const pending = fs.readDirectory(
    fs.descriptor.root,
    { actor: "ui", permissions: [], intent: "directory" },
    { limit: tables.length * 2 },
  )
  await firstStarted
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(started, 4, "only one bounded worker wave may start while row reads are blocked")
  assert.equal(active, 4)
  releaseRows()

  const page = await pending
  assert.equal(maximumActive, 4)
  assert.equal(started, tables.length)
  assert.equal(page.entries.length, tables.length * 2)
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

test("database filesystem: entity invoke mutations enforce fresh expectedVersion", async () => {
  let tables = [table("guarded", 10), table("table-actions", 30)]
  let rows: DataRow[] = [
    {
      id: "row-guarded",
      tableId: "guarded",
      values: { value: "before" },
      createdAt: 1,
      updatedAt: 20,
    },
    {
      id: "row-from-table",
      tableId: "table-actions",
      values: { value: "before" },
      createdAt: 1,
      updatedAt: 40,
    },
  ]
  let rowUpdates = 0
  let rowDeletes = 0
  let tableDeletes = 0
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async deleteRow(id) {
        rowDeletes += 1
        rows = rows.filter((row) => row.id !== id)
      },
      async deleteTable(id) {
        tableDeletes += 1
        tables = tables.filter((item) => item.id !== id)
        rows = rows.filter((row) => row.tableId !== id)
      },
      async listRows(tableId) {
        return rows.filter((row) => row.tableId === tableId)
      },
      async listTables() {
        return tables
      },
      async updateRow(id, tableId, values) {
        rowUpdates += 1
        const previous = rows.find((row) => row.id === id) as DataRow
        const updated = { ...previous, tableId, values, updatedAt: previous.updatedAt + 1 }
        rows = rows.map((row) => (row.id === id ? updated : row))
        return updated
      },
    }),
  )
  const ctx = { actor: "ui", permissions: [], intent: "action" } as const
  const rowRef = databaseRowRef("guarded", "row-guarded")
  const tableRef = databaseTableRef("table-actions")
  const tableAction = () => tables.find((item) => item.id === "table-actions") as DataTable
  const tableActionRows = () => rows.filter((row) => row.tableId === "table-actions")
  const initialTableActionVersion = await databaseTableSnapshotVersion(
    tableAction(),
    tableActionRows(),
  )
  const isConflict = (error: unknown) =>
    error instanceof FileSystemError && error.code === "conflict"

  await assert.rejects(
    fs.invoke(rowRef, DATABASE_ACTIONS.updateRow, { values: { value: "stale" } }, ctx, {
      expectedVersion: "19",
    }),
    isConflict,
  )
  await assert.rejects(
    fs.invoke(rowRef, DATABASE_ACTIONS.deleteRow, undefined, ctx, { expectedVersion: null }),
    isConflict,
  )
  assert.equal(rowUpdates, 0)
  assert.equal(rowDeletes, 0)

  await fs.invoke(rowRef, DATABASE_ACTIONS.updateRow, { values: { value: "committed" } }, ctx, {
    expectedVersion: "20",
  })
  assert.equal(rowUpdates, 1)

  await assert.rejects(
    fs.invoke(
      tableRef,
      DATABASE_ACTIONS.updateRow,
      { id: "row-from-table", values: { value: "stale" } },
      ctx,
      { expectedVersion: "stale" },
    ),
    isConflict,
  )
  assert.equal(rowUpdates, 1)
  await fs.invoke(
    tableRef,
    DATABASE_ACTIONS.updateRow,
    { id: "row-from-table", values: { value: "committed" } },
    ctx,
    { expectedVersion: initialTableActionVersion },
  )
  assert.equal(rowUpdates, 2)

  await assert.rejects(
    fs.invoke(tableRef, DATABASE_ACTIONS.deleteTable, undefined, ctx, {
      expectedVersion: null,
    }),
    isConflict,
  )
  assert.equal(tableDeletes, 0)
  await fs.invoke(tableRef, DATABASE_ACTIONS.deleteTable, undefined, ctx, {
    expectedVersion: await databaseTableSnapshotVersion(tableAction(), tableActionRows()),
  })
  assert.equal(tableDeletes, 1)

  // 缺省 expectedVersion 保留兼容语义，不施加前置条件。
  await fs.invoke(rowRef, DATABASE_ACTIONS.deleteRow, undefined, ctx)
  assert.equal(rowDeletes, 1)
})

test("database filesystem: concurrent row invokes serialize version checks with mutations", async () => {
  const currentTable = table("concurrent", 10)
  let rows: DataRow[] = [
    {
      id: "shared-row",
      tableId: currentTable.id,
      values: { value: "before" },
      createdAt: 1,
      updatedAt: 20,
    },
  ]
  let releaseFirst!: () => void
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let markFirstStarted!: () => void
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve
  })
  let updateRuns = 0
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async listRows(tableId) {
        return rows.filter((row) => row.tableId === tableId)
      },
      async listTables() {
        return [currentTable]
      },
      async updateRow(id, tableId, values) {
        updateRuns += 1
        if (updateRuns === 1) {
          markFirstStarted()
          await firstMayFinish
        }
        const previous = rows.find((row) => row.id === id) as DataRow
        const updated = { ...previous, tableId, values, updatedAt: previous.updatedAt + 1 }
        rows = rows.map((row) => (row.id === id ? updated : row))
        return updated
      },
    }),
  )
  const ref = databaseRowRef(currentTable.id, "shared-row")
  const ctx = { actor: "ui", permissions: [], intent: "action" } as const

  const first = fs.invoke(ref, DATABASE_ACTIONS.updateRow, { values: { value: "first" } }, ctx, {
    expectedVersion: "20",
  })
  await firstStarted
  const second = fs.invoke(ref, DATABASE_ACTIONS.updateRow, { values: { value: "second" } }, ctx, {
    expectedVersion: "20",
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  releaseFirst()

  const [firstResult, secondResult] = await Promise.allSettled([first, second])
  assert.equal(firstResult.status, "fulfilled")
  assert.equal(secondResult.status, "rejected")
  assert.ok(secondResult.reason instanceof FileSystemError)
  assert.equal(secondResult.reason.code, "conflict")
  assert.equal(updateRuns, 1)
  assert.equal(rows[0].updatedAt, 21)
  assert.equal(rows[0].values.value, "first")
})

test("database filesystem: row and table action paths share the root mutation lock", async () => {
  const currentTable = table("canonical-lock", 10)
  let rows: DataRow[] = [
    {
      id: "shared-row",
      tableId: currentTable.id,
      values: { value: "before" },
      createdAt: 1,
      updatedAt: 20,
    },
  ]
  let releaseUpdate!: () => void
  const updateMayFinish = new Promise<void>((resolve) => {
    releaseUpdate = resolve
  })
  let markUpdateStarted!: () => void
  const updateStarted = new Promise<void>((resolve) => {
    markUpdateStarted = resolve
  })
  let updateRuns = 0
  let deleteRuns = 0
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async deleteRow(id) {
        deleteRuns += 1
        rows = rows.filter((row) => row.id !== id)
      },
      async listRows(tableId) {
        return rows.filter((row) => row.tableId === tableId)
      },
      async listTables() {
        return [currentTable]
      },
      async updateRow(id, tableId, values) {
        updateRuns += 1
        markUpdateStarted()
        await updateMayFinish
        const previous = rows.find((row) => row.id === id)
        const updated: DataRow = {
          id,
          tableId,
          values,
          createdAt: previous?.createdAt ?? Date.now(),
          updatedAt: (previous?.updatedAt ?? 20) + 1,
        }
        rows = [...rows.filter((row) => row.id !== id), updated]
        return updated
      },
    }),
  )
  const rowRef = databaseRowRef(currentTable.id, "shared-row")
  const tableRef = databaseTableRef(currentTable.id)
  const afterUpdateVersion = await databaseTableSnapshotVersion(currentTable, [
    {
      id: "shared-row",
      tableId: currentTable.id,
      values: { value: "updated" },
      createdAt: 1,
      updatedAt: 21,
    },
  ])
  const ctx = { actor: "ui", permissions: [], intent: "action" } as const

  const update = fs.invoke(
    rowRef,
    DATABASE_ACTIONS.updateRow,
    { values: { value: "updated" } },
    ctx,
    { expectedVersion: "20" },
  )
  await updateStarted
  const remove = fs.invoke(tableRef, DATABASE_ACTIONS.deleteRow, { id: "shared-row" }, ctx, {
    expectedVersion: afterUpdateVersion,
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(deleteRuns, 0, "table action must wait for the row action's canonical lock")
  releaseUpdate()

  await Promise.all([update, remove])
  assert.equal(updateRuns, 1)
  assert.equal(deleteRuns, 1)
  assert.deepEqual(rows, [], "the later delete must not be undone by an in-flight row update")
})

test("database filesystem: root import and create serialize behind entity mutations", async () => {
  const currentTable = table("root-lock", 10)
  let rows: DataRow[] = [
    {
      id: "shared-row",
      tableId: currentTable.id,
      values: { value: "before" },
      createdAt: 1,
      updatedAt: 20,
    },
  ]
  let releaseUpdate!: () => void
  const updateMayFinish = new Promise<void>((resolve) => {
    releaseUpdate = resolve
  })
  let markUpdateStarted!: () => void
  const updateStarted = new Promise<void>((resolve) => {
    markUpdateStarted = resolve
  })
  let imports = 0
  let creates = 0
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async createTable(name, columns) {
        creates += 1
        return { id: "created", name, columns, createdAt: 30, updatedAt: 30 }
      },
      async importDatabaseJson() {
        imports += 1
        return { tables: 1, rows: 1 }
      },
      async listRows(tableId) {
        return rows.filter((row) => row.tableId === tableId)
      },
      async listTables() {
        return [currentTable]
      },
      async updateRow(id, tableId, values) {
        markUpdateStarted()
        await updateMayFinish
        const current = rows.find((row) => row.id === id) as DataRow
        const updated = { ...current, tableId, values, updatedAt: current.updatedAt + 1 }
        rows = rows.map((row) => (row.id === id ? updated : row))
        return updated
      },
    }),
  )
  const ctx = { actor: "ui", permissions: [], intent: "action" } as const
  const update = fs.invoke(
    databaseRowRef(currentTable.id, "shared-row"),
    DATABASE_ACTIONS.updateRow,
    { values: { value: "updated" } },
    ctx,
    { expectedVersion: "20" },
  )
  await updateStarted

  const importing = fs.invoke(
    fs.descriptor.root,
    DATABASE_ACTIONS.import,
    { content: "backup" },
    ctx,
  )
  const creating = fs.invoke(
    fs.descriptor.root,
    DATABASE_ACTIONS.createTable,
    { name: "Created", columns: "value" },
    ctx,
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(imports, 0, "import must wait until the entity mutation commits")
  assert.equal(creates, 0, "create must wait until the entity mutation commits")

  releaseUpdate()
  await Promise.all([update, importing, creating])
  assert.equal(imports, 1)
  assert.equal(creates, 1)
  assert.equal(rows[0].values.value, "updated")
})

test("database filesystem: root and collection additions do not apply pseudo CAS", async () => {
  const current = table("collection", 10)
  let creates = 0
  let imports = 0
  let additions = 0
  const fs = createDatabaseFileSystem(
    databaseDeps({
      async addRow(tableId, values) {
        additions += 1
        return {
          id: `added-${additions}`,
          tableId,
          values,
          createdAt: additions,
          updatedAt: additions,
        }
      },
      async createTable(name, columns) {
        creates += 1
        return { id: `created-${creates}`, name, columns, createdAt: 1, updatedAt: 1 }
      },
      async importDatabaseJson() {
        imports += 1
        return { tables: 1, rows: 0 }
      },
      async listTables() {
        return [current]
      },
    }),
  )
  const ctx = { actor: "ui", permissions: [], intent: "action" } as const

  await fs.invoke(
    fs.descriptor.root,
    DATABASE_ACTIONS.createTable,
    { name: "Created", columns: "value" },
    ctx,
    { expectedVersion: "stale-root" },
  )
  await fs.invoke(fs.descriptor.root, DATABASE_ACTIONS.import, { content: "backup" }, ctx, {
    expectedVersion: null,
  })
  await fs.invoke(
    databaseRowsDirectoryRef(current.id),
    DATABASE_ACTIONS.addRow,
    { values: { value: "directory" } },
    ctx,
    { expectedVersion: null },
  )
  await fs.invoke(
    databaseTableRef(current.id),
    DATABASE_ACTIONS.addRow,
    { values: { value: "table" } },
    ctx,
    { expectedVersion: "stale-table" },
  )

  assert.equal(creates, 1)
  assert.equal(imports, 1)
  assert.equal(additions, 2)
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
  const createdTableEvents: FileSystemWatchEvent[] = []
  const createdRowsEvents: FileSystemWatchEvent[] = []
  const createdTableWatch = fs.watch?.(
    databaseTableRef("created"),
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => createdTableEvents.push(event),
  )
  const createdRowsWatch = fs.watch?.(
    databaseRowsDirectoryRef("created"),
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => createdRowsEvents.push(event),
  )
  assert.ok(createdTableWatch)
  assert.ok(createdRowsWatch)
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
  const createdVersion = await databaseTableSnapshotVersion(
    (created as { table: DataTable }).table,
    [],
  )
  assert.equal(createdTableEvents[0]?.type, "created")
  assert.equal(createdRowsEvents[0]?.type, "created")
  assert.equal(createdTableEvents[0]?.version, createdVersion)
  assert.equal(createdRowsEvents[0]?.version, createdVersion)
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
  createdRowsWatch.dispose()
  createdTableWatch.dispose()
  tableWatch.dispose()
  rootWatch.dispose()
})
