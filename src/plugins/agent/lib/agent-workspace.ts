// AI 智能体「工作区」模型与存储 —— 把数据、能力、规则、提示词与模型收敛为可复用工作区。
// 公开索引与单调 revision 原子保存在同一 localStorage JSON；模型覆盖 API Key 只进 secure-store。

import type { FileRef } from "@protocol/file-system"
import { AGENT_TASKS_FILE_REF, AGENT_WORKSPACES_FILE_REF } from "@/filesystem/builtin-app-roots"
import { withFileWriteLock } from "@/filesystem/write-lock"
import { genId } from "@/lib/id"
import { secureDelete, secureFallbackGet, secureGet, secureSet } from "@/lib/secure-store"
import { isTauri } from "@/lib/tauri"
import type { Permission } from "@/plugins/embed/protocol"
import { AGENT_CONFIGURABLE_PERMISSIONS, AGENT_PERMISSIONS } from "@/plugins/embed/grant"
import {
  createPluginMutationInvalidationChannel,
  type PluginMutationInvalidationChannel,
} from "@/plugins/shared/plugin-mutation-channel"
import type { HomeSelection } from "./agent-context"
import { activeRulesText } from "./agent-rules"
import { getAgentSettings } from "./agent-settings"

export const AGENT_WORKSPACES_STORAGE_KEY = "ideall:agent:workspaces:v1"
export const AGENT_WORKSPACE_MUTATION_SCOPE = "app.agent-config:workspaces"

/** 数据组: 「我的」概览 + 本地目录。 */
export interface WorkspaceData {
  includeHome: boolean
  home: Required<HomeSelection>
  dirNodeId: string | null
  osDir: string | null
}

/** 能力组: MCP / 工具 / 技能 / 应用。 */
export interface WorkspaceCapabilities {
  permissions: Permission[]
  toolAllowlist: string[] | null
  skillIds: string[] | null
  appIds: string[] | null
}

/** 规则组: 引用顶层规则注册表的工作空间级规则 id。 */
export interface WorkspaceRules {
  ruleIds: string[]
}

/** 提示词组: 用户指令 + 精确模式拼接模板 + 最终提示覆盖。 */
export interface WorkspacePrompt {
  instructions: string
  template: string
  precise: boolean
  override: string
}

/** 模型组: 全局设置 或 本工作区覆盖。 */
export interface WorkspaceModel {
  useGlobal: boolean
  baseURL: string
  model: string
  /** 只存在于内存与 secure-store，公开持久化文档始终写空。 */
  apiKey: string
}

export interface AgentWorkspace {
  id: string
  name: string
  data: WorkspaceData
  capabilities: WorkspaceCapabilities
  rules: WorkspaceRules
  prompt: WorkspacePrompt
  model: WorkspaceModel
  createdAt: number
  updatedAt: number
}

export interface WorkspacesState {
  workspaces: AgentWorkspace[]
  activeId: string
}

type PersistedWorkspacesEnvelope = WorkspacesState & { _revision: string }
type WorkspaceUpdater = (current: AgentWorkspace) => AgentWorkspace
type FileWriteLock = <T>(ref: FileRef, operation: () => T | Promise<T>) => Promise<T>

export type AgentWorkspaceStoreDeps = Readonly<{
  storage(): Storage | undefined
  secureGet(key: string): Promise<string | null>
  secureSet(key: string, value: string): Promise<unknown>
  secureDelete(key: string): Promise<void>
  secureFallbackGet(key: string): string | null
  isTauri(): boolean
  now(): number
  genId(prefix: string): string
  invalidation: Pick<PluginMutationInvalidationChannel, "publish" | "subscribe">
  withRefreshLock<T>(operation: () => T | Promise<T>): Promise<T>
  subscribeLifecycle(listener: () => void): () => void
}>

export type AgentWorkspaceStore = Readonly<{
  subscribe(listener: () => void): () => void
  getState(): WorkspacesState
  getServerState(): WorkspacesState
  getActive(): AgentWorkspace | null
  get(id: string): AgentWorkspace | undefined
  revisionSnapshot(): string
  refreshRaw(): Promise<void>
  refresh(): Promise<void>
  createRaw(name?: string): Promise<AgentWorkspace>
  saveRaw(workspace: AgentWorkspace): Promise<AgentWorkspace>
  updateRaw(id: string, updater: WorkspaceUpdater): Promise<AgentWorkspace | undefined>
  deleteRaw(id: string): Promise<void>
  renameRaw(id: string, name: string): Promise<void>
  setActiveRaw(id: string): Promise<void>
  replacePublicRaw(next: Partial<WorkspacesState>): Promise<void>
  repairPublicRaw(next: Partial<WorkspacesState>): Promise<void>
  resolveModel(workspace: AgentWorkspace): { baseURL: string; model: string; apiKey: string }
  securitySnapshot(): {
    total: number
    localApiKeyCount: number
    secureCachedCount: number
    secureHydrated: boolean
  }
  dispose(): void
}>

const ALL_HOME_SELECTED: Required<HomeSelection> = {
  notes: true,
  subscriptions: true,
  bookmarks: true,
  folders: true,
  files: true,
}
const CONFIGURABLE_PERMISSIONS = new Set<string>(AGENT_CONFIGURABLE_PERMISSIONS)
const REVISION_DIGITS = 64
const REVISION_PATTERN = new RegExp(`^(0|[1-9]\\d{0,${REVISION_DIGITS - 1}})$`)
const MAX_REVISION = 10n ** BigInt(REVISION_DIGITS) - 1n
const SERVER_STATE: WorkspacesState = { workspaces: [], activeId: "" }
const LEGACY_WORKSPACE_CREDENTIAL_RECORD_VERSION = 1
const WORKSPACE_CREDENTIAL_RECORD_VERSION = 2

type WorkspaceCredentialRecord = Readonly<{
  version: typeof WORKSPACE_CREDENTIAL_RECORD_VERSION
  target: string | null
  apiKey: string
  /** 此 secure 写入应与之配对的公开 envelope revision。 */
  revision: string
}>

type LegacyWorkspaceCredentialRecord = Readonly<{
  version: typeof LEGACY_WORKSPACE_CREDENTIAL_RECORD_VERSION
  target: string | null
  apiKey: string
}>

type ParsedWorkspaceCredential =
  | Readonly<{ kind: "record"; record: WorkspaceCredentialRecord }>
  | Readonly<{ kind: "legacy-record"; record: LegacyWorkspaceCredentialRecord }>
  | Readonly<{ kind: "legacy"; apiKey: string }>
  | Readonly<{ kind: "invalid" }>

/**
 * Workspace 凭据的稳定目标：仅允许 http(s)，并清除 URL userinfo、query 与 fragment。
 * Secure record 与 UI 写入前置检查必须复用同一纯函数，避免不同规范化规则重新绑定凭据。
 */
export function workspaceModelCredentialTarget(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function normalizedWorkspaceBaseURL(value: unknown): string {
  return typeof value === "string" ? (workspaceModelCredentialTarget(value) ?? "") : ""
}

function encodeWorkspaceCredential(target: string, apiKey: string, revision: bigint): string {
  return JSON.stringify({
    version: WORKSPACE_CREDENTIAL_RECORD_VERSION,
    target,
    apiKey,
    revision: String(revision),
  } satisfies WorkspaceCredentialRecord)
}

function encodeWorkspaceCredentialTombstone(revision: bigint): string {
  return JSON.stringify({
    version: WORKSPACE_CREDENTIAL_RECORD_VERSION,
    target: null,
    apiKey: "",
    revision: String(revision),
  } satisfies WorkspaceCredentialRecord)
}

function parseWorkspaceCredential(value: string | null): ParsedWorkspaceCredential | null {
  if (value === null) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "legacy", apiKey: value }
    }
    const record = parsed as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const validTargetAndKey =
      (record.target === null && record.apiKey === "") ||
      (typeof record.target === "string" &&
        Boolean(record.apiKey) &&
        workspaceModelCredentialTarget(record.target) === record.target)
    if (!validTargetAndKey || typeof record.apiKey !== "string") return { kind: "invalid" }

    if (
      keys.length === 4 &&
      keys[0] === "apiKey" &&
      keys[1] === "revision" &&
      keys[2] === "target" &&
      keys[3] === "version" &&
      record.version === WORKSPACE_CREDENTIAL_RECORD_VERSION &&
      typeof record.revision === "string" &&
      REVISION_PATTERN.test(record.revision)
    ) {
      return {
        kind: "record",
        record: {
          version: WORKSPACE_CREDENTIAL_RECORD_VERSION,
          target: record.target as string | null,
          apiKey: record.apiKey,
          revision: record.revision,
        },
      }
    }
    if (
      keys.length === 3 &&
      keys[0] === "apiKey" &&
      keys[1] === "target" &&
      keys[2] === "version" &&
      record.version === LEGACY_WORKSPACE_CREDENTIAL_RECORD_VERSION
    ) {
      return {
        kind: "legacy-record",
        record: {
          version: LEGACY_WORKSPACE_CREDENTIAL_RECORD_VERSION,
          target: record.target as string | null,
          apiKey: record.apiKey,
        },
      }
    }
    return { kind: "invalid" }
  } catch {
    return { kind: "legacy", apiKey: value }
  }
}

function createDefaultWorkspace(
  name: string,
  now: () => number,
  createId: (prefix: string) => string,
): AgentWorkspace {
  const timestamp = now()
  return {
    id: createId("ws"),
    name,
    data: { includeHome: true, home: { ...ALL_HOME_SELECTED }, dirNodeId: null, osDir: null },
    capabilities: {
      permissions: [...AGENT_PERMISSIONS],
      toolAllowlist: null,
      skillIds: null,
      appIds: null,
    },
    rules: { ruleIds: [] },
    prompt: { instructions: "", template: "", precise: false, override: "" },
    model: { useGlobal: true, baseURL: "", model: "", apiKey: "" },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/** 一个全默认的工作区。 */
export function defaultWorkspace(name = "默认工作区"): AgentWorkspace {
  return createDefaultWorkspace(name, Date.now, genId)
}

function migratePermissions(value: unknown, fallback: readonly Permission[]): Permission[] {
  if (!Array.isArray(value)) return [...fallback]
  return [
    ...new Set(
      value.filter(
        (permission): permission is Permission =>
          typeof permission === "string" && CONFIGURABLE_PERMISSIONS.has(permission),
      ),
    ),
  ]
}

function migrateWorkspace(
  workspace: Partial<AgentWorkspace>,
  makeDefault: (name?: string) => AgentWorkspace,
): AgentWorkspace {
  const fallback = makeDefault(workspace.name ?? undefined)
  const model = { ...fallback.model, ...(workspace.model ?? {}) }
  return {
    ...fallback,
    ...workspace,
    id: workspace.id ?? fallback.id,
    name: workspace.name ?? fallback.name,
    data: {
      ...fallback.data,
      ...(workspace.data ?? {}),
      home: { ...fallback.data.home, ...(workspace.data?.home ?? {}) },
    },
    capabilities: {
      ...fallback.capabilities,
      ...(workspace.capabilities ?? {}),
      permissions: migratePermissions(
        workspace.capabilities?.permissions,
        fallback.capabilities.permissions,
      ),
    },
    rules: { ruleIds: Array.isArray(workspace.rules?.ruleIds) ? workspace.rules.ruleIds : [] },
    prompt: { ...fallback.prompt, ...(workspace.prompt ?? {}) },
    model: { ...model, baseURL: normalizedWorkspaceBaseURL(model.baseURL) },
    createdAt: workspace.createdAt ?? fallback.createdAt,
    updatedAt: workspace.updatedAt ?? fallback.updatedAt,
  }
}

function cloneWorkspace(workspace: AgentWorkspace): AgentWorkspace {
  return {
    ...workspace,
    data: { ...workspace.data, home: { ...workspace.data.home } },
    capabilities: {
      ...workspace.capabilities,
      permissions: [...workspace.capabilities.permissions],
      toolAllowlist: workspace.capabilities.toolAllowlist
        ? [...workspace.capabilities.toolAllowlist]
        : null,
      skillIds: workspace.capabilities.skillIds ? [...workspace.capabilities.skillIds] : null,
      appIds: workspace.capabilities.appIds ? [...workspace.capabilities.appIds] : null,
    },
    rules: { ruleIds: [...workspace.rules.ruleIds] },
    prompt: { ...workspace.prompt },
    model: { ...workspace.model },
  }
}

function cloneState(value: WorkspacesState): WorkspacesState {
  return { activeId: value.activeId, workspaces: value.workspaces.map(cloneWorkspace) }
}

function publicWorkspace(workspace: AgentWorkspace): AgentWorkspace {
  return {
    ...cloneWorkspace(workspace),
    model: {
      ...workspace.model,
      baseURL: normalizedWorkspaceBaseURL(workspace.model.baseURL),
      apiKey: "",
    },
  }
}

function publicState(value: WorkspacesState): WorkspacesState {
  return { activeId: value.activeId, workspaces: value.workspaces.map(publicWorkspace) }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]))
    )
  }
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    return false
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && sameJsonValue(leftRecord[key], rightRecord[key]),
    )
  )
}

function sameState(left: WorkspacesState, right: WorkspacesState): boolean {
  return sameJsonValue(left, right)
}

function sameWorkspaceIgnoringUpdatedAt(left: AgentWorkspace, right: AgentWorkspace): boolean {
  return sameJsonValue({ ...left, updatedAt: 0 }, { ...right, updatedAt: 0 })
}

function workspaceApiKeySecureKey(id: string): string {
  return `ideall:agent:workspace:${id}:apiKey`
}

const modelEndpoint = workspaceModelCredentialTarget

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

function subscribeWorkspaceLifecycle(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const target = window
  const resume = () => listener()
  target.addEventListener("pageshow", resume)
  target.addEventListener("focus", resume)
  let documentTarget: Document | null = null
  const resumeWhenVisible = () => {
    if (documentTarget?.visibilityState === "visible") listener()
  }
  try {
    documentTarget = target.document ?? null
    documentTarget?.addEventListener("visibilitychange", resumeWhenVisible)
  } catch {
    documentTarget = null
  }
  return () => {
    target.removeEventListener("pageshow", resume)
    target.removeEventListener("focus", resume)
    documentTarget?.removeEventListener("visibilitychange", resumeWhenVisible)
  }
}

const workspaceInvalidation = createPluginMutationInvalidationChannel(
  AGENT_WORKSPACE_MUTATION_SCOPE,
)

function withAgentWorkspaceRefreshLocks<T>(operation: () => T | Promise<T>): Promise<T> {
  return withFileWriteLock(AGENT_TASKS_FILE_REF, () =>
    withFileWriteLock(AGENT_WORKSPACES_FILE_REF, operation),
  )
}

const DEFAULT_DEPS: AgentWorkspaceStoreDeps = {
  storage: defaultStorage,
  secureGet,
  secureSet,
  secureDelete,
  secureFallbackGet: (key) => (isTauri() ? null : secureFallbackGet(key)),
  isTauri,
  now: Date.now,
  genId,
  invalidation: workspaceInvalidation,
  withRefreshLock: withAgentWorkspaceRefreshLocks,
  subscribeLifecycle: subscribeWorkspaceLifecycle,
}

type PersistedSnapshot = {
  state: WorkspacesState
  revision: bigint
  legacy: boolean
  needsRewrite: boolean
  token: string
}

type SecurePlan = { key: string; value: string | (() => string); force?: boolean }
type CachedWorkspaceCredential = Readonly<{ target: string; apiKey: string }>

function incrementRevision(floor: bigint): bigint {
  if (floor >= MAX_REVISION) {
    throw new Error("Workspace revision space is exhausted")
  }
  return floor + 1n
}

/**
 * 创建隔离的 workspace store。Raw 方法不获取 FileRef 锁；provider/importer 或 runtime adapter
 * 必须在外层持有 tasks→workspaces，公开 refresh() 则通过 deps.withRefreshLock 获取同一锁链。
 */
export function createAgentWorkspaceStore(deps: AgentWorkspaceStoreDeps): AgentWorkspaceStore {
  const makeDefault = (name = "默认工作区") => createDefaultWorkspace(name, deps.now, deps.genId)
  const listeners = new Set<() => void>()
  const workspaceApiKeyCache = new Map<string, CachedWorkspaceCredential>()
  let state: WorkspacesState | null = null
  let revision = 0n
  let lastDurableToken: string | null = null
  let secureHydrated = false
  let credentialRecoveryRequired = false
  let requestedRefresh = 0
  let completedRefresh = 0
  let synchronization: Promise<void> | null = null
  let mutationTail: Promise<void> = Promise.resolve()
  let stopInvalidation: (() => void) | null = null
  let stopLifecycle: (() => void) | null = null

  function parsePersisted(raw: string): PersistedSnapshot | null {
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedWorkspacesEnvelope>
      if (!Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) return null
      const workspaces = parsed.workspaces.map((workspace) =>
        migrateWorkspace(workspace, makeDefault),
      )
      const activeId =
        typeof parsed.activeId === "string" &&
        workspaces.some((workspace) => workspace.id === parsed.activeId)
          ? parsed.activeId
          : workspaces[0].id
      const revisionRaw = (parsed as { _revision?: unknown })._revision
      const legacy = revisionRaw === undefined
      if (!legacy && (typeof revisionRaw !== "string" || !REVISION_PATTERN.test(revisionRaw))) {
        return null
      }
      const needsRewrite = parsed.workspaces.some((rawWorkspace, index) => {
        const rawModel =
          rawWorkspace && typeof rawWorkspace === "object" && !Array.isArray(rawWorkspace)
            ? (rawWorkspace as { model?: unknown }).model
            : undefined
        if (!rawModel || typeof rawModel !== "object" || Array.isArray(rawModel)) return false
        const model = rawModel as Record<string, unknown>
        const rawBaseURL = typeof model.baseURL === "string" ? model.baseURL : ""
        return (
          (typeof model.apiKey === "string" && model.apiKey.length > 0) ||
          rawBaseURL !== workspaces[index]?.model.baseURL
        )
      })
      return {
        state: { workspaces, activeId },
        revision: legacy ? 0n : BigInt(revisionRaw),
        legacy,
        needsRewrite: legacy || needsRewrite,
        token: raw,
      }
    } catch {
      return null
    }
  }

  function persistedRevisionFloor(raw: string | null): bigint {
    if (raw === null) return 0n
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0n
      const revisionRaw = (parsed as { _revision?: unknown })._revision
      return typeof revisionRaw === "string" && REVISION_PATTERN.test(revisionRaw)
        ? BigInt(revisionRaw)
        : 0n
    } catch {
      return 0n
    }
  }

  function currentPersistedRevisionFloor(): bigint {
    const storage = deps.storage()
    if (!storage) return 0n
    return persistedRevisionFloor(storage.getItem(AGENT_WORKSPACES_STORAGE_KEY))
  }

  function nextWriteRevision(): bigint {
    const persistedFloor = currentPersistedRevisionFloor()
    return incrementRevision(persistedFloor > revision ? persistedFloor : revision)
  }

  function readPersisted(): PersistedSnapshot | null {
    const storage = deps.storage()
    if (!storage) return null
    const raw = storage.getItem(AGENT_WORKSPACES_STORAGE_KEY)
    return raw === null ? null : parsePersisted(raw)
  }

  function materializeFallbackKeys(
    value: WorkspacesState,
    envelopeRevision: bigint,
  ): WorkspacesState {
    return {
      ...value,
      workspaces: value.workspaces.map((workspace) => {
        const fallback = parseWorkspaceCredential(
          deps.secureFallbackGet(workspaceApiKeySecureKey(workspace.id)),
        )
        const target = modelEndpoint(workspace.model.baseURL)
        const apiKey =
          !workspace.model.useGlobal &&
          target !== null &&
          fallback?.kind === "record" &&
          BigInt(fallback.record.revision) <= envelopeRevision &&
          fallback.record.target === target
            ? fallback.record.apiKey
            : ""
        if (apiKey && target) workspaceApiKeyCache.set(workspace.id, { target, apiKey })
        return { ...workspace, model: { ...workspace.model, apiKey } }
      }),
    }
  }

  function ensure(): WorkspacesState {
    if (state) return state
    let persisted: PersistedSnapshot | null = null
    try {
      persisted = readPersisted()
    } catch {
      persisted = null
    }
    if (persisted) {
      state = materializeFallbackKeys(persisted.state, persisted.revision)
      revision = persisted.revision
      lastDurableToken = persisted.token
    } else {
      const workspace = makeDefault()
      state = { workspaces: [workspace], activeId: workspace.id }
    }
    return state
  }

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // 已提交的 Storage mutation 不因单个 Display/watch 回调异常而反转。
      }
    }
  }

  function publishInvalidation(): void {
    try {
      deps.invalidation.publish()
    } catch {
      // 广播是 best effort；耐久提交已完成时不能改报失败。
    }
  }

  function encodeEnvelope(next: WorkspacesState, nextRevision: bigint): string {
    return JSON.stringify({
      ...publicState(next),
      _revision: String(nextRevision),
    } satisfies PersistedWorkspacesEnvelope)
  }

  function persistEnvelope(next: WorkspacesState, nextRevision: bigint): string {
    const raw = encodeEnvelope(next, nextRevision)
    const storage = deps.storage()
    if (!storage) throw new Error("Workspace durable storage is unavailable")
    storage.setItem(AGENT_WORKSPACES_STORAGE_KEY, raw)
    return raw
  }

  function accept(
    next: WorkspacesState,
    nextRevision: bigint,
    durableToken: string,
    markSecureHydrated = true,
  ): void {
    const previous = ensure()
    const changed = !sameState(previous, next)
    const revisionChanged = nextRevision !== revision
    state = next
    revision = nextRevision
    lastDurableToken = durableToken
    secureHydrated ||= markSecureHydrated
    if (markSecureHydrated) credentialRecoveryRequired = false
    workspaceApiKeyCache.clear()
    for (const workspace of next.workspaces) {
      const target = modelEndpoint(workspace.model.baseURL)
      if (!workspace.model.useGlobal && target && workspace.model.apiKey) {
        workspaceApiKeyCache.set(workspace.id, { target, apiKey: workspace.model.apiKey })
      }
    }
    if (changed || revisionChanged) notify()
  }

  function failClosedCredentialCache(): void {
    workspaceApiKeyCache.clear()
    secureHydrated = false
    credentialRecoveryRequired = true
    if (!state) return
    const next: WorkspacesState = {
      ...state,
      workspaces: state.workspaces.map((workspace) => ({
        ...workspace,
        model: { ...workspace.model, apiKey: "" },
      })),
    }
    const changed = !sameState(state, next)
    state = next
    if (changed) notify()
  }

  async function hydrateSnapshot(
    value: WorkspacesState,
    envelopeRevision: bigint,
    intendedRevision: () => bigint,
  ): Promise<{
    state: WorkspacesState
    plans: SecurePlan[]
    recoveryRequired: boolean
  }> {
    const plans: SecurePlan[] = []
    let recoveryRequired = false
    const workspaces = await Promise.all(
      value.workspaces.map(async (workspace) => {
        const key = workspaceApiKeySecureKey(workspace.id)
        const secureRaw = await deps.secureGet(key)
        const fallbackRaw = deps.secureFallbackGet(key)
        const secureCredential = parseWorkspaceCredential(secureRaw)
        const fallbackCredential = parseWorkspaceCredential(fallbackRaw)
        // A versioned fallback exists only when native secureSet could not commit. It must shadow
        // a stale native value; a later successful secureSet removes that fallback.
        const authoritativeCredential = fallbackRaw !== null ? fallbackCredential : secureCredential
        const authoritativeRecord =
          authoritativeCredential?.kind === "record" ? authoritativeCredential.record : null
        const legacyRecord =
          authoritativeCredential?.kind === "legacy-record" ? authoritativeCredential.record : null
        const target = workspace.model.useGlobal ? null : modelEndpoint(workspace.model.baseURL)
        const plaintext = workspace.model.apiKey
        const recordAhead =
          authoritativeRecord !== null && BigInt(authoritativeRecord.revision) > envelopeRevision
        let apiKey = ""
        let desired: string | null = null

        if (credentialRecoveryRequired || recordAhead) {
          // secure 先写、公开 envelope 后写。record revision 超前说明上次公开提交未完成；
          // 即使进程已重载也必须 fail-closed，并以同一个 intended revision 完成 tombstone。
          recoveryRequired = true
          desired = encodeWorkspaceCredentialTombstone(intendedRevision())
        } else if (target === null) {
          if (secureRaw !== null || fallbackRaw !== null || plaintext) {
            desired =
              authoritativeRecord?.target === null
                ? encodeWorkspaceCredentialTombstone(BigInt(authoritativeRecord.revision))
                : encodeWorkspaceCredentialTombstone(intendedRevision())
          }
        } else if (authoritativeRecord?.target === target && authoritativeRecord.apiKey) {
          apiKey = authoritativeRecord.apiKey
          desired = encodeWorkspaceCredential(target, apiKey, BigInt(authoritativeRecord.revision))
        } else if (authoritativeRecord) {
          // 已提交 tombstone 与其他 endpoint 的 record 都不得按 workspace id 重新绑定。
          desired =
            authoritativeRecord.target === null
              ? encodeWorkspaceCredentialTombstone(BigInt(authoritativeRecord.revision))
              : encodeWorkspaceCredentialTombstone(intendedRevision())
        } else if (legacyRecord) {
          // v1 没有 crash marker；仅为兼容旧版本，在 canonical 锁内迁移为 v2。
          if (legacyRecord.target === target && legacyRecord.apiKey) {
            apiKey = legacyRecord.apiKey
            desired = encodeWorkspaceCredential(target, apiKey, intendedRevision())
          } else {
            desired = encodeWorkspaceCredentialTombstone(intendedRevision())
          }
        } else if (plaintext) {
          // Persisted plaintext carries its endpoint in the same atomic envelope. Bind and scrub it
          // under the canonical workspace lock, even when the envelope already has a revision.
          apiKey = plaintext
          desired = encodeWorkspaceCredential(target, apiKey, intendedRevision())
        } else {
          const legacy =
            authoritativeCredential?.kind === "legacy" ? authoritativeCredential.apiKey : ""
          if (legacy) {
            apiKey = legacy
            desired = encodeWorkspaceCredential(target, apiKey, intendedRevision())
          } else if (authoritativeCredential?.kind === "invalid") {
            desired = encodeWorkspaceCredentialTombstone(intendedRevision())
          }
        }

        if (
          desired !== null &&
          (secureRaw !== desired || (fallbackRaw !== null && fallbackRaw !== desired))
        ) {
          plans.push({
            key,
            value: desired,
            force: fallbackRaw !== null && secureRaw !== desired,
          })
        }
        return { ...workspace, model: { ...workspace.model, apiKey } }
      }),
    )
    return { state: { ...value, workspaces }, plans, recoveryRequired }
  }

  async function transactSecure(plans: readonly SecurePlan[]): Promise<() => Promise<void>> {
    const desired = new Map<string, { value: string; force: boolean }>()
    for (const plan of plans) {
      const previous = desired.get(plan.key)
      desired.set(plan.key, {
        value: typeof plan.value === "function" ? plan.value() : plan.value,
        force: Boolean(previous?.force || plan.force),
      })
    }
    const previous = new Map<string, string | null>()
    const attempted: string[] = []

    async function restore(): Promise<void> {
      const failures: unknown[] = []
      for (const key of [...attempted].reverse()) {
        try {
          // Absence is restored as a versioned tombstone. This deliberately avoids secureDelete:
          // a failed native delete could otherwise expose an older keychain value again.
          await deps.secureSet(key, previous.get(key) ?? encodeWorkspaceCredentialTombstone(0n))
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Unable to restore workspace credential state")
      }
    }

    try {
      for (const [key, plan] of desired) {
        const secureBefore = await deps.secureGet(key)
        // A fallback is the logical result of a newer failed native write and therefore owns the
        // rollback baseline. Restoring the older native value would resurrect stale credentials.
        const before = deps.secureFallbackGet(key) ?? secureBefore
        previous.set(key, before)
        if (!plan.force && before === plan.value) continue
        attempted.push(key)
        await deps.secureSet(key, plan.value)
      }
    } catch (error) {
      try {
        await restore()
      } catch (rollbackError) {
        failClosedCredentialCache()
        throw new AggregateError(
          [error, rollbackError],
          "Workspace credential mutation and rollback both failed",
        )
      }
      throw error
    }
    return restore
  }

  async function refreshOnce(): Promise<void> {
    ensure()
    while (true) {
      const candidate = readPersisted()
      if (!candidate) return
      if (lastDurableToken !== null) {
        if (candidate.revision < revision) return
        if (candidate.revision === revision && candidate.token !== lastDurableToken) return
      }

      const recoveringCredentials = credentialRecoveryRequired
      let plannedRevision: bigint | undefined
      const intendedRevision = () => {
        plannedRevision ??= incrementRevision(
          revision > candidate.revision ? revision : candidate.revision,
        )
        return plannedRevision
      }
      const hydrated = await hydrateSnapshot(candidate.state, candidate.revision, intendedRevision)
      // secureGet 期间可能有另一窗口提交。只有头尾读到同一原子 envelope 才能发布。
      const tail = readPersisted()
      if (!tail || tail.token !== candidate.token) continue

      const requiresRewrite =
        candidate.needsRewrite ||
        hydrated.plans.length > 0 ||
        hydrated.recoveryRequired ||
        recoveringCredentials
      if (!requiresRewrite) {
        accept(hydrated.state, candidate.revision, candidate.token)
        return
      }

      // 任意 revision 的 plaintext、旧裸 secure 值、target mismatch 与 URL 规范化都必须在
      // canonical 锁内先完成 secure 事务，再以 revision+1 原子擦除/升级公开 envelope。
      // A clean max-revision envelope remains readable. Only a required rewrite consumes another
      // revision, and exhaustion is rejected before the first secure/public mutation.
      const nextRevision = intendedRevision()
      const rollback = await transactSecure(hydrated.plans)
      let token: string
      try {
        token = persistEnvelope(hydrated.state, nextRevision)
      } catch (error) {
        try {
          await rollback()
        } catch (rollbackError) {
          failClosedCredentialCache()
          throw new AggregateError(
            [error, rollbackError],
            "Workspace envelope persistence and credential rollback both failed",
          )
        }
        throw error
      }
      accept(hydrated.state, nextRevision, token)
      publishInvalidation()
      return
    }
  }

  function refreshRaw(): Promise<void> {
    requestedRefresh += 1
    if (synchronization) return synchronization
    synchronization = (async () => {
      while (completedRefresh < requestedRefresh) {
        const target = requestedRefresh
        await refreshOnce()
        completedRefresh = target
      }
    })().finally(() => {
      synchronization = null
    })
    return synchronization
  }

  function refresh(): Promise<void> {
    return deps.withRefreshLock(refreshRaw)
  }

  function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = mutationTail.then(operation, operation)
    mutationTail = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  function credentialPlan(
    workspace: AgentWorkspace,
    apiKey: string,
    intendedRevision: () => bigint,
  ): SecurePlan {
    const target = workspace.model.useGlobal ? null : modelEndpoint(workspace.model.baseURL)
    return {
      key: workspaceApiKeySecureKey(workspace.id),
      value: () =>
        target !== null && apiKey
          ? encodeWorkspaceCredential(target, apiKey, intendedRevision())
          : encodeWorkspaceCredentialTombstone(intendedRevision()),
    }
  }

  function transitionWorkspace(
    current: AgentWorkspace | undefined,
    proposed: AgentWorkspace,
    intendedRevision: () => bigint,
  ): { workspace: AgentWorkspace; plan?: SecurePlan } {
    const workspace = cloneWorkspace(proposed)
    if (workspace.model.useGlobal) {
      workspace.model.apiKey = ""
      return {
        workspace,
        ...((current && (!current.model.useGlobal || current.model.apiKey)) ||
        proposed.model.apiKey ||
        !current
          ? { plan: credentialPlan(workspace, "", intendedRevision) }
          : {}),
      }
    }
    if (modelEndpoint(workspace.model.baseURL) === null) {
      workspace.model.apiKey = ""
      return { workspace, plan: credentialPlan(workspace, "", intendedRevision) }
    }
    if (!current) {
      const apiKey = workspace.model.apiKey
      return {
        workspace,
        plan: credentialPlan(workspace, apiKey, intendedRevision),
      }
    }

    const currentKey = current.model.apiKey
    const currentEndpoint = modelEndpoint(current.model.baseURL)
    const nextEndpoint = modelEndpoint(workspace.model.baseURL)
    const endpointChanged =
      current.model.useGlobal !== workspace.model.useGlobal ||
      currentEndpoint !== nextEndpoint ||
      (currentEndpoint === null && current.model.baseURL !== workspace.model.baseURL)
    if (endpointChanged) {
      if (workspace.model.apiKey && workspace.model.apiKey !== currentKey) {
        return {
          workspace,
          plan: credentialPlan(workspace, workspace.model.apiKey, intendedRevision),
        }
      }
      workspace.model.apiKey = ""
      return { workspace, plan: credentialPlan(workspace, "", intendedRevision) }
    }
    if (workspace.model.apiKey !== currentKey) {
      return {
        workspace,
        plan: credentialPlan(workspace, workspace.model.apiKey, intendedRevision),
      }
    }
    return { workspace }
  }

  async function commitRaw<T>(
    resolve: (
      current: WorkspacesState,
      intendedRevision: () => bigint,
    ) => {
      next: WorkspacesState
      plans?: SecurePlan[]
      result: T
    },
    force = false,
  ): Promise<T> {
    return enqueueMutation(async () => {
      await refreshRaw()
      const current = ensure()
      // The public body may be unreadable while still carrying a valid high revision. Read that
      // monotonic floor independently once a real commit is confirmed. Resolvers and secure plans
      // share one lazy value so no-op calls neither consume nor exhaust revision space, while every
      // credential crash marker still matches the envelope that is actually written.
      let plannedRevision: bigint | undefined
      const intendedRevision = () => {
        plannedRevision ??= nextWriteRevision()
        return plannedRevision
      }
      const resolved = resolve(cloneState(current), intendedRevision)
      if (!force && sameState(current, resolved.next)) return resolved.result

      const nextRevision = intendedRevision()
      const rollback = await transactSecure(resolved.plans ?? [])
      let token: string
      try {
        token = persistEnvelope(resolved.next, nextRevision)
      } catch (error) {
        try {
          await rollback()
        } catch (rollbackError) {
          failClosedCredentialCache()
          throw new AggregateError(
            [error, rollbackError],
            "Workspace envelope persistence and credential rollback both failed",
          )
        }
        throw error
      }
      accept(resolved.next, nextRevision, token)
      publishInvalidation()
      return resolved.result
    })
  }

  function createRaw(name?: string): Promise<AgentWorkspace> {
    return commitRaw((current) => {
      const workspace = makeDefault(name ?? `工作区 ${current.workspaces.length + 1}`)
      return {
        next: { workspaces: [...current.workspaces, workspace], activeId: workspace.id },
        result: workspace,
      }
    })
  }

  function saveRaw(input: AgentWorkspace): Promise<AgentWorkspace> {
    return commitRaw((current, intendedRevision) => {
      const existing = current.workspaces.find((workspace) => workspace.id === input.id)
      const migrated = migrateWorkspace(input, makeDefault)
      const transition = transitionWorkspace(existing, migrated, intendedRevision)
      if (existing && sameWorkspaceIgnoringUpdatedAt(existing, transition.workspace)) {
        return { next: current, result: existing }
      }
      transition.workspace.updatedAt = deps.now()
      const workspaces = existing
        ? current.workspaces.map((workspace) =>
            workspace.id === input.id ? transition.workspace : workspace,
          )
        : [...current.workspaces, transition.workspace]
      return {
        next: { ...current, workspaces },
        plans: transition.plan ? [transition.plan] : [],
        result: transition.workspace,
      }
    })
  }

  function updateRaw(id: string, updater: WorkspaceUpdater): Promise<AgentWorkspace | undefined> {
    return commitRaw((current, intendedRevision) => {
      const existing = current.workspaces.find((workspace) => workspace.id === id)
      if (!existing) return { next: current, result: undefined }
      const proposed = updater(cloneWorkspace(existing))
      proposed.id = existing.id
      proposed.createdAt = existing.createdAt
      const transition = transitionWorkspace(
        existing,
        migrateWorkspace(proposed, makeDefault),
        intendedRevision,
      )
      if (sameWorkspaceIgnoringUpdatedAt(existing, transition.workspace)) {
        return { next: current, result: existing }
      }
      transition.workspace.updatedAt = deps.now()
      return {
        next: {
          ...current,
          workspaces: current.workspaces.map((workspace) =>
            workspace.id === id ? transition.workspace : workspace,
          ),
        },
        plans: transition.plan ? [transition.plan] : [],
        result: transition.workspace,
      }
    })
  }

  function deleteRaw(id: string): Promise<void> {
    return commitRaw((current, intendedRevision) => {
      if (!current.workspaces.some((workspace) => workspace.id === id)) {
        return { next: current, result: undefined }
      }
      const workspaces = current.workspaces.filter((workspace) => workspace.id !== id)
      if (workspaces.length === 0) workspaces.push(makeDefault())
      return {
        next: {
          workspaces,
          activeId: current.activeId === id ? workspaces[0].id : current.activeId,
        },
        plans: [
          {
            key: workspaceApiKeySecureKey(id),
            value: () => encodeWorkspaceCredentialTombstone(intendedRevision()),
          },
        ],
        result: undefined,
      }
    })
  }

  async function renameRaw(id: string, name: string): Promise<void> {
    await updateRaw(id, (workspace) => ({
      ...workspace,
      name: name.trim() || workspace.name,
    }))
  }

  function setActiveRaw(id: string): Promise<void> {
    return commitRaw((current) => ({
      next:
        current.activeId === id || !current.workspaces.some((workspace) => workspace.id === id)
          ? current
          : { ...current, activeId: id },
      result: undefined,
    }))
  }

  function resolvePublicReplacement(
    current: WorkspacesState,
    nextInput: Partial<WorkspacesState>,
    intendedRevision: () => bigint,
  ): { next: WorkspacesState; plans: SecurePlan[]; result: undefined } {
    const existingById = new Map(current.workspaces.map((workspace) => [workspace.id, workspace]))
    const plans: SecurePlan[] = []
    const input = Array.isArray(nextInput.workspaces) ? nextInput.workspaces : []
    const workspaces = input.map((raw) => {
      const workspace = migrateWorkspace(raw, makeDefault)
      const existing = existingById.get(workspace.id)
      const preserveApiKey = Boolean(
        existing &&
        !existing.model.useGlobal &&
        !workspace.model.useGlobal &&
        modelEndpoint(workspace.model.baseURL) !== null &&
        modelEndpoint(workspace.model.baseURL) === modelEndpoint(existing.model.baseURL),
      )
      if (preserveApiKey && existing) {
        workspace.model.apiKey = existing.model.apiKey
      } else {
        const transition = transitionWorkspace(existing, workspace, intendedRevision)
        workspace.model.apiKey = transition.workspace.model.apiKey
        if (transition.plan) plans.push(transition.plan)
      }
      return workspace
    })
    if (workspaces.length === 0) workspaces.push(makeDefault())
    const retained = new Set(workspaces.map((workspace) => workspace.id))
    for (const previous of current.workspaces) {
      if (!retained.has(previous.id)) {
        plans.push({
          key: workspaceApiKeySecureKey(previous.id),
          value: () => encodeWorkspaceCredentialTombstone(intendedRevision()),
        })
      }
    }
    const requestedActiveId = typeof nextInput.activeId === "string" ? nextInput.activeId : ""
    return {
      next: {
        workspaces,
        activeId: workspaces.some((workspace) => workspace.id === requestedActiveId)
          ? requestedActiveId
          : workspaces[0].id,
      },
      plans,
      result: undefined,
    }
  }

  function replacePublicRaw(nextInput: Partial<WorkspacesState>): Promise<void> {
    return commitRaw((current, intendedRevision) =>
      resolvePublicReplacement(current, nextInput, intendedRevision),
    )
  }

  function repairPublicRaw(nextInput: Partial<WorkspacesState>): Promise<void> {
    // 诊断修复必须覆盖 malformed/ABA token；即使正文相同也推进 revision 并广播。
    return commitRaw(
      (current, intendedRevision) => resolvePublicReplacement(current, nextInput, intendedRevision),
      true,
    )
  }

  function startRefreshSources(): void {
    if (stopInvalidation) return
    stopInvalidation = deps.invalidation.subscribe((source) => {
      if (source === "broadcast") void refresh().catch(() => {})
    })
    stopLifecycle = deps.subscribeLifecycle(() => {
      void refresh().catch(() => {})
    })
    void refresh().catch(() => {})
  }

  function stopRefreshSources(): void {
    stopInvalidation?.()
    stopLifecycle?.()
    stopInvalidation = null
    stopLifecycle = null
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    startRefreshSources()
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) stopRefreshSources()
    }
  }

  function resolveWorkspaceModel(workspace: AgentWorkspace): {
    baseURL: string
    model: string
    apiKey: string
  } {
    if (workspace.model.useGlobal) {
      const settings = getAgentSettings()
      return { baseURL: settings.baseURL, model: settings.model, apiKey: settings.apiKey }
    }
    const target = modelEndpoint(workspace.model.baseURL)
    const fallbackRaw = deps.secureFallbackGet(workspaceApiKeySecureKey(workspace.id))
    const fallback = parseWorkspaceCredential(fallbackRaw)
    const cache = workspaceApiKeyCache.get(workspace.id)
    let apiKey = ""
    if (!credentialRecoveryRequired && target !== null) {
      if (fallbackRaw !== null) {
        // fallback 表示比 native/cache 更新的失败写入结果，必须优先；不可信 fallback
        // 直接 fail-closed，不能再退回旧 cache。
        if (
          fallback?.kind === "record" &&
          BigInt(fallback.record.revision) <= revision &&
          fallback.record.target === target
        ) {
          apiKey = fallback.record.apiKey
        }
      } else if (cache?.target === target) {
        apiKey = cache.apiKey
      }
    }
    return {
      baseURL: workspace.model.baseURL,
      model: workspace.model.model,
      // 调用方可能持有旧 render/draft 对象；永不信任其未绑定的 model.apiKey。
      apiKey,
    }
  }

  function securitySnapshot() {
    let localApiKeyCount = 0
    try {
      const raw = deps.storage()?.getItem(AGENT_WORKSPACES_STORAGE_KEY) ?? null
      const parsed = raw ? (JSON.parse(raw) as Partial<PersistedWorkspacesEnvelope>) : null
      const workspaces = Array.isArray(parsed?.workspaces) ? parsed.workspaces : []
      localApiKeyCount = workspaces.filter(
        (workspace) =>
          typeof workspace?.model?.apiKey === "string" && workspace.model.apiKey.trim(),
      ).length
    } catch {
      localApiKeyCount = 0
    }
    return {
      total: ensure().workspaces.length,
      localApiKeyCount,
      secureCachedCount: workspaceApiKeyCache.size,
      secureHydrated,
    }
  }

  return Object.freeze({
    subscribe,
    getState: ensure,
    getServerState: () => SERVER_STATE,
    getActive: () => {
      const current = ensure()
      return (
        current.workspaces.find((workspace) => workspace.id === current.activeId) ??
        current.workspaces[0] ??
        null
      )
    },
    get: (id) => ensure().workspaces.find((workspace) => workspace.id === id),
    revisionSnapshot: () => {
      ensure()
      return String(revision)
    },
    refreshRaw,
    refresh,
    createRaw,
    saveRaw,
    updateRaw,
    deleteRaw,
    renameRaw,
    setActiveRaw,
    replacePublicRaw,
    repairPublicRaw,
    resolveModel: resolveWorkspaceModel,
    securitySnapshot,
    dispose() {
      listeners.clear()
      stopRefreshSources()
    },
  })
}

const workspaceStore = createAgentWorkspaceStore(DEFAULT_DEPS)

// —— 生产同步读取面 ——

export const subscribeWorkspaces = workspaceStore.subscribe
export const getWorkspacesState = workspaceStore.getState
export const getServerWorkspacesState = workspaceStore.getServerState
export const getActiveWorkspace = workspaceStore.getActive
export const getWorkspace = workspaceStore.get
export const agentWorkspacesRevisionSnapshot = workspaceStore.revisionSnapshot

// —— 无锁耐久 Raw 与公开加锁 refresh ——

export const refreshAgentWorkspacesRaw = workspaceStore.refreshRaw
export const refreshAgentWorkspaces = workspaceStore.refresh
export const createWorkspaceRaw = workspaceStore.createRaw
export const saveWorkspaceRaw = workspaceStore.saveRaw
export const updateWorkspaceRaw = workspaceStore.updateRaw
export const deleteWorkspaceRaw = workspaceStore.deleteRaw
export const renameWorkspaceRaw = workspaceStore.renameRaw
export const setActiveWorkspaceRaw = workspaceStore.setActiveRaw
export const replacePublicWorkspacesStateRaw = workspaceStore.replacePublicRaw
export const repairPublicWorkspacesStateRaw = workspaceStore.repairPublicRaw

export const resolveModel = workspaceStore.resolveModel
export const agentWorkspacesSecuritySnapshot = workspaceStore.securitySnapshot

/** Secure 水合与跨窗口公开状态刷新共用 canonical tasks→workspaces 锁链。 */
export function hydrateAgentWorkspaceSecretsSecure(): Promise<void> {
  return refreshAgentWorkspaces()
}

export function isWorkspaceConfigured(workspace: AgentWorkspace): boolean {
  const model = resolveModel(workspace)
  return Boolean(model.apiKey.trim() && model.baseURL.trim() && model.model.trim())
}

export function homeSelectionOf(workspace: AgentWorkspace): HomeSelection | undefined {
  return workspace.data.includeHome ? workspace.data.home : undefined
}

export function workspaceRulesText(workspace: AgentWorkspace): string {
  return activeRulesText(workspace.rules.ruleIds)
}
