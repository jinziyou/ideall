import { AUTH_TOKEN_SECURE_KEY } from "@/lib/auth/auth-store"
import { isPersistedCaptureOnboarding } from "@/lib/capture-onboarding"
import { secureFallbackStorageKey } from "@/lib/secure-store"
import { STARTUP_TARGET_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "@/lib/workspace-storage"
import { ENGINE_PREFERENCES_STORAGE_KEY, enginePreferencesStorageKey } from "@/engines/preferences"
import { DISPLAY_ENGINES_FILE_REF } from "@/filesystem/builtin-app-roots"
import { withFileWriteLock } from "@/filesystem/write-lock"
import {
  CAPTURE_ONBOARDING_STORAGE_KEY,
  FILE_TREE_EXPANDED_STORAGE_KEY,
  THEME_KEY,
} from "@/lib/public-config"

export type LocalDataStorageKind = "localStorage" | "sessionStorage" | "indexedDB"
export type LocalDataSchemaStatus = "ok" | "missing" | "warning" | "error" | "unknown"

/**
 * 借 XDG Base Directory 的存储分类（见 docs/freedesktop-alignment.md §2）：
 * data 用户内容权威副本；config 偏好与公开配置；cache 可重建派生；state 跨会话状态/历史；
 * runtime 会话级；secrets 凭据材料本体（secure-store 或其 Web 版本化 fallback）。
 * 策略从类派生：cache/runtime/secrets 绝不进入归档导出（不得 portable）；secrets 必标 sensitive。
 */
export type LocalDataStorageClass = "data" | "config" | "cache" | "state" | "runtime" | "secrets"

export const LOCAL_DATA_STORAGE_CLASSES: readonly LocalDataStorageClass[] = [
  "data",
  "config",
  "cache",
  "state",
  "runtime",
  "secrets",
]

export type LocalDataSchema = {
  id: string
  label: string
  owner: string
  storage: LocalDataStorageKind
  key: string
  currentVersion: number
  /** XDG 存储类；混合 IndexedDB 库用 storeClasses 逐 store 细分。 */
  storageClass: LocalDataStorageClass
  /** 仅 indexedDB：库内各 object store 的存储类（库内策略混合时必填，如索引 cache / 审计 state）。 */
  storeClasses?: Readonly<Record<string, LocalDataStorageClass>>
  sensitive?: boolean
  portable?: boolean
  parseAs?: "json" | "text"
  validate?: (value: unknown, raw: string) => string[]
  repair?: (value: unknown, raw: string) => LocalDataSchemaRepairPatch | null
  /**
   * Owner 可把 fresh inspect → repair → apply → inspect 放进自己的规范 mutation 锁域。
   * 注入 Storage 主要用于诊断测试；hook 可据此保留通用的直接写入语义。
   */
  repairMutation?: <T>(
    operation: () => Promise<T>,
    context: LocalDataSchemaRepairOwnerContext,
  ) => Promise<T>
  /** Owner 已有耐久 store 时通过该入口提交，避免共享层绕过 revision/失效协议。 */
  applyRepair?: (
    patch: LocalDataSchemaRepairPatch,
    context: LocalDataSchemaRepairApplyContext,
  ) => void | Promise<void>
}

export type LocalDataSchemaRepairPatch =
  { action: "remove"; detail: string } | { action: "write"; value: unknown; detail: string }

export type LocalDataSchemaInspection = {
  id: string
  label: string
  owner: string
  storage: LocalDataStorageKind
  key: string
  currentVersion: number
  storageClass: LocalDataStorageClass
  storeClasses?: Readonly<Record<string, LocalDataStorageClass>>
  status: LocalDataSchemaStatus
  sensitive: boolean
  portable: boolean
  bytes: number | null
  detail: string
  issues: string[]
  repairable: boolean
}

type StorageLike = Pick<Storage, "getItem">
export type MutableStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

export type LocalDataSchemaRepairOwnerContext = Readonly<{
  storage: MutableStorageLike
  storageInjected: boolean
}>

export type LocalDataSchemaRepairApplyContext = LocalDataSchemaRepairOwnerContext &
  Readonly<{
    applyDefault(): void
  }>

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

/**
 * engine 偏好三条 schema 的修复与 `app.display` provider 写共用同一把 FileRef 锁——
 * 防止修复直写与 engines.json CAS 写跨窗口互相覆盖（docs/freedesktop-alignment.md §4.2）。
 */
function withDisplayEnginesRepairLock<T>(operation: () => Promise<T>): Promise<T> {
  return withFileWriteLock(DISPLAY_ENGINES_FILE_REF, operation)
}

const coreSchemas: readonly LocalDataSchema[] = [
  {
    id: "appearance.theme",
    label: "主题选择",
    owner: "appearance",
    storage: "localStorage",
    key: THEME_KEY,
    currentVersion: 1,
    storageClass: "config",
    portable: true,
    parseAs: "text",
    validate: (value) =>
      value === "light" || value === "dark" || value === "system" ? [] : ["主题值无效"],
    repair: () => ({ action: "write", value: "system", detail: "已恢复跟随系统主题" }),
  },
  {
    id: "navigation.file-tree-expanded",
    label: "文件树展开状态",
    owner: "navigation",
    storage: "localStorage",
    key: FILE_TREE_EXPANDED_STORAGE_KEY,
    currentVersion: 1,
    storageClass: "state",
    parseAs: "json",
    validate: (value) =>
      Array.isArray(value) && value.every((item) => typeof item === "string")
        ? []
        : ["应为字符串数组"],
    repair: (value) => ({
      action: "write",
      value: Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [],
      detail: "已移除无效的文件树展开项",
    }),
  },
  {
    id: "capture.onboarding",
    label: "首次捕获引导状态",
    owner: "capture",
    storage: "localStorage",
    key: CAPTURE_ONBOARDING_STORAGE_KEY,
    currentVersion: 1,
    storageClass: "state",
    parseAs: "json",
    validate: (value) => (isPersistedCaptureOnboarding(value) ? [] : ["引导状态无效"]),
    repair: (value) =>
      isPersistedCaptureOnboarding(value)
        ? null
        : { action: "remove", detail: "已重置首次捕获引导" },
  },
  {
    id: "workspace.session",
    label: "工作区会话快照",
    owner: "workspace",
    storage: "sessionStorage",
    key: WORKSPACE_STORAGE_KEY,
    currentVersion: 1,
    storageClass: "runtime",
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
    storageClass: "state",
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
    currentVersion: 2,
    storageClass: "config",
    portable: true,
    parseAs: "json",
    validate: jsonObjectIssues,
    repair: repairJsonObject,
    repairMutation: (operation) => withDisplayEnginesRepairLock(operation),
  },
  {
    id: "display.engine-preferences.audio",
    label: "音频工作区默认引擎关联",
    owner: "display",
    storage: "localStorage",
    key: enginePreferencesStorageKey("audio"),
    currentVersion: 2,
    storageClass: "config",
    portable: true,
    parseAs: "json",
    validate: jsonObjectIssues,
    repair: repairJsonObject,
    repairMutation: (operation) => withDisplayEnginesRepairLock(operation),
  },
  {
    id: "display.engine-preferences.development",
    label: "开发工作区默认引擎关联",
    owner: "display",
    storage: "localStorage",
    key: enginePreferencesStorageKey("development"),
    currentVersion: 2,
    storageClass: "config",
    portable: true,
    parseAs: "json",
    validate: jsonObjectIssues,
    repair: repairJsonObject,
    repairMutation: (operation) => withDisplayEnginesRepairLock(operation),
  },
  {
    id: "display.startup-target",
    label: "默认启动文件视图",
    owner: "display",
    storage: "localStorage",
    key: STARTUP_TARGET_STORAGE_KEY,
    currentVersion: 1,
    storageClass: "config",
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
    storageClass: "secrets",
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
  if (!LOCAL_DATA_STORAGE_CLASSES.includes(schema.storageClass)) {
    throw new TypeError(`Invalid storage class for local data schema: ${schema.id}`)
  }
  // 策略不变量（docs/freedesktop-alignment.md §2.2）：可重建/会话级/凭据绝不进入导出面。
  if (
    schema.portable === true &&
    (schema.storageClass === "cache" ||
      schema.storageClass === "runtime" ||
      schema.storageClass === "secrets")
  ) {
    throw new TypeError(
      `Local data schema ${schema.id}: ${schema.storageClass} must not be portable`,
    )
  }
  if (schema.storageClass === "secrets" && schema.sensitive !== true) {
    throw new TypeError(`Local data schema ${schema.id}: secrets must be marked sensitive`)
  }
  if (schema.storeClasses !== undefined) {
    if (schema.storage !== "indexedDB") {
      throw new TypeError(`Local data schema ${schema.id}: storeClasses requires indexedDB storage`)
    }
    for (const [store, storeClass] of Object.entries(schema.storeClasses)) {
      if (!store.trim() || !LOCAL_DATA_STORAGE_CLASSES.includes(storeClass)) {
        throw new TypeError(`Local data schema ${schema.id}: invalid storeClasses entry`)
      }
    }
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
    storageClass: schema.storageClass,
    ...(schema.storeClasses === undefined ? {} : { storeClasses: schema.storeClasses }),
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
  if (!schema.repair || schema.storage === "indexedDB") {
    const before = await (schema.storage === "indexedDB"
      ? inspectIndexedDbSchema(schema, {})
      : Promise.resolve(inspectStorageSchema(schema, input)))
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
    const before = inspectStorageSchema(schema, input)
    return {
      id: schema.id,
      label: schema.label,
      ok: false,
      detail: `${schema.storage} 不可用`,
      before,
    }
  }
  const ownerContext: LocalDataSchemaRepairOwnerContext = {
    storage,
    storageInjected:
      schema.storage === "localStorage"
        ? input.localStorage !== undefined
        : input.sessionStorage !== undefined,
  }
  const repair = async (): Promise<LocalDataSchemaRepairResult> => {
    // 必须在 owner mutation hook 内重新 inspect；锁外的诊断快照不能作为提交基线。
    const before = inspectStorageSchema(schema, input)
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
        ? schema.repair!(undefined, raw ?? "")
        : schema.repair!(parsed, raw ?? "")
    if (!patch) {
      return { id: schema.id, label: schema.label, ok: false, detail: "没有可执行修复", before }
    }
    const applyDefault = () => {
      if (patch.action === "remove") storage.removeItem(schema.key)
      else storage.setItem(schema.key, encodeRepairValue(schema, patch.value))
    }
    if (schema.applyRepair) {
      await schema.applyRepair(patch, { ...ownerContext, applyDefault })
    } else {
      applyDefault()
    }
    const after = inspectStorageSchema(schema, input)
    return { id: schema.id, label: schema.label, ok: true, detail: patch.detail, before, after }
  }
  return schema.repairMutation ? schema.repairMutation(repair, ownerContext) : repair()
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
