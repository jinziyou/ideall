import {
  DIRECTORY_MEDIA_TYPE,
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
} from "@/filesystem/types"
import { FileSystemError } from "@/filesystem/types"
import { launchInstalledApp, listInstalledApps, type InstalledApp } from "@/lib/installed-apps"

export const INSTALLED_APPS_FILE_SYSTEM_ID = "third-party.installed-apps"
export const INSTALLED_APP_MEDIA_TYPE = "application/vnd.ideall.installed-app+json"

export const installedAppsRootRef: FileRef = {
  fileSystemId: INSTALLED_APPS_FILE_SYSTEM_ID,
  fileId: "root",
}

export function installedAppFileRef(appId: string): FileRef {
  if (!appId) throw new FileSystemError("invalid-input", "Installed app id cannot be empty")
  return {
    fileSystemId: INSTALLED_APPS_FILE_SYSTEM_ID,
    fileId: `app:${encodeURIComponent(appId)}`,
  }
}

function appIdFromRef(ref: FileRef): string | null {
  if (ref.fileSystemId !== INSTALLED_APPS_FILE_SYSTEM_ID || !ref.fileId.startsWith("app:")) {
    return null
  }
  try {
    return decodeURIComponent(ref.fileId.slice("app:".length)) || null
  } catch {
    return null
  }
}

function snapshotApp(app: InstalledApp): InstalledApp {
  if (!app.id || !app.name) {
    throw new FileSystemError("invalid-input", "Installed app metadata requires id and name")
  }
  return {
    id: app.id,
    name: app.name,
    comment: app.comment ?? null,
    categories: [...app.categories],
    iconPath: app.iconPath ?? null,
  }
}

function appFile(app: InstalledApp): IdeallFile {
  return {
    ref: installedAppFileRef(app.id),
    kind: "file",
    name: app.name,
    mediaType: INSTALLED_APP_MEDIA_TYPE,
    capabilities: ["read", "actions", "apps:launch"],
    source: {
      kind: "third-party",
      id: app.id,
      label: app.name,
      readOnly: true,
    },
    properties: {
      appId: app.id,
      comment: app.comment ?? null,
      categories: [...app.categories],
      iconPath: app.iconPath ?? null,
    },
  }
}

export function installedAppFromFile(file: IdeallFile): InstalledApp | null {
  if (file.ref.fileSystemId !== INSTALLED_APPS_FILE_SYSTEM_ID || file.kind !== "file") return null
  const refAppId = appIdFromRef(file.ref)
  const appId = file.properties?.appId
  const categories = file.properties?.categories
  const comment = file.properties?.comment
  const iconPath = file.properties?.iconPath
  if (
    !refAppId ||
    typeof appId !== "string" ||
    !appId ||
    appId !== refAppId ||
    !Array.isArray(categories) ||
    !categories.every((category) => typeof category === "string")
  ) {
    return null
  }
  return {
    id: appId,
    name: file.name,
    comment: typeof comment === "string" || comment === null ? comment : null,
    categories: [...categories],
    iconPath: typeof iconPath === "string" || iconPath === null ? iconPath : null,
  }
}

export type InstalledAppsFileSystemDeps = {
  listInstalledApps: () => Promise<InstalledApp[]>
  launchInstalledApp: (id: string) => Promise<void>
}

const defaultDeps: InstalledAppsFileSystemDeps = { listInstalledApps, launchInstalledApp }

type ReadIntent = "metadata" | "directory" | "content" | "action"

function assertIntent(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  intent: ReadIntent | "write",
): void {
  if (ctx.intent === intent) return
  throw new FileSystemError(
    "permission-denied",
    `The ${ctx.actor} actor requires ${intent} intent`,
    ref,
  )
}

function assertReadAccess(
  ref: FileRef,
  ctx: FileSystemAccessContext,
  intent: ReadIntent,
  allowActiveEngine = false,
): void {
  assertIntent(ref, ctx, intent)
  if (ctx.actor === "ui") return
  if (
    allowActiveEngine &&
    ctx.actor === "engine" &&
    ctx.activeFile != null &&
    sameFileRef(ref, ctx.activeFile)
  ) {
    return
  }
  if (ctx.permissions.includes("fs:read")) return
  throw new FileSystemError("permission-denied", "Missing fs:read permission", ref)
}

function assertLaunchAccess(ref: FileRef, ctx: FileSystemAccessContext): void {
  assertIntent(ref, ctx, "action")
  if (ctx.actor === "ui" || ctx.permissions.includes("apps:launch")) return
  throw new FileSystemError("permission-denied", "Missing apps:launch permission", ref)
}

function parseOffset(ref: FileRef, cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^(0|[1-9]\d*)$/.test(cursor)) {
    throw new FileSystemError("invalid-input", `Invalid app directory cursor: ${cursor}`, ref)
  }
  return Number(cursor)
}

function pageLimit(ref: FileRef, limit: number | undefined, total: number): number {
  if (limit === undefined) return total
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new FileSystemError("invalid-input", "App directory limit must be positive", ref)
  }
  return limit
}

function readMetadata(
  ref: FileRef,
  app: InstalledApp,
  options: FileReadOptions = {},
): FileReadResult {
  const data = snapshotApp(app)
  const json = JSON.stringify(data)
  const bytes = new TextEncoder().encode(json)
  if ((options.encoding === undefined || options.encoding === "json") && options.range) {
    throw new FileSystemError("invalid-input", "JSON metadata reads do not support ranges", ref)
  }
  if (options.encoding === undefined || options.encoding === "json") {
    return { data, mediaType: INSTALLED_APP_MEDIA_TYPE, size: bytes.byteLength }
  }

  const { start = 0, end = bytes.byteLength } = options.range ?? {}
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < start) {
    throw new FileSystemError("invalid-input", "Invalid installed app read range", ref)
  }
  const sliced = bytes.slice(start, end)
  return {
    data: options.encoding === "text" ? new TextDecoder().decode(sliced) : sliced,
    mediaType: INSTALLED_APP_MEDIA_TYPE,
    size: sliced.byteLength,
  }
}

export function createInstalledAppsFileSystem(
  deps: InstalledAppsFileSystemDeps = defaultDeps,
): FileSystemProvider {
  let cache: InstalledApp[] | null = null
  let inflight: Promise<InstalledApp[]> | null = null

  const loadApps = async (refresh = false): Promise<InstalledApp[]> => {
    if (!refresh && cache) return cache
    if (!refresh && inflight) return inflight
    const request = deps.listInstalledApps().then((items) => {
      const seen = new Set<string>()
      const result: InstalledApp[] = []
      for (const item of items) {
        const app = snapshotApp(item)
        if (seen.has(app.id)) continue
        seen.add(app.id)
        result.push(app)
      }
      cache = result
      return result
    })
    inflight = request
    try {
      return await request
    } finally {
      if (inflight === request) inflight = null
    }
  }

  const findApp = async (ref: FileRef): Promise<InstalledApp | null> => {
    const appId = appIdFromRef(ref)
    if (!appId) return null
    return (await loadApps()).find((app) => app.id === appId) ?? null
  }

  const requireApp = async (ref: FileRef): Promise<InstalledApp> => {
    const app = await findApp(ref)
    if (app) return app
    throw new FileSystemError("not-found", "Installed app not found", ref)
  }

  return {
    descriptor: {
      fileSystemId: INSTALLED_APPS_FILE_SYSTEM_ID,
      name: "本机应用",
      root: installedAppsRootRef,
      source: {
        kind: "third-party",
        id: "installed-apps",
        label: "本机应用",
        readOnly: true,
      },
      capabilities: ["read-directory", "read", "actions", "apps:launch"],
    },
    async stat(ref, ctx) {
      assertReadAccess(ref, ctx, "metadata")
      if (sameFileRef(ref, installedAppsRootRef)) {
        return {
          ref,
          kind: "directory",
          name: "本机应用",
          mediaType: DIRECTORY_MEDIA_TYPE,
          capabilities: ["read-directory", "actions"],
          source: this.descriptor.source,
        }
      }
      const app = await findApp(ref)
      return app ? appFile(app) : null
    },
    async readDirectory(ref, ctx, options = {}): Promise<DirectoryPage> {
      assertReadAccess(ref, ctx, "directory")
      if (!sameFileRef(ref, installedAppsRootRef)) {
        throw new FileSystemError("unsupported", "Installed app is not a directory", ref)
      }
      const apps = await loadApps(options.cursor === undefined)
      const offset = parseOffset(ref, options.cursor)
      const limit = pageLimit(ref, options.limit, apps.length)
      const page = apps.slice(offset, offset + limit)
      const nextOffset = offset + page.length
      return {
        entries: page.map((app, index) => ({
          entryId: installedAppFileRef(app.id).fileId,
          parent: installedAppsRootRef,
          target: installedAppFileRef(app.id),
          name: app.name,
          kind: "child",
          sortKey: String(offset + index).padStart(6, "0"),
        })),
        nextCursor: nextOffset < apps.length ? String(nextOffset) : undefined,
      }
    },
    async read(ref, ctx, options): Promise<FileReadResult> {
      assertReadAccess(ref, ctx, "content", true)
      return readMetadata(ref, await requireApp(ref), options)
    },
    async write(ref, _input, ctx): Promise<IdeallFile> {
      assertIntent(ref, ctx, "write")
      if (ctx.actor !== "ui" && !ctx.permissions.includes("fs:write")) {
        throw new FileSystemError("permission-denied", "Missing fs:write permission", ref)
      }
      throw new FileSystemError("unsupported", "Installed app metadata is read-only", ref)
    },
    async actions(ref, ctx): Promise<FileAction[]> {
      assertReadAccess(ref, ctx, "action")
      if (sameFileRef(ref, installedAppsRootRef)) return []
      await requireApp(ref)
      return [
        {
          id: "launch",
          label: "启动",
          requires: ["apps:launch"],
          kind: "invoke",
          risk: "caution",
          idempotent: false,
          uiHints: {
            confirmDescription: "将启动本机安装的应用。",
          },
        },
      ]
    },
    async invoke(ref, action, _input, ctx): Promise<unknown> {
      if (action !== "launch") {
        assertReadAccess(ref, ctx, "action")
        await requireApp(ref)
        throw new FileSystemError("unsupported", `Unsupported installed app action: ${action}`, ref)
      }
      assertLaunchAccess(ref, ctx)
      const app = await requireApp(ref)
      await deps.launchInstalledApp(app.id)
      return { ref, appId: app.id, launched: true }
    },
  }
}

export const installedAppsFileSystem = createInstalledAppsFileSystem()

let mounted = false

export function registerInstalledAppsFileSystem(
  mount: (provider: FileSystemProvider) => void,
): void {
  if (mounted) return
  mount(installedAppsFileSystem)
  mounted = true
}
