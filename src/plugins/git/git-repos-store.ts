import {
  createPluginDataPackage,
  parseExpectedPluginDataPackage,
  stringifyPluginDataPackage,
  type PluginDataPackage,
} from "@/plugins/shared/plugin-data"

export const GIT_REPOS_STORAGE_KEY = "ideall:git:repos"
export const MAX_GIT_REPOS = 12
export const GIT_PLUGIN_ID = "git"
export const GIT_PLUGIN_LABEL = "Git"
export const GIT_EXPORT_KIND = "ideall.git.repos"
export const GIT_EXPORT_VERSION = 1
export const GIT_DATA_SPEC = {
  pluginId: GIT_PLUGIN_ID,
  pluginLabel: GIT_PLUGIN_LABEL,
  dataKind: GIT_EXPORT_KIND,
  dataVersion: GIT_EXPORT_VERSION,
} as const

export type GitRepoMount = {
  id: string
  grantId: string | null
  path: string
}
export type GrantedGitRepoMount = GitRepoMount & { grantId: string }
export type RepoStorage = Pick<Storage, "getItem" | "setItem">
export type GitReposPayload = { repos: string[] }
export type GitReposExport = PluginDataPackage<
  GitReposPayload,
  typeof GIT_EXPORT_KIND,
  typeof GIT_EXPORT_VERSION
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function legacyMountId(path: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `legacy:${(hash >>> 0).toString(36)}`
}

function normalizedMount(value: unknown): GitRepoMount | null {
  if (typeof value === "string") {
    const path = value.trim()
    return path ? { id: legacyMountId(path), grantId: null, path } : null
  }
  if (!isRecord(value) || typeof value.path !== "string") return null
  const path = value.path.trim()
  if (!path) return null
  const grantId = typeof value.grantId === "string" ? value.grantId.trim() || null : null
  const id = typeof value.id === "string" ? value.id.trim() : ""
  return { id: id || grantId || legacyMountId(path), grantId, path }
}

export function normalizeGitRepos(value: unknown, limit = MAX_GIT_REPOS): GitRepoMount[] {
  if (!Array.isArray(value)) return []
  const seenIds = new Set<string>()
  const seenGrants = new Set<string>()
  const seenLegacyPaths = new Set<string>()
  const repos: GitRepoMount[] = []
  for (const item of value) {
    const mount = normalizedMount(item)
    if (!mount || seenIds.has(mount.id)) continue
    if (mount.grantId && seenGrants.has(mount.grantId)) continue
    if (!mount.grantId && seenLegacyPaths.has(mount.path)) continue
    seenIds.add(mount.id)
    if (mount.grantId) seenGrants.add(mount.grantId)
    else seenLegacyPaths.add(mount.path)
    repos.push(mount)
    if (repos.length >= limit) break
  }
  return repos
}

export function addGitRepo(
  repos: GitRepoMount[],
  mount: GrantedGitRepoMount,
  limit = MAX_GIT_REPOS,
): GitRepoMount[] {
  return normalizeGitRepos(
    [
      mount,
      ...repos.filter(
        (repo) =>
          repo.id !== mount.id && repo.grantId !== mount.grantId && repo.path !== mount.path,
      ),
    ],
    limit,
  )
}

export function removeGitRepo(repos: GitRepoMount[], mountId: string): GitRepoMount[] {
  return normalizeGitRepos(repos.filter((repo) => repo.id !== mountId))
}

export function loadGitRepos(storage: RepoStorage | undefined = browserStorage()): GitRepoMount[] {
  try {
    return normalizeGitRepos(JSON.parse(storage?.getItem(GIT_REPOS_STORAGE_KEY) ?? "[]"))
  } catch {
    return []
  }
}

export function saveGitRepos(
  repos: GitRepoMount[],
  storage: RepoStorage | undefined = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(GIT_REPOS_STORAGE_KEY, JSON.stringify(normalizeGitRepos(repos)))
    return true
  } catch {
    return false
  }
}

export function createGitReposExport(
  repos: GitRepoMount[],
  exportedAt = new Date().toISOString(),
): GitReposExport {
  const paths = normalizeGitRepos(repos).map((repo) => repo.path)
  return createPluginDataPackage(GIT_DATA_SPEC, { repos: paths }, exportedAt)
}

export function parseGitReposExport(raw: string): GitReposExport {
  const pack = parseExpectedPluginDataPackage(raw, GIT_DATA_SPEC)
  const payload =
    pack.payload && typeof pack.payload === "object" && !Array.isArray(pack.payload)
      ? (pack.payload as { repos?: unknown })
      : {}
  const paths = normalizeGitRepos(payload.repos).map((repo) => repo.path)
  return createPluginDataPackage(GIT_DATA_SPEC, { repos: paths }, pack.exportedAt)
}

export async function exportGitReposJson(): Promise<string> {
  return stringifyPluginDataPackage(createGitReposExport(loadGitRepos()))
}

export async function importGitReposJson(
  raw: string,
  storage: RepoStorage | undefined = browserStorage(),
): Promise<{ repos: number }> {
  const pack = parseGitReposExport(raw)
  const repos = normalizeGitRepos(pack.payload.repos)
  if (!saveGitRepos(repos, storage)) {
    throw new Error("Unable to persist imported Git repositories")
  }
  return { repos: repos.length }
}

export async function inspectGitReposData(): Promise<{
  repos: number
  bytes: number
  updatedAt: number | null
}> {
  const repos = loadGitRepos()
  return {
    repos: repos.length,
    bytes: new TextEncoder().encode(JSON.stringify(repos)).byteLength,
    updatedAt: repos.length ? Date.now() : null,
  }
}

function browserStorage(): RepoStorage | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined
    return localStorage
  } catch {
    return undefined
  }
}
