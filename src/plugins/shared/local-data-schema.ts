import { AUTH_TOKEN_SECURE_KEY } from "@/lib/auth/auth-store"
import { secureFallbackStorageKey } from "@/lib/secure-store"
import { STARTUP_TARGET_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "@/lib/workspace-storage"
import { ENGINE_PREFERENCES_STORAGE_KEY, enginePreferencesStorageKey } from "@/engines/preferences"

export type LocalDataStorageKind = "localStorage" | "sessionStorage" | "indexedDB"
export type LocalDataSchemaStatus = "ok" | "missing" | "warning" | "error" | "unknown"

export type LocalDataSchema = {
  id: string
  label: string
  owner: string
  storage: LocalDataStorageKind
  key: string
  currentVersion: number
  sensitive?: boolean
  portable?: boolean
  parseAs?: "json" | "text"
  validate?: (value: unknown, raw: string) => string[]
  repair?: (value: unknown, raw: string) => LocalDataSchemaRepairPatch | null
}

export type LocalDataSchemaRepairPatch =
  | { action: "remove"; detail: string }
  | { action: "write"; value: unknown; detail: string }

export type LocalDataSchemaInspection = {
  id: string
  label: string
  owner: string
  storage: LocalDataStorageKind
  key: string
  currentVersion: number
  status: LocalDataSchemaStatus
  sensitive: boolean
  portable: boolean
  bytes: number | null
  detail: string
  issues: string[]
  repairable: boolean
}

type StorageLike = Pick<Storage, "getItem">
type MutableStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

export type IndexedDbListing = { name?: string | null; version?: number | null }

export type LocalDataSchemaInspectInput = {
  localStorage?: StorageLike
  sessionStorage?: StorageLike
  indexedDBDatabases?: () => Promise<IndexedDbListing[] | undefined>
}

export function isLocalDataRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function jsonArrayIssues(value: unknown): string[] {
  return Array.isArray(value) ? [] : ["应为 JSON 数组"]
}

export function jsonObjectIssues(value: unknown): string[] {
  return isLocalDataRecord(value) ? [] : ["应为 JSON 对象"]
}

export function repairJsonObject(value: unknown): LocalDataSchemaRepairPatch {
  return isLocalDataRecord(value)
    ? { action: "write", value, detail: "已规范化 JSON 对象" }
    : { action: "write", value: {}, detail: "已重置为空对象" }
}

export function repairJsonArray(value: unknown): LocalDataSchemaRepairPatch {
  return Array.isArray(value)
    ? { action: "write", value, detail: "已规范化 JSON 数组" }
    : { action: "write", value: [], detail: "已重置为空数组" }
}

const coreSchemas: readonly LocalDataSchema[] = [
  {
    id: "workspace.session",
    label: "工作区会话快照",
    owner: "workspace",
    storage: "sessionStorage",
    key: WORKSPACE_STORAGE_KEY,
    currentVersion: 1,
    parseAs: "json",
    validate: jsonObjectIssues,
    repair: () => ({ action: "remove", detail: "已移除损坏的会话快照" }),
  },
  {
    id: "workspace.local",
    label: "工作区恢复快照",
    owner: "workspace",
    storage: "localStorage",
    key: WORKSPACE_STORAGE_KEY,
    currentVersion: 1,
    parseAs: "json",
    validate: jsonObjectIssues,
    repair: () => ({ action: "remove", detail: "已移除损坏的恢复快照" }),
  },
  {
    id: "display.engine-preferences",
    label: "文件工作区默认引擎关联",
    owner: "display",
    storage: "localStorage",
    key: ENGINE_PREFERENCES_STORAGE_KEY,
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: jsonObjectIssues,
    repair: repairJsonObject,
  },
  {
    id: "display.engine-preferences.audio",
    label: "音频工作区默认引擎关联",
    owner: "display",
    storage: "localStorage",
    key: enginePreferencesStorageKey("audio"),
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: jsonObjectIssues,
    repair: repairJsonObject,
  },
  {
    id: "display.engine-preferences.development",
    label: "开发工作区默认引擎关联",
    owner: "display",
    storage: "localStorage",
    key: enginePreferencesStorageKey("development"),
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: jsonObjectIssues,
    repair: repairJsonObject,
  },
  {
    id: "display.startup-target",
    label: "默认启动文件视图",
    owner: "display",
    storage: "localStorage",
    key: STARTUP_TARGET_STORAGE_KEY,
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: jsonObjectIssues,
    repair: () => ({ action: "remove", detail: "已恢复默认 Home 启动界面" }),
  },
  {
    id: "auth.token",
    label: "登录令牌",
    owner: "auth",
    storage: "localStorage",
    key: secureFallbackStorageKey(AUTH_TOKEN_SECURE_KEY),
    currentVersion: 1,
    sensitive: true,
    parseAs: "text",
    validate: (_value, raw) => (raw.trim() ? ["登录令牌是本机能力凭证, 不进入插件数据导出"] : []),
  },
]

const schemas = new Map(coreSchemas.map((schema) => [schema.id, schema]))

function assertLocalDataSchema(schema: LocalDataSchema): void {
  if (
    !schema.id.trim() ||
    !schema.label.trim() ||
    !schema.owner.trim() ||
    !schema.key.trim() ||
    !Number.isSafeInteger(schema.currentVersion) ||
    schema.currentVersion < 1
  ) {
    throw new TypeError(`Invalid local data schema: ${schema.id || "<empty>"}`)
  }
}

/** 注册 owner 自有的本地数据描述；共享诊断层只消费 schema，不导入 owner 实现。 */
export function registerLocalDataSchemas(next: readonly LocalDataSchema[]): () => void {
  const registered: LocalDataSchema[] = []
  try {
    for (const schema of next) {
      assertLocalDataSchema(schema)
      const existing = schemas.get(schema.id)
      if (existing === schema) continue
      if (existing) throw new Error(`Local data schema already registered: ${schema.id}`)
      schemas.set(schema.id, schema)
      registered.push(schema)
    }
  } catch (error) {
    for (const schema of registered) {
      if (schemas.get(schema.id) === schema) schemas.delete(schema.id)
    }
    throw error
  }
  return () => {
    for (const schema of registered) {
      if (schemas.get(schema.id) === schema) schemas.delete(schema.id)
    }
  }
}

export function listLocalDataSchemas(): LocalDataSchema[] {
  return [...schemas.values()]
}

function safeStorage(name: "localStorage" | "sessionStorage"): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window[name]
  } catch {
    return undefined
  }
}

function safeMutableStorage(
  name: "localStorage" | "sessionStorage",
): MutableStorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window[name]
  } catch {
    return undefined
  }
}

function storageForSchema(
  schema: LocalDataSchema,
  input: LocalDataSchemaInspectInput,
): StorageLike | undefined {
  if (schema.storage === "localStorage") return input.localStorage ?? safeStorage("localStorage")
  if (schema.storage === "sessionStorage") {
    return input.sessionStorage ?? safeStorage("sessionStorage")
  }
  return undefined
}

function mutableStorageForSchema(
  schema: LocalDataSchema,
  input: LocalDataSchemaRepairInput,
): MutableStorageLike | undefined {
  if (schema.storage === "localStorage") {
    return input.localStorage ?? safeMutableStorage("localStorage")
  }
  if (schema.storage === "sessionStorage") {
    return input.sessionStorage ?? safeMutableStorage("sessionStorage")
  }
  return undefined
}

function inspectStorageSchema(
  schema: LocalDataSchema,
  input: LocalDataSchemaInspectInput,
): LocalDataSchemaInspection {
  const storage = storageForSchema(schema, input)
  if (!storage) {
    return {
      ...baseInspection(schema),
      status: "unknown",
      bytes: null,
      detail: `${schema.storage} 不可用`,
      issues: [`${schema.storage} 不可用`],
    }
  }

  let raw: string | null
  try {
    raw = storage.getItem(schema.key)
  } catch (error) {
    return {
      ...baseInspection(schema),
      status: "error",
      bytes: null,
      detail: "读取失败",
      issues: [error instanceof Error ? error.message : String(error)],
    }
  }

  if (!raw) {
    return {
      ...baseInspection(schema),
      status: "missing",
      bytes: 0,
      detail: "尚未创建",
      issues: [],
    }
  }

  let parsed: unknown = raw
  if (schema.parseAs === "json") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {
        ...baseInspection(schema),
        status: "error",
        bytes: new TextEncoder().encode(raw).byteLength,
        detail: "JSON 损坏",
        issues: ["JSON 解析失败"],
      }
    }
  }

  const issues = schema.validate?.(parsed, raw) ?? []
  return {
    ...baseInspection(schema),
    status: issues.length ? "warning" : "ok",
    bytes: new TextEncoder().encode(raw).byteLength,
    detail: issues.length ? issues.join(" / ") : "结构正常",
    issues,
  }
}

function baseInspection(
  schema: LocalDataSchema,
): Omit<LocalDataSchemaInspection, "status" | "bytes" | "detail" | "issues"> {
  return {
    id: schema.id,
    label: schema.label,
    owner: schema.owner,
    storage: schema.storage,
    key: schema.key,
    currentVersion: schema.currentVersion,
    sensitive: Boolean(schema.sensitive),
    portable: Boolean(schema.portable),
    repairable: Boolean(schema.repair && schema.storage !== "indexedDB"),
  }
}

async function inspectIndexedDbSchema(
  schema: LocalDataSchema,
  input: LocalDataSchemaInspectInput,
): Promise<LocalDataSchemaInspection> {
  const listDatabases =
    input.indexedDBDatabases ??
    (async () => {
      try {
        const idb = typeof indexedDB === "undefined" ? undefined : indexedDB
        const list = (
          idb as (IDBFactory & { databases?: () => Promise<IndexedDbListing[]> }) | undefined
        )?.databases
        return list ? await list.call(idb) : undefined
      } catch {
        return undefined
      }
    })
  const databases = await listDatabases()
  if (!databases) {
    return {
      ...baseInspection(schema),
      status: "unknown",
      bytes: null,
      detail: "浏览器未暴露 IndexedDB 列表",
      issues: [],
    }
  }

  const found = databases.find((db) => db.name === schema.key)
  if (!found) {
    return {
      ...baseInspection(schema),
      status: "missing",
      bytes: null,
      detail: "尚未创建",
      issues: [],
    }
  }
  const version = found.version ?? schema.currentVersion
  const issues =
    version === schema.currentVersion ? [] : [`当前 v${version}, 期望 v${schema.currentVersion}`]
  return {
    ...baseInspection(schema),
    status: issues.length ? "warning" : "ok",
    bytes: null,
    detail: issues.length ? issues.join(" / ") : `IndexedDB v${version}`,
    issues,
  }
}

export async function inspectLocalDataSchemas(
  input: LocalDataSchemaInspectInput = {},
): Promise<LocalDataSchemaInspection[]> {
  return Promise.all(
    listLocalDataSchemas().map((schema) =>
      schema.storage === "indexedDB"
        ? inspectIndexedDbSchema(schema, input)
        : inspectStorageSchema(schema, input),
    ),
  )
}

export type LocalDataSchemaRepairInput = {
  localStorage?: MutableStorageLike
  sessionStorage?: MutableStorageLike
}

export type LocalDataSchemaRepairResult = {
  id: string
  label: string
  ok: boolean
  detail: string
  before: LocalDataSchemaInspection
  after?: LocalDataSchemaInspection
}

function encodeRepairValue(schema: LocalDataSchema, value: unknown): string {
  return schema.parseAs === "text" && typeof value === "string" ? value : JSON.stringify(value)
}

export async function repairLocalDataSchema(
  id: string,
  input: LocalDataSchemaRepairInput = {},
): Promise<LocalDataSchemaRepairResult> {
  const schema = schemas.get(id)
  if (!schema) throw new Error(`未知 schema: ${id}`)
  const before = await (schema.storage === "indexedDB"
    ? inspectIndexedDbSchema(schema, {})
    : Promise.resolve(inspectStorageSchema(schema, input)))
  if (!schema.repair || schema.storage === "indexedDB") {
    return {
      id: schema.id,
      label: schema.label,
      ok: false,
      detail: "此 schema 不支持自动修复",
      before,
    }
  }
  const storage = mutableStorageForSchema(schema, input)
  if (!storage) {
    return {
      id: schema.id,
      label: schema.label,
      ok: false,
      detail: `${schema.storage} 不可用`,
      before,
    }
  }
  if (!["warning", "error"].includes(before.status)) {
    return {
      id: schema.id,
      label: schema.label,
      ok: true,
      detail: "无需修复",
      before,
      after: before,
    }
  }

  const raw = storage.getItem(schema.key)
  let parsed: unknown = raw ?? ""
  if (schema.parseAs === "json" && raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
  }
  const patch =
    before.status === "error" && parsed === undefined
      ? schema.repair(undefined, raw ?? "")
      : schema.repair(parsed, raw ?? "")
  if (!patch) {
    return { id: schema.id, label: schema.label, ok: false, detail: "没有可执行修复", before }
  }
  if (patch.action === "remove") storage.removeItem(schema.key)
  else storage.setItem(schema.key, encodeRepairValue(schema, patch.value))
  const after = inspectStorageSchema(schema, input)
  return { id: schema.id, label: schema.label, ok: true, detail: patch.detail, before, after }
}

export async function repairLocalDataSchemas(
  ids: string[],
  input: LocalDataSchemaRepairInput = {},
): Promise<LocalDataSchemaRepairResult[]> {
  const results: LocalDataSchemaRepairResult[] = []
  for (const id of ids) {
    results.push(await repairLocalDataSchema(id, input))
  }
  return results
}
