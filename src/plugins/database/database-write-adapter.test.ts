import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileRef } from "@protocol/file-system"
import { DATABASE_ROOT_REF } from "@/filesystem/builtin-app-roots"
import {
  DATABASE_ACTIONS,
  createDatabaseFileSystem,
  databaseRowRef,
  type DatabaseFileSystemDeps,
} from "./database-file-system"
import { databaseManifest } from "./manifest"
import {
  importDatabaseJsonWithRootLock,
  withDatabaseRootMutationLock,
} from "./database-write-adapter"
import type { DataRow } from "./database-store"

const UI_ACTION = { actor: "ui", permissions: [], intent: "action" } as const
const UI_WATCH = { actor: "ui", permissions: [], intent: "watch" } as const

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function databaseDeps(overrides: Partial<DatabaseFileSystemDeps> = {}): DatabaseFileSystemDeps {
  return {
    async addRow(tableId, values) {
      return { id: "row", tableId, values, createdAt: 1, updatedAt: 1 }
    },
    async createTable(name, columns) {
      return { id: "table", name, columns, createdAt: 1, updatedAt: 1 }
    },
    async deleteRow() {},
    async deleteTable() {},
    async exportDatabaseJson() {
      return "exported"
    },
    async getRow() {
      return undefined
    },
    async getTable() {
      return undefined
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
    rowValuesForColumns(columns, values) {
      return Object.fromEntries(columns.map((column) => [column, values[column] ?? ""]))
    },
    async updateRow(id, tableId, values) {
      return { id, tableId, values, createdAt: 1, updatedAt: 2 }
    },
    ...overrides,
  }
}

test("database write adapter: manifest import waits for provider entity mutations", async () => {
  const events: string[] = []
  const providerEntered = deferred()
  const releaseProvider = deferred()
  const table = {
    id: "table",
    name: "Table",
    columns: ["value"],
    createdAt: 1,
    updatedAt: 1,
  }
  let row: DataRow = {
    id: "row",
    tableId: table.id,
    values: { value: "before" },
    createdAt: 2,
    updatedAt: 2,
  }
  const provider = createDatabaseFileSystem(
    databaseDeps({
      async getRow(tableId, rowId) {
        return tableId === table.id && rowId === row.id ? row : undefined
      },
      async getTable(id) {
        return id === table.id ? table : undefined
      },
      async listRows(tableId) {
        return tableId === table.id ? [row] : []
      },
      async listTables() {
        return [table]
      },
      async updateRow(id, tableId, values) {
        events.push("provider:start")
        providerEntered.resolve()
        await releaseProvider.promise
        events.push("provider:end")
        row = { ...row, id, tableId, values, updatedAt: row.updatedAt + 1 }
        return row
      },
    }),
  )

  const updating = provider.invoke(
    databaseRowRef(table.id, row.id),
    DATABASE_ACTIONS.updateRow,
    { values: { value: "updated" } },
    UI_ACTION,
    { expectedVersion: String(row.updatedAt) },
  )
  await providerEntered.promise

  const importing = importDatabaseJsonWithRootLock("database-package", async (raw) => {
    assert.equal(raw, "database-package")
    events.push("manifest:import")
    return { tables: 1, rows: 2 }
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ["provider:start"], "manifest import must wait for the provider lock")

  releaseProvider.resolve()
  const [, result] = await Promise.all([updating, importing])
  assert.deepEqual(result, { tables: 1, rows: 2 })
  assert.deepEqual(events, ["provider:start", "provider:end", "manifest:import"])
  assert.deepEqual(row.values, { value: "updated" })
})

test("database write adapter: uses the canonical database root lock", async () => {
  let lockedRef: FileRef | undefined
  await withDatabaseRootMutationLock(
    () => undefined,
    async (ref, operation) => {
      lockedRef = ref
      return operation()
    },
  )
  assert.deepEqual(lockedRef, DATABASE_ROOT_REF)
})

test("database data-port import invalidates open root and row displays only after success", async () => {
  const provider = createDatabaseFileSystem(databaseDeps())
  const rowRef = databaseRowRef("table", "row")
  const rootEvents: string[] = []
  const rowEvents: string[] = []
  const rootWatch = provider.watch?.(DATABASE_ROOT_REF, UI_WATCH, (event) =>
    rootEvents.push(`${event.type}:${event.ref.fileId}`),
  )
  const rowWatch = provider.watch?.(rowRef, UI_WATCH, (event) =>
    rowEvents.push(`${event.type}:${event.ref.fileId}`),
  )
  assert.ok(rootWatch)
  assert.ok(rowWatch)

  const result = await importDatabaseJsonWithRootLock("database-package", async () => ({
    tables: 1,
    rows: 1,
  }))
  assert.deepEqual(result, { tables: 1, rows: 1 })
  assert.deepEqual(rootEvents, [`changed:${DATABASE_ROOT_REF.fileId}`])
  assert.deepEqual(rowEvents, [`changed:${rowRef.fileId}`])

  await assert.rejects(
    importDatabaseJsonWithRootLock("broken-package", async () => {
      throw new Error("database import rejected")
    }),
    /database import rejected/,
  )
  assert.equal(rootEvents.length, 1)
  assert.equal(rowEvents.length, 1)

  rootWatch.dispose()
  rowWatch.dispose()
})

test("database manifest: importJson routes through the root lock adapter", () => {
  assert.equal(databaseManifest.dataPorts[0]?.importJson, importDatabaseJsonWithRootLock)
})
