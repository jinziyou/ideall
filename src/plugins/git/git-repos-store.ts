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

export type RepoStorage = Pick<Storage, "getItem" | "setItem">
export type GitReposPayload = { repos: string[] }
export type GitReposExport = PluginDataPackage<
  GitReposPayload,
  typeof GIT_EXPORT_KIND,
  typeof GIT_EXPORT_VERSION
>

export function normalizeGitRepos(value: unknown, limit = MAX_GIT_REPOS): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const repos: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const path = item.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    repos.push(path)
    if (repos.length >= limit) break
  }
  return repos
}

export function addGitRepo(repos: string[], repoPath: string, limit = MAX_GIT_REPOS): string[] {
  const path = repoPath.trim()
  if (!path) return normalizeGitRepos(repos, limit)
  return normalizeGitRepos([path, ...repos.filter((repo) => repo !== path)], limit)
}

export function removeGitRepo(repos: string[], repoPath: string): string[] {
  return normalizeGitRepos(repos.filter((repo) => repo !== repoPath))
}

export function loadGitRepos(storage: RepoStorage | undefined = browserStorage()): string[] {
  try {
    return normalizeGitRepos(JSON.parse(storage?.getItem(GIT_REPOS_STORAGE_KEY) ?? "[]"))
  } catch {
    return []
  }
}

export function saveGitRepos(
  repos: string[],
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
  repos: string[],
  exportedAt = new Date().toISOString(),
): GitReposExport {
  return createPluginDataPackage(GIT_DATA_SPEC, { repos: normalizeGitRepos(repos) }, exportedAt)
}

export function parseGitReposExport(raw: string): GitReposExport {
  const pack = parseExpectedPluginDataPackage(raw, GIT_DATA_SPEC)
  const payload =
    pack.payload && typeof pack.payload === "object" && !Array.isArray(pack.payload)
      ? (pack.payload as { repos?: unknown })
      : {}
  return createGitReposExport(normalizeGitRepos(payload.repos), pack.exportedAt)
}

export async function exportGitReposJson(): Promise<string> {
  return stringifyPluginDataPackage(createGitReposExport(loadGitRepos()))
}

export async function importGitReposJson(raw: string): Promise<{ repos: number }> {
  const pack = parseGitReposExport(raw)
  const repos = pack.payload.repos
  saveGitRepos(repos)
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
