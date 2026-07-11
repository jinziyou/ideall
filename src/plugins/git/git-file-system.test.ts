import assert from "node:assert/strict"
import { test } from "node:test"
import { FileSystemError } from "@/filesystem/types"
import { bytesToBase64 } from "@/lib/base64"
import type { GuardedFsEntry } from "@/lib/guarded-fs"
import { GIT_ACTIONS, createGitFileSystem, type GitFileSystemDeps } from "./git-file-system"
import type { GitRepoMount } from "./git-repos-store"

const FIRST_MOUNT: GitRepoMount = {
  id: "mount-first",
  grantId: "grant-first",
  path: "/work/repo",
}
const SECOND_MOUNT: GitRepoMount = {
  id: "mount-second",
  grantId: "grant-second",
  path: "/work/second",
}

function entry(
  name: string,
  relativePath: string,
  kind: GuardedFsEntry["kind"],
  version = "v1",
): GuardedFsEntry {
  return {
    name,
    relativePath,
    stableId: `stable:${relativePath || "root"}`,
    kind,
    size: kind === "file" ? 6 : 0,
    modifiedAt: 10,
    version,
  }
}

function fakeDeps(): GitFileSystemDeps & {
  lists: Record<string, GuardedFsEntry[]>
  repos: GitRepoMount[]
  commands: string[]
  revocations: string[]
  writes: Array<{ content: string; entryId: string; expectedVersion?: string }>
} {
  const state = {
    repos: [FIRST_MOUNT],
    lists: {
      "": [entry("src", "src", "directory"), entry("README.md", "README.md", "file")],
      src: [entry("main.ts", "src/main.ts", "file")],
    } as Record<string, GuardedFsEntry[]>,
    commands: [] as string[],
    revocations: [] as string[],
    writes: [] as Array<{ content: string; entryId: string; expectedVersion?: string }>,
  }
  return {
    ...state,
    addRepo(repos, mount) {
      return [mount, ...repos.filter((repo) => repo.id !== mount.id)]
    },
    async commit(root, message) {
      state.commands.push(`commit:${root}:${message}`)
      return { command: "git commit", stdout: "committed", stderr: "", code: 0 }
    },
    createMountId() {
      return SECOND_MOUNT.id
    },
    async createBranch(root, name) {
      state.commands.push(`branch:${root}:${name}`)
      return { command: "git branch", stdout: "created", stderr: "", code: 0 }
    },
    async grantInfo(grantId) {
      const mount = state.repos.find((repo) => repo.grantId === grantId)
      if (!mount && grantId !== SECOND_MOUNT.grantId)
        throw new Error("filesystem grant unavailable")
      const selected = mount ?? SECOND_MOUNT
      return {
        grantId,
        path: selected.path,
        name: selected.path.split("/").at(-1) ?? selected.path,
      }
    },
    async list(_grantId, entryId) {
      if (!entryId) return state.lists[""]
      const directory = Object.values(state.lists)
        .flat()
        .find((item) => item.stableId === entryId)
      return directory ? (state.lists[directory.relativePath] ?? []) : []
    },
    loadRepos() {
      return state.repos
    },
    async loadSnapshot(path) {
      return {
        repoPath: path,
        branch: "main",
        files: [],
        log: [],
        remotes: [],
        diffStat: "",
        statusRaw: "## main",
      }
    },
    async pickRoot() {
      return {
        grantId: SECOND_MOUNT.grantId!,
        path: SECOND_MOUNT.path,
        name: "second",
      }
    },
    async read(_grantId, _entryId, range) {
      const bytes = new TextEncoder().encode("abcdef").slice(range?.start, range?.end)
      return { base64: bytesToBase64(bytes), size: 6, version: "v1" }
    },
    removeRepo(repos, mountId) {
      return repos.filter((repo) => repo.id !== mountId)
    },
    async revokeGrant(grantId) {
      state.revocations.push(grantId)
      return state.repos.some((repo) => repo.grantId === grantId)
    },
    async runAction(root, action) {
      state.commands.push(`${action}:${root}`)
      return { command: `git ${action}`, stdout: "ok", stderr: "", code: 0 }
    },
    saveRepos(repos) {
      state.repos = repos
      return true
    },
    async stat(_grantId, entryId) {
      if (!entryId) return entry("repo", "", "directory", "root-v1")
      const found = Object.values(state.lists)
        .flat()
        .find((item) => item.stableId === entryId)
      if (!found) throw new Error("filesystem target is unavailable")
      return found
    },
    async writeText(_grantId, entryId, content, expectedVersion) {
      state.writes.push({ entryId, content, expectedVersion })
      const current = await this.stat(_grantId, entryId)
      if (!current) throw new Error("filesystem target is unavailable")
      return { ...current, version: "v2", modifiedAt: 11 }
    },
  }
}

test("git filesystem: exposes guarded repository children with stable identities", async () => {
  const deps = fakeDeps()
  deps.repos.unshift({ id: "legacy", grantId: null, path: "/work/legacy" })
  const fs = createGitFileSystem(deps)
  const directoryCtx = { actor: "ui", permissions: [], intent: "directory" } as const
  const mounts = await fs.readDirectory(fs.descriptor.root, directoryCtx)
  assert.equal(mounts.entries.length, 1)
  const repo = mounts.entries[0].target
  assert.equal(repo.fileId.includes(encodeURIComponent(FIRST_MOUNT.path)), false)
  assert.equal(repo.fileId.includes(FIRST_MOUNT.id), true)
  assert.equal(repo.fileId.includes(FIRST_MOUNT.grantId!), false)
  const first = await fs.readDirectory(repo, directoryCtx)
  deps.lists[""] = [...deps.lists[""]].reverse()
  const second = await fs.readDirectory(repo, directoryCtx)
  const ids = (page: typeof first) =>
    Object.fromEntries(page.entries.map((item) => [item.target.fileId, item.entryId]))
  assert.deepEqual(ids(second), ids(first))

  const src = first.entries.find((item) => item.name === "src")
  assert.ok(src)
  assert.equal(src.entryId.includes("stable%3Asrc"), true)
  const srcStat = await fs.stat(src.target, {
    actor: "ui",
    permissions: [],
    intent: "metadata",
  })
  assert.deepEqual(srcStat?.ref, src.target)
  const nested = await fs.readDirectory(src.target, directoryCtx)
  const source = nested.entries[0].target
  const sourceFile = await fs.stat(source, {
    actor: "ui",
    permissions: [],
    intent: "metadata",
  })
  assert.equal(sourceFile?.mediaType, "text/plain")
  assert.equal(sourceFile?.capabilities.includes("write"), true)
  assert.equal(sourceFile?.version, "v1")

  deps.lists.src[0] = {
    ...deps.lists.src[0],
    name: "renamed.ts",
    relativePath: "src/renamed.ts",
  }
  const renamedFile = await fs.stat(source, {
    actor: "ui",
    permissions: [],
    intent: "metadata",
  })
  assert.deepEqual(renamedFile?.ref, source)
  assert.equal(renamedFile?.name, "renamed.ts")
  assert.equal(
    await fs.stat(
      {
        fileSystemId: source.fileSystemId,
        fileId: `entry:${encodeURIComponent(FIRST_MOUNT.id)}:${encodeURIComponent("stable:missing")}`,
      },
      { actor: "ui", permissions: [], intent: "metadata" },
    ),
    null,
  )
  assert.equal(
    await fs.stat(
      { fileSystemId: source.fileSystemId, fileId: "repo:missing" },
      { actor: "ui", permissions: [], intent: "metadata" },
    ),
    null,
  )

  const read = await fs.read(
    source,
    { actor: "engine", permissions: [], activeFile: source, intent: "content" },
    { encoding: "text", range: { start: 1, end: 4 } },
  )
  assert.equal(read.data, "bcd")
  assert.equal(read.size, 3)
  assert.equal(read.version, "v1")
})

test("git filesystem: guarded text writes enforce version and scoped engine access", async () => {
  const deps = fakeDeps()
  const fs = createGitFileSystem(deps)
  const repo = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target
  const src = (
    await fs.readDirectory(repo, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries.find((item) => item.name === "src")
  assert.ok(src)
  const source = (
    await fs.readDirectory(src.target, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target
  const rootEvents: string[] = []
  const repoEvents: string[] = []
  const sourceEvents: string[] = []
  fs.watch?.(fs.descriptor.root, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    rootEvents.push(event.type),
  )
  fs.watch?.(repo, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    repoEvents.push(event.type),
  )
  fs.watch?.(source, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    sourceEvents.push(event.type),
  )

  await assert.rejects(
    fs.write(
      source,
      { data: "stale", expectedVersion: "old" },
      { actor: "system", permissions: ["fs:write"], intent: "write" },
    ),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.equal(deps.writes.length, 0)
  await assert.rejects(
    fs.write(
      source,
      { data: "blocked" },
      {
        actor: "engine",
        permissions: [],
        activeFile: repo,
        intent: "write",
      },
    ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  await fs.write(
    source,
    { data: "next", expectedVersion: "v1" },
    { actor: "engine", permissions: [], activeFile: source, intent: "write" },
  )
  assert.deepEqual(deps.writes, [
    { entryId: "stable:src/main.ts", content: "next", expectedVersion: "v1" },
  ])
  assert.deepEqual(sourceEvents, ["changed"])
  assert.deepEqual(repoEvents, ["changed"])
  assert.deepEqual(rootEvents, ["changed"])
})

test("git filesystem: delete only unmounts repository roots and requires write permission", async () => {
  const deps = fakeDeps()
  const fs = createGitFileSystem(deps)
  const repo = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target
  const child = (
    await fs.readDirectory(repo, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target

  await assert.rejects(
    fs.invoke(repo, "delete", null, {
      actor: "system",
      permissions: [],
      intent: "action",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  await assert.rejects(
    fs.invoke(child, "delete", null, {
      actor: "system",
      permissions: ["fs:write"],
      intent: "action",
    }),
    (error) => error instanceof FileSystemError && error.code === "unsupported",
  )
  await fs.invoke(repo, "delete", null, {
    actor: "system",
    permissions: ["fs:write"],
    intent: "action",
  })
  assert.deepEqual(deps.loadRepos(), [])
  assert.deepEqual(deps.revocations, [FIRST_MOUNT.grantId])
  assert.equal(fs.descriptor.capabilities?.includes("watch"), true)
})

test("git filesystem: root mount, snapshot and Git commands stay behind file actions", async () => {
  const deps = fakeDeps()
  const fs = createGitFileSystem(deps)
  const contentCtx = { actor: "ui", permissions: [], intent: "content" } as const
  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const
  const rootRead = await fs.read(fs.descriptor.root, contentCtx)
  assert.deepEqual(
    (rootRead.data as { repos: Array<{ path: string }> }).repos.map((repo) => repo.path),
    ["/work/repo"],
  )

  const mounted = await fs.invoke(
    fs.descriptor.root,
    GIT_ACTIONS.mount,
    { path: "/forged/by-js" },
    actionCtx,
  )
  assert.equal((mounted as { path: string }).path, "/work/second")
  assert.deepEqual(deps.loadRepos(), [SECOND_MOUNT, FIRST_MOUNT])
  const second = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries.find((entry) => entry.name === "second")?.target
  assert.ok(second)
  assert.equal((await fs.read(second, contentCtx)).data instanceof Blob, false)

  const secondChild = (
    await fs.readDirectory(second, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target
  const childEvents: string[] = []
  fs.watch?.(secondChild, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    childEvents.push(event.type),
  )

  await fs.invoke(second, GIT_ACTIONS.fetch, undefined, actionCtx)
  await fs.invoke(second, GIT_ACTIONS.pull, undefined, actionCtx)
  await fs.invoke(second, GIT_ACTIONS.push, undefined, actionCtx)
  await fs.invoke(second, GIT_ACTIONS.createBranch, { name: "feature/test" }, actionCtx)
  await fs.invoke(second, GIT_ACTIONS.commit, { message: "ship" }, actionCtx)
  assert.deepEqual(deps.commands, [
    "fetch:/work/second",
    "pull:/work/second",
    "push:/work/second",
    "branch:/work/second:feature/test",
    "commit:/work/second:ship",
  ])
  assert.deepEqual(childEvents, ["changed", "changed", "changed", "changed", "changed"])

  await assert.rejects(
    fs.invoke(
      second,
      GIT_ACTIONS.commit,
      { message: "blocked" },
      {
        actor: "engine",
        permissions: [],
        activeFile: second,
        intent: "action",
      },
    ),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
})

test("git filesystem: a failed re-open does not revoke an existing mount grant", async () => {
  const deps = fakeDeps()
  deps.pickRoot = async () => ({
    grantId: FIRST_MOUNT.grantId!,
    path: FIRST_MOUNT.path,
    name: "repo",
  })
  deps.loadSnapshot = async () => {
    throw new Error("git status failed")
  }
  const fs = createGitFileSystem(deps)

  await assert.rejects(
    fs.invoke(fs.descriptor.root, GIT_ACTIONS.mount, undefined, {
      actor: "ui",
      permissions: [],
      intent: "action",
    }),
    /git status failed/,
  )
  assert.deepEqual(deps.revocations, [])
  assert.deepEqual(deps.loadRepos(), [FIRST_MOUNT])
})
