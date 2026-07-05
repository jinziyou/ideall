import { test } from "node:test"
import assert from "node:assert/strict"
import {
  GIT_REPOS_STORAGE_KEY,
  addGitRepo,
  loadGitRepos,
  normalizeGitRepos,
  removeGitRepo,
  saveGitRepos,
  type RepoStorage,
} from "./git-repos-store"

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

test("normalizeGitRepos: trim、去重、过滤非字符串并限制数量", () => {
  assert.deepEqual(normalizeGitRepos([" /repo/a ", 1, "", "/repo/a", "/repo/b", "/repo/c"], 2), [
    "/repo/a",
    "/repo/b",
  ])
})

test("add/removeGitRepo: 新仓库置顶并移除指定路径", () => {
  const added = addGitRepo(["/repo/a", "/repo/b"], " /repo/c ")
  assert.deepEqual(added, ["/repo/c", "/repo/a", "/repo/b"])
  assert.deepEqual(addGitRepo(added, "/repo/a"), ["/repo/a", "/repo/c", "/repo/b"])
  assert.deepEqual(removeGitRepo(added, "/repo/a"), ["/repo/c", "/repo/b"])
})

test("loadGitRepos/saveGitRepos: 存储异常时降级为空/false", () => {
  const storage = memoryStorage({
    [GIT_REPOS_STORAGE_KEY]: JSON.stringify(["/repo/a", "/repo/a", "/repo/b"]),
  })
  assert.deepEqual(loadGitRepos(storage), ["/repo/a", "/repo/b"])
  assert.equal(saveGitRepos(["/repo/c"], storage), true)
  assert.equal(storage.data[GIT_REPOS_STORAGE_KEY], JSON.stringify(["/repo/c"]))

  const broken: RepoStorage = {
    getItem: () => {
      throw new Error("blocked")
    },
    setItem: () => {
      throw new Error("blocked")
    },
  }
  assert.deepEqual(loadGitRepos(broken), [])
  assert.equal(saveGitRepos(["/repo/a"], broken), false)
})
