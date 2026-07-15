import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  parseFileRefKey,
  sameFileRef,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type {
  DirectoryPage,
  FileAction,
  FileReadOptions,
  FileReadResult,
  FileSystemAccessContext,
  FileSystemProvider,
  FileSystemWatchEvent,
  FileSystemWatchHandle,
  FileWriteInput,
} from "@/filesystem/types"
import { FileSystemError } from "@/filesystem/types"
import { withFileWriteLock } from "@/filesystem/write-lock"
import {
  GIT_FILE_SYSTEM_ID as BUILTIN_GIT_FILE_SYSTEM_ID,
  GIT_ROOT_REF as BUILTIN_GIT_ROOT_REF,
} from "@/filesystem/builtin-app-roots"
import { base64ToBytes } from "@/lib/base64"
import { fileTypeInfo } from "@/lib/file-type"
import { bytesToHex } from "@/lib/hex"
import { randomId } from "@/lib/id"
import {
  guardedFsGrantInfo,
  guardedFsList,
  guardedFsPickRoot,
  guardedFsRead,
  guardedFsRevokeGrant,
  guardedFsStat,
  guardedFsWriteText,
  type GuardedFsEntry,
  type GuardedFsGrant,
} from "@/lib/guarded-fs"
import {
  commitGit,
  createGitBranch,
  loadGitSnapshot,
  runGitAction,
  type GitAction,
  type GitSnapshot,
} from "./git-commands"
import {
  addGitRepo,
  loadGitRepos,
  removeGitRepo,
  saveGitRepos,
  type GitRepoMount,
  type GrantedGitRepoMount,
} from "./git-repos-store"
import {
  gitRepoFileRef,
  subscribeGitImportInvalidation,
  withGitMountListWriteLock,
} from "./git-write-adapter"

export const GIT_FILE_SYSTEM_ID = BUILTIN_GIT_FILE_SYSTEM_ID
export const GIT_ROOT_REF: FileRef = BUILTIN_GIT_ROOT_REF

export const GIT_ACTIONS = {
  commit: "commit",
  createBranch: "create-branch",
  delete: "delete",
  fetch: "fetch",
  mount: "mount",
  open: "open",
  pull: "pull",
  push: "push",
} as const

type GitTarget = {
  mount: GrantedGitRepoMount
  entryId: string | null
  repoRoot: boolean
}

const repoRef = gitRepoFileRef

function childRef(mountId: string, entryId: string): FileRef {
  return {
    fileSystemId: GIT_FILE_SYSTEM_ID,
    fileId: `entry:${encodeURIComponent(mountId)}:${encodeURIComponent(entryId)}`,
  }
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value) || null
  } catch {
    return null
  }
}

function refParts(
  ref: FileRef,
): { mountId: string; entryId: string | null; repoRoot: boolean } | null {
  if (ref.fileSystemId !== GIT_FILE_SYSTEM_ID) return null
  if (ref.fileId.startsWith("repo:")) {
    const mountId = decode(ref.fileId.slice("repo:".length))
    return mountId ? { mountId, entryId: null, repoRoot: true } : null
  }
  if (!ref.fileId.startsWith("entry:")) return null
  const raw = ref.fileId.slice("entry:".length)
  const delimiter = raw.indexOf(":")
  if (delimiter < 1 || delimiter === raw.length - 1) return null
  const mountId = decode(raw.slice(0, delimiter))
  const entryId = decode(raw.slice(delimiter + 1))
  return mountId && entryId ? { mountId, entryId, repoRoot: false } : null
}

function repoName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path
  )
}

function inferredMediaType(name: string): string {
  const info = fileTypeInfo(name)
  if (info.preview === "svg") return "image/svg+xml"
  if (info.preview === "image") return `image/${info.ext || "*"}`
  if (info.preview === "video") return `video/${info.ext || "*"}`
  if (info.preview === "audio") return `audio/${info.ext || "*"}`
  if (info.preview === "pdf") return "application/pdf"
  if (info.preview === "json") return "application/json"
  if (info.preview === "markdown") return "text/markdown"
  if (info.preview === "csv") return "text/csv"
  if (info.editable) return "text/plain"
  return "application/octet-stream"
}

/**
 * Repository roots are semantic Git documents rather than directory inode projections. Keep the
 * version bound to every field returned by read(repo), while excluding the display-only repoPath.
 */
async function gitSnapshotVersion(snapshot: GitSnapshot): Promise<string> {
  const semanticSnapshot = JSON.stringify([
    snapshot.branch,
    snapshot.upstream ?? null,
    snapshot.files.map((file) => [file.status, file.path]),
    snapshot.log,
    snapshot.remotes,
    snapshot.refs.map((ref) => [ref.refname, ref.objectname]),
    snapshot.diffStat,
    snapshot.statusRaw,
  ])
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error("SHA-256 is unavailable for Git snapshot versioning")
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(semanticSnapshot))
  return `git-snapshot:${bytesToHex(new Uint8Array(digest))}`
}

function repoFile(mount: GrantedGitRepoMount, entry: GuardedFsEntry, version: string): IdeallFile {
  return {
    ref: repoRef(mount.id),
    kind: "directory",
    name: repoName(mount.path),
    mediaType: DIRECTORY_MEDIA_TYPE,
    capabilities: ["read-directory", "read", "delete", "actions", "watch"],
    source: { kind: "local", id: "git", label: "Git 仓库" },
    size: entry.size,
    updatedAt: entry.modifiedAt ?? undefined,
    version,
    properties: { git: true, path: mount.path, mountId: mount.id, explicitGrant: true },
  }
}

function childFile(mount: GrantedGitRepoMount, entry: GuardedFsEntry): IdeallFile {
  const info = fileTypeInfo(entry.name)
  const directory = entry.kind === "directory"
  return {
    ref: childRef(mount.id, entry.stableId),
    kind: entry.kind,
    name: entry.name,
    mediaType: directory ? DIRECTORY_MEDIA_TYPE : inferredMediaType(entry.name),
    capabilities: directory
      ? ["read-directory", "read", "actions", "watch"]
      : ["read", "actions", "watch", ...(info.editable ? (["write"] as const) : [])],
    source: { kind: "local", id: "git", label: "Git 仓库" },
    size: directory ? undefined : entry.size,
    updatedAt: entry.modifiedAt ?? undefined,
    version: entry.version,
    properties: {
      mountId: mount.id,
      stableId: entry.stableId,
      explicitGrant: true,
    },
  }
}

export type GitFileSystemDeps = {
  addRepo: typeof addGitRepo
  commit: typeof commitGit
  createMountId: () => string
  createBranch: typeof createGitBranch
  grantInfo: typeof guardedFsGrantInfo
  list: typeof guardedFsList
  loadRepos: typeof loadGitRepos
  loadSnapshot: typeof loadGitSnapshot
  pickRoot: typeof guardedFsPickRoot
  read: typeof guardedFsRead
  removeRepo: typeof removeGitRepo
  revokeGrant: typeof guardedFsRevokeGrant
  runAction: typeof runGitAction
  saveRepos: typeof saveGitRepos
  stat: typeof guardedFsStat
  writeText: typeof guardedFsWriteText
}

const defaultDeps: GitFileSystemDeps = {
  addRepo: addGitRepo,
  commit: commitGit,
  createMountId: randomId,
  createBranch: createGitBranch,
  grantInfo: guardedFsGrantInfo,
  list: guardedFsList,
  loadRepos: loadGitRepos,
  loadSnapshot: loadGitSnapshot,
  pickRoot: guardedFsPickRoot,
  read: guardedFsRead,
  removeRepo: removeGitRepo,
  revokeGrant: guardedFsRevokeGrant,
  runAction: runGitAction,
  saveRepos: saveGitRepos,
  stat: guardedFsStat,
  writeText: guardedFsWriteText,
}

function requireTarget(ref: FileRef, deps: GitFileSystemDeps): GitTarget {
  const parts = refParts(ref)
  const mount = parts ? deps.loadRepos().find((candidate) => candidate.id === parts.mountId) : null
  if (!parts || !mount?.grantId) {
    throw new FileSystemError("not-found", `Git file not found: ${fileRefKey(ref)}`, ref)
  }
  return {
    mount: { ...mount, grantId: mount.grantId },
    entryId: parts.entryId,
    repoRoot: parts.repoRoot,
  }
}

async function resolveGrantedMount(
  mount: GrantedGitRepoMount,
  deps: GitFileSystemDeps,
): Promise<GrantedGitRepoMount> {
  const grant = await deps.grantInfo(mount.grantId)
  return { ...mount, path: grant.path }
}

async function activeMounts(deps: GitFileSystemDeps): Promise<GrantedGitRepoMount[]> {
  const mounts = await Promise.all(
    deps.loadRepos().map(async (mount) => {
      if (!mount.grantId) return null
      try {
        return await resolveGrantedMount({ ...mount, grantId: mount.grantId }, deps)
      } catch {
        return null
      }
    }),
  )
  return mounts.filter((mount): mount is GrantedGitRepoMount => mount != null)
}

function assertAccess(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  intent: "metadata" | "directory" | "content" | "write" | "action" | "watch",
  permission: "fs:read" | "fs.blobs:read" | "fs:write",
  allowActiveEngine = true,
): void {
  if (ctx.actor === "ui") return
  if (
    allowActiveEngine &&
    ctx.actor === "engine" &&
    ctx.activeFile != null &&
    sameFileRef(ref, ctx.activeFile) &&
    ctx.intent === intent
  ) {
    return
  }
  if (ctx.intent === intent && ctx.permissions.includes(permission)) return
  throw new FileSystemError(
    "permission-denied",
    `The ${ctx.actor} actor requires ${permission} permission and ${intent} intent`,
    ref,
  )
}

function assertExpectedVersion(
  ref: FileRef,
  expectedVersion: string | null | undefined,
  currentVersion: string,
): void {
  if (expectedVersion === undefined || expectedVersion === currentVersion) return
  throw new FileSystemError(
    "conflict",
    `Git file version changed (expected ${expectedVersion ?? "no version"}, current ${currentVersion})`,
    ref,
  )
}

async function resolveRepoActionMount(
  ref: FileRef,
  mount: GrantedGitRepoMount,
  expectedVersion: string | null | undefined,
  deps: GitFileSystemDeps,
): Promise<GrantedGitRepoMount> {
  try {
    const resolved = await resolveGrantedMount(mount, deps)
    if (expectedVersion !== undefined) {
      const snapshot = await deps.loadSnapshot(resolved.path)
      assertExpectedVersion(ref, expectedVersion, await gitSnapshotVersion(snapshot))
    }
    return resolved
  } catch (error) {
    rethrowGuardedError(error, ref)
  }
}

function normalizeRange(ref: FileRef, range: FileReadOptions["range"]): FileReadOptions["range"] {
  if (!range) return undefined
  if (
    !Number.isSafeInteger(range.start) ||
    range.start < 0 ||
    (range.end != null && (!Number.isSafeInteger(range.end) || range.end < range.start))
  ) {
    throw new FileSystemError("invalid-input", "Invalid read range", ref)
  }
  return range
}

function rethrowGuardedError(error: unknown, ref: FileRef): never {
  if (error instanceof FileSystemError) throw error
  const message = error instanceof Error ? error.message : String(error)
  if (message.toLowerCase().includes("version conflict")) {
    throw new FileSystemError("conflict", message, ref)
  }
  if (
    message.includes("escapes") ||
    message.includes("traversal") ||
    message.includes("absolute")
  ) {
    throw new FileSystemError("permission-denied", message, ref)
  }
  if (message.includes("unavailable") || message.includes("not found")) {
    throw new FileSystemError("not-found", message, ref)
  }
  throw new FileSystemError("unavailable", message, ref)
}

function objectInput(ref: FileRef, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new FileSystemError("invalid-input", "Git action input must be an object", ref)
  }
  return input as Record<string, unknown>
}

function stringInput(ref: FileRef, input: unknown, key: string): string {
  const value = objectInput(ref, input)[key]
  if (typeof value !== "string") {
    throw new FileSystemError("invalid-input", `Git action requires ${key}`, ref)
  }
  return value
}

function gitAction(action: string): GitAction | null {
  if (action === GIT_ACTIONS.fetch || action === GIT_ACTIONS.pull || action === GIT_ACTIONS.push) {
    return action
  }
  return null
}

function isMutationAction(action: string): boolean {
  return action !== GIT_ACTIONS.open
}

export function createGitFileSystem(deps: GitFileSystemDeps = defaultDeps): FileSystemProvider {
  const watchers = new Map<string, Set<(event: FileSystemWatchEvent) => void>>()
  const emitOne = (ref: FileRef, type: FileSystemWatchEvent["type"]) => {
    const event: FileSystemWatchEvent = { type, ref }
    for (const notify of watchers.get(fileRefKey(ref)) ?? []) notify(event)
  }
  const emitMutation = (
    ref: FileRef,
    mountId?: string,
    type: FileSystemWatchEvent["type"] = "changed",
  ) => {
    const affected = new Map<string, FileRef>([[fileRefKey(ref), ref]])
    if (mountId) {
      const mountRef = repoRef(mountId)
      affected.set(fileRefKey(mountRef), mountRef)
      for (const key of watchers.keys()) {
        const watchedRef = parseFileRefKey(key)
        if (watchedRef && refParts(watchedRef)?.mountId === mountId) {
          affected.set(key, watchedRef)
        }
      }
    }
    affected.set(fileRefKey(GIT_ROOT_REF), GIT_ROOT_REF)
    for (const affectedRef of affected.values()) {
      emitOne(affectedRef, sameFileRef(affectedRef, ref) ? type : "changed")
    }
  }
  return {
    descriptor: {
      fileSystemId: GIT_FILE_SYSTEM_ID,
      name: "Git 仓库",
      root: GIT_ROOT_REF,
      source: { kind: "local", id: "git", label: "Git 仓库" },
      capabilities: ["read-directory", "read", "write", "delete", "actions", "watch"],
    },
    async stat(ref, ctx) {
      assertAccess(ref, ctx, "metadata", "fs:read")
      if (sameFileRef(ref, GIT_ROOT_REF)) {
        return {
          ref,
          kind: "directory",
          name: "Git 仓库",
          mediaType: "application/vnd.ideall.git.repositories+json",
          capabilities: ["read-directory", "read", "create", "actions", "watch"],
          source: this.descriptor.source,
          properties: { git: true, explicitGrant: true },
        }
      }
      try {
        const target = requireTarget(ref, deps)
        const mount = await resolveGrantedMount(target.mount, deps)
        const entry = await deps.stat(mount.grantId, target.entryId ?? undefined)
        if (!entry) return null
        if (target.repoRoot) {
          const snapshot = await deps.loadSnapshot(mount.path)
          return repoFile(mount, entry, await gitSnapshotVersion(snapshot))
        }
        return childFile(mount, entry)
      } catch (error) {
        if (error instanceof FileSystemError && error.code === "not-found") return null
        const message = error instanceof Error ? error.message : String(error)
        if (
          message.includes("target is unavailable") ||
          message.includes("grant is unavailable") ||
          message.includes("grant root changed") ||
          message.includes("not found")
        )
          return null
        rethrowGuardedError(error, ref)
      }
    },
    async readDirectory(ref, ctx): Promise<DirectoryPage> {
      assertAccess(ref, ctx, "directory", "fs:read")
      if (sameFileRef(ref, GIT_ROOT_REF)) {
        const repos = await activeMounts(deps)
        return {
          entries: repos.map((mount, index) => ({
            entryId: repoRef(mount.id).fileId,
            parent: GIT_ROOT_REF,
            target: repoRef(mount.id),
            name: repoName(mount.path),
            kind: "mount",
            sortKey: String(index).padStart(4, "0"),
          })),
        }
      }
      const target = requireTarget(ref, deps)
      try {
        const mount = await resolveGrantedMount(target.mount, deps)
        const entries = await deps.list(mount.grantId, target.entryId ?? undefined)
        return {
          entries: entries.map((entry, index) => {
            const child = childFile(mount, entry)
            return {
              entryId: `dirent:${encodeURIComponent(mount.id)}:${encodeURIComponent(entry.stableId)}:${encodeURIComponent(entry.name)}`,
              parent: ref,
              target: child.ref,
              name: child.name,
              kind: "child",
              sortKey: String(index).padStart(6, "0"),
            }
          }),
        }
      } catch (error) {
        rethrowGuardedError(error, ref)
      }
    },
    async read(ref, ctx, options?: FileReadOptions): Promise<FileReadResult> {
      if (sameFileRef(ref, GIT_ROOT_REF)) {
        assertAccess(ref, ctx, "content", "fs:read")
        const repos = await activeMounts(deps)
        return {
          data: {
            repos: repos.map((mount) => ({
              id: mount.id,
              path: mount.path,
              ref: repoRef(mount.id),
            })),
          },
          mediaType: "application/vnd.ideall.git.repositories+json",
        }
      }
      const target = requireTarget(ref, deps)
      if (target.repoRoot) {
        assertAccess(ref, ctx, "content", "fs:read")
        const mount = await resolveGrantedMount(target.mount, deps)
        const snapshot = await deps.loadSnapshot(mount.path)
        return {
          data: snapshot,
          mediaType: "application/vnd.ideall.git+json",
          version: await gitSnapshotVersion(snapshot),
        }
      }
      assertAccess(ref, ctx, "content", "fs.blobs:read")
      if (!target.entryId) throw new FileSystemError("not-found", "Git entry not found", ref)
      try {
        const mount = await resolveGrantedMount(target.mount, deps)
        const entry = await deps.stat(mount.grantId, target.entryId)
        if (!entry) throw new FileSystemError("not-found", "Git entry not found", ref)
        if (entry.kind === "directory") {
          return {
            data: { mountId: mount.id, entryId: target.entryId },
            mediaType: DIRECTORY_MEDIA_TYPE,
            version: entry.version,
          }
        }
        const result = await deps.read(
          mount.grantId,
          target.entryId,
          normalizeRange(ref, options?.range),
        )
        const bytes = base64ToBytes(result.base64)
        return {
          data:
            options?.encoding === "text"
              ? new TextDecoder().decode(bytes)
              : { base64: result.base64, size: bytes.byteLength },
          mediaType: inferredMediaType(entry.name),
          size: bytes.byteLength,
          version: result.version,
        }
      } catch (error) {
        rethrowGuardedError(error, ref)
      }
    },
    async write(ref, input: FileWriteInput, ctx) {
      assertAccess(ref, ctx, "write", "fs:write")
      const initialTarget = requireTarget(ref, deps)
      if (initialTarget.repoRoot || typeof input.data !== "string") {
        throw new FileSystemError("unsupported", "Git file writes require text file content", ref)
      }
      const content = input.data
      if (!initialTarget.entryId) throw new FileSystemError("not-found", "Git entry not found", ref)
      // 子文件写会改变 repo snapshot；与 fetch/pull/commit 等共享 repo-root 锁，避免
      // action 在 fresh snapshot 校验后、实际命令前被应用内文本写夹入。
      return withFileWriteLock(repoRef(initialTarget.mount.id), async () => {
        try {
          const target = requireTarget(ref, deps)
          if (target.repoRoot || !target.entryId) {
            throw new FileSystemError("not-found", "Git entry not found", ref)
          }
          const mount = await resolveGrantedMount(target.mount, deps)
          const current = await deps.stat(mount.grantId, target.entryId)
          if (!current) throw new FileSystemError("not-found", "Git entry not found", ref)
          if (current.kind !== "file" || !fileTypeInfo(current.name).editable) {
            throw new FileSystemError("unsupported", "Git file is not text-editable", ref)
          }
          assertExpectedVersion(ref, input.expectedVersion, current.version)
          const updated = await deps.writeText(
            mount.grantId,
            target.entryId,
            content,
            input.expectedVersion ?? undefined,
          )
          emitMutation(ref, mount.id)
          return childFile(mount, updated)
        } catch (error) {
          rethrowGuardedError(error, ref)
        }
      })
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      assertAccess(ref, ctx, "action", "fs:read")
      if (sameFileRef(ref, GIT_ROOT_REF)) {
        return [
          { id: GIT_ACTIONS.open, label: "打开", kind: "display" },
          {
            id: GIT_ACTIONS.mount,
            label: "挂载仓库",
            kind: "invoke",
            risk: "caution",
            idempotent: false,
            requires: ["create"],
            uiHints: { confirmDescription: "将打开系统目录选择器并授权访问所选仓库。" },
          },
        ]
      }
      const target = requireTarget(ref, deps)
      return target.repoRoot
        ? [
            { id: GIT_ACTIONS.open, label: "打开", kind: "display" },
            { id: GIT_ACTIONS.fetch, label: "Fetch", kind: "invoke", idempotent: true },
            {
              id: GIT_ACTIONS.pull,
              label: "Pull",
              kind: "invoke",
              risk: "caution",
              idempotent: false,
            },
            {
              id: GIT_ACTIONS.push,
              label: "Push",
              kind: "invoke",
              risk: "caution",
              idempotent: false,
            },
            {
              id: GIT_ACTIONS.createBranch,
              label: "新建分支",
              kind: "invoke",
              idempotent: false,
              input: {
                type: "object",
                properties: {
                  name: { type: "string", title: "分支名称", minLength: 1 },
                },
                required: ["name"],
                additionalProperties: false,
              },
            },
            {
              id: GIT_ACTIONS.commit,
              label: "提交",
              kind: "invoke",
              risk: "caution",
              idempotent: false,
              input: {
                type: "object",
                properties: {
                  message: { type: "string", title: "提交信息", minLength: 1 },
                },
                required: ["message"],
                additionalProperties: false,
              },
            },
            {
              id: GIT_ACTIONS.delete,
              label: "移除挂载",
              kind: "invoke",
              risk: "destructive",
              idempotent: true,
              requires: ["delete"],
            },
          ]
        : [{ id: GIT_ACTIONS.open, label: "打开", kind: "display" }]
    },
    async invoke(ref, action, input, ctx, options) {
      const mutation = isMutationAction(action)
      assertAccess(ref, ctx, "action", mutation ? "fs:write" : "fs:read", !mutation)
      if (action === GIT_ACTIONS.open) return { ref }
      if (sameFileRef(ref, GIT_ROOT_REF)) {
        if (action !== GIT_ACTIONS.mount) {
          throw new FileSystemError("unsupported", `Unsupported Git action: ${action}`, ref)
        }
        let grant: GuardedFsGrant | null = null
        try {
          grant = await deps.pickRoot()
          if (!grant) return { mounted: false, cancelled: true }
          const root = await deps.stat(grant.grantId)
          if (!root) throw new Error("filesystem grant root is unavailable")
          await deps.loadSnapshot(grant.path)
        } catch (error) {
          const selectedGrantId = grant?.grantId
          const alreadyMounted = selectedGrantId
            ? deps.loadRepos().some((repo) => repo.grantId === selectedGrantId)
            : false
          if (grant && !alreadyMounted) await deps.revokeGrant(grant.grantId).catch(() => false)
          rethrowGuardedError(error, ref)
        }
        if (!grant) throw new FileSystemError("unavailable", "Git grant is unavailable", ref)
        const mount: GrantedGitRepoMount = {
          id: deps.createMountId(),
          grantId: grant.grantId,
          path: grant.path,
        }
        return withGitMountListWriteLock(async () => {
          const currentRepos = deps.loadRepos()
          const existing = currentRepos.find((repo) => repo.grantId === mount.grantId)
          if (existing) {
            const mountedRef = repoRef(existing.id)
            return { ref: mountedRef, id: existing.id, path: mount.path, mounted: true }
          }
          const repos = deps.addRepo(currentRepos, mount)
          if (!deps.saveRepos(repos)) {
            await deps.revokeGrant(mount.grantId).catch(() => false)
            throw new FileSystemError("unavailable", "Unable to persist Git repository mount", ref)
          }
          const mountedRef = repoRef(mount.id)
          emitMutation(mountedRef, undefined, "created")
          return { ref: mountedRef, id: mount.id, path: mount.path, mounted: true }
        })
      }

      const target = requireTarget(ref, deps)
      if (!target.repoRoot) {
        throw new FileSystemError("unsupported", `Unsupported Git action: ${action}`, ref)
      }
      const remoteAction = gitAction(action)
      if (
        action !== GIT_ACTIONS.delete &&
        !remoteAction &&
        action !== GIT_ACTIONS.createBranch &&
        action !== GIT_ACTIONS.commit
      ) {
        throw new FileSystemError("unsupported", `Unsupported Git action: ${action}`, ref)
      }

      const invokeRepoAction = () =>
        withFileWriteLock(ref, async () => {
          const lockedTarget = requireTarget(ref, deps)
          if (!lockedTarget.repoRoot) {
            throw new FileSystemError("unsupported", `Unsupported Git action: ${action}`, ref)
          }
          if (action === GIT_ACTIONS.delete) {
            if (options?.expectedVersion !== undefined) {
              await resolveRepoActionMount(ref, lockedTarget.mount, options.expectedVersion, deps)
            }
            await deps.revokeGrant(lockedTarget.mount.grantId)
            if (!deps.saveRepos(deps.removeRepo(deps.loadRepos(), lockedTarget.mount.id))) {
              throw new FileSystemError("unavailable", "Unable to remove Git repository mount", ref)
            }
            emitMutation(ref, lockedTarget.mount.id, "deleted")
            return { ref, deleted: true }
          }

          const mount = await resolveRepoActionMount(
            ref,
            lockedTarget.mount,
            options?.expectedVersion,
            deps,
          )
          if (remoteAction) {
            const result = await deps.runAction(mount.path, remoteAction)
            emitMutation(ref, mount.id)
            return result
          }
          if (action === GIT_ACTIONS.createBranch) {
            const result = await deps.createBranch(mount.path, stringInput(ref, input, "name"))
            emitMutation(ref, mount.id)
            return result
          }
          if (action === GIT_ACTIONS.commit) {
            const result = await deps.commit(mount.path, stringInput(ref, input, "message"))
            emitMutation(ref, mount.id)
            return result
          }
          throw new FileSystemError("unsupported", `Unsupported Git action: ${action}`, ref)
        })
      return action === GIT_ACTIONS.delete
        ? withGitMountListWriteLock(invokeRepoAction)
        : invokeRepoAction()
    },
    watch(ref, ctx, notify): FileSystemWatchHandle {
      assertAccess(ref, ctx, "watch", "fs:read")
      if (!sameFileRef(ref, GIT_ROOT_REF)) requireTarget(ref, deps)
      const key = fileRefKey(ref)
      const listeners = watchers.get(key) ?? new Set<(event: FileSystemWatchEvent) => void>()
      listeners.add(notify)
      watchers.set(key, listeners)
      const disposeImportWatch = subscribeGitImportInvalidation(() => {
        notify({ type: "changed", ref })
      })
      let disposed = false
      return {
        dispose() {
          if (disposed) return
          disposed = true
          listeners.delete(notify)
          if (listeners.size === 0) watchers.delete(key)
          disposeImportWatch()
        },
      }
    },
  }
}

export const gitFileSystem = createGitFileSystem()

let mounted: (() => void) | null = null

export function registerGitFileSystem(
  mount: (provider: FileSystemProvider) => () => void,
): () => void {
  if (mounted) return () => {}
  const dispose = mount(gitFileSystem)
  mounted = dispose
  return () => {
    if (mounted !== dispose) return
    mounted = null
    dispose()
  }
}
