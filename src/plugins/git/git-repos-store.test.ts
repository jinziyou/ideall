import { test } from "node:test"
import assert from "node:assert/strict"
import {
  GIT_DATA_SPEC,
  GIT_EXPORT_KIND,
  GIT_EXPORT_VERSION,
  GIT_REPOS_STORAGE_KEY,
  addGitRepo,
  createGitReposExport,
  importGitReposJson,
  loadGitRepos,
  normalizeGitRepos,
  parseGitReposExport,
  removeGitRepo,
  saveGitRepos,
  type GrantedGitRepoMount,
  type GitRepoMount,
  type RepoStorage,
} from "./git-repos-store"
import { PLUGIN_DATA_PACKAGE_KIND, PLUGIN_DATA_PACKAGE_VERSION } from "@/plugins/shared/plugin-data"

const REPO_A: GrantedGitRepoMount = { id: "mount-a", grantId: "grant-a", path: "/repo/a" }
const REPO_B: GrantedGitRepoMount = { id: "mount-b", grantId: "grant-b", path: "/repo/b" }

function memoryStorage(
  initial: Record<string, string> = {},
): RepoStorage & { data: Record<string, string> } {
  return {
    data: { ...initial },
    getItem(key) {
      return this.data[key] ?? null
    },
    setItem(key, value) {
      this.data[key] = value
    },
  }
}

test("normalizeGitRepos: keeps structured grants and quarantines legacy path strings", () => {
  const repos = normalizeGitRepos(
    [REPO_A, REPO_A, " /repo/legacy ", "/repo/legacy", REPO_B, { path: "" }],
    3,
  )
  assert.deepEqual(repos.slice(0, 1), [REPO_A])
  assert.equal(repos[1].path, "/repo/legacy")
  assert.equal(repos[1].grantId, null)
  assert.match(repos[1].id, /^legacy:/)
  assert.deepEqual(repos[2], REPO_B)
})

test("add/removeGitRepo: selected grant replaces an unauthorized legacy path", () => {
  const legacy = normalizeGitRepos(["/repo/a", "/repo/b"])
  const added = addGitRepo(legacy, REPO_A)
  assert.deepEqual(added, [REPO_A, legacy[1]])
  assert.deepEqual(addGitRepo(added, REPO_B), [REPO_B, REPO_A])
  assert.deepEqual(removeGitRepo([REPO_B, REPO_A], REPO_A.id), [REPO_B])
})

test("loadGitRepos/saveGitRepos: migrates old strings without implicitly granting them", () => {
  const storage = memoryStorage({
    [GIT_REPOS_STORAGE_KEY]: JSON.stringify(["/repo/a", "/repo/a", "/repo/b"]),
  })
  const legacy = loadGitRepos(storage)
  assert.deepEqual(
    legacy.map((repo) => ({ path: repo.path, grantId: repo.grantId })),
    [
      { path: "/repo/a", grantId: null },
      { path: "/repo/b", grantId: null },
    ],
  )
  assert.equal(saveGitRepos([REPO_A], storage), true)
  assert.equal(storage.data[GIT_REPOS_STORAGE_KEY], JSON.stringify([REPO_A]))

  const broken: RepoStorage = {
    getItem: () => {
      throw new Error("blocked")
    },
    setItem: () => {
      throw new Error("blocked")
    },
  }
  assert.deepEqual(loadGitRepos(broken), [])
  assert.equal(saveGitRepos([REPO_A], broken), false)
})

test("Git repo export strips grant capabilities and imports as unauthorized legacy mounts", () => {
  const pack = createGitReposExport([REPO_A, REPO_B], "now")
  assert.deepEqual(pack, {
    kind: PLUGIN_DATA_PACKAGE_KIND,
    version: PLUGIN_DATA_PACKAGE_VERSION,
    plugin: {
      id: GIT_DATA_SPEC.pluginId,
      label: GIT_DATA_SPEC.pluginLabel,
      dataKind: GIT_EXPORT_KIND,
      dataVersion: GIT_EXPORT_VERSION,
    },
    exportedAt: "now",
    payload: { repos: ["/repo/a", "/repo/b"] },
  })
  const parsed = parseGitReposExport(JSON.stringify(pack))
  assert.deepEqual(parsed.payload.repos, ["/repo/a", "/repo/b"])
  assert.ok(normalizeGitRepos(parsed.payload.repos).every((repo) => repo.grantId === null))
})

test("Git repo import reports persistence failure instead of publishing a false commit", async () => {
  const raw = JSON.stringify(createGitReposExport([REPO_A], "now"))
  const storage = memoryStorage()

  assert.deepEqual(await importGitReposJson(raw, storage), { repos: 1 })
  assert.deepEqual(
    loadGitRepos(storage).map((repo) => repo.path),
    [REPO_A.path],
  )

  await assert.rejects(
    importGitReposJson(raw, {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked")
      },
    }),
    /Unable to persist imported Git/,
  )
})
