import assert from "node:assert/strict"
import { test } from "node:test"
import { FileSystemError } from "@/filesystem/types"
import { bytesToBase64 } from "@/lib/base64"
import type { GuardedFsEntry } from "@/lib/guarded-fs"
import type { GitSnapshot } from "./git-commands"
import { GIT_ACTIONS, createGitFileSystem, type GitFileSystemDeps } from "./git-file-system"
import { gitManifest } from "./manifest"
import type { GitRepoMount } from "./git-repos-store"
import { importGitReposJsonWithWriteLocks } from "./git-write-adapter"

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
        refs: [],
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

test("git filesystem: repository root version covers the complete semantic snapshot", async () => {
  const deps = fakeDeps()
  const guardedStat = deps.stat
  let guardedRootVersion = "inode-v1"
  deps.stat = async (grantId, entryId) =>
    entryId ? guardedStat(grantId, entryId) : entry("repo", "", "directory", guardedRootVersion)

  const baseSnapshot: GitSnapshot = {
    repoPath: FIRST_MOUNT.path,
    branch: "main",
    upstream: "origin/main",
    files: [{ status: "M", path: "src/main.ts" }],
    log: ["abc123 (HEAD -> main) base"],
    remotes: ["origin\thttps://example.test/repo.git (fetch)"],
    refs: [
      { refname: "refs/heads/main", objectname: "a".repeat(40) },
      { refname: "refs/remotes/origin/main", objectname: "a".repeat(40) },
      { refname: "refs/remotes/fork/release", objectname: "b".repeat(40) },
      { refname: "refs/tags/v1", objectname: "c".repeat(40) },
    ],
    diffStat: " src/main.ts | 1 +",
    statusRaw: "## main...origin/main\n M src/main.ts",
  }
  let snapshot = baseSnapshot
  deps.loadSnapshot = async (path) => ({
    ...snapshot,
    repoPath: path,
    files: snapshot.files.map((file) => ({ ...file })),
    log: [...snapshot.log],
    remotes: [...snapshot.remotes],
    refs: snapshot.refs.map((ref) => ({ ...ref })),
  })

  const fs = createGitFileSystem(deps)
  const repo = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target
  const metadataCtx = { actor: "ui", permissions: [], intent: "metadata" } as const
  const contentCtx = { actor: "ui", permissions: [], intent: "content" } as const
  const initial = await fs.stat(repo, metadataCtx)
  const initialRead = await fs.read(repo, contentCtx)
  assert.ok(initial?.version)
  assert.match(initial.version, /^git-snapshot:[0-9a-f]{64}$/)
  assert.equal(initialRead.version, initial.version)

  guardedRootVersion = "inode-v2"
  assert.equal((await fs.stat(repo, metadataCtx))?.version, initial.version)

  const variants: Array<[string, GitSnapshot]> = [
    ["branch", { ...baseSnapshot, branch: "feature/semantic-version" }],
    ["upstream", { ...baseSnapshot, upstream: "fork/main" }],
    ["files", { ...baseSnapshot, files: [{ status: "A", path: "src/created.ts" }] }],
    ["log", { ...baseSnapshot, log: ["def456 next"] }],
    ["remotes", { ...baseSnapshot, remotes: ["fork\tssh://example.test/repo.git (fetch)"] }],
    [
      "non-current remote ref",
      {
        ...baseSnapshot,
        refs: baseSnapshot.refs.map((ref) =>
          ref.refname === "refs/remotes/fork/release"
            ? { ...ref, objectname: "d".repeat(40) }
            : ref,
        ),
      },
    ],
    ["diffStat", { ...baseSnapshot, diffStat: " src/main.ts | 2 ++" }],
    ["statusRaw", { ...baseSnapshot, statusRaw: "## main...origin/main\nA  src/created.ts" }],
  ]
  for (const [field, variant] of variants) {
    snapshot = variant
    assert.notEqual(
      (await fs.stat(repo, metadataCtx))?.version,
      initial.version,
      `${field} must participate in the root version`,
    )
  }

  snapshot = { ...baseSnapshot, files: baseSnapshot.files.map((file) => ({ ...file })) }
  assert.equal((await fs.read(repo, contentCtx)).version, initial.version)
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
  const rootWatch = fs.watch?.(
    fs.descriptor.root,
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => rootEvents.push(event.type),
  )
  const repoWatch = fs.watch?.(repo, { actor: "ui", permissions: [], intent: "watch" }, (event) =>
    repoEvents.push(event.type),
  )
  const sourceWatch = fs.watch?.(
    source,
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => sourceEvents.push(event.type),
  )
  assert.ok(rootWatch)
  assert.ok(repoWatch)
  assert.ok(sourceWatch)

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
  rootWatch.dispose()
  repoWatch.dispose()
  sourceWatch.dispose()
})

test("git filesystem: child writes and repository actions share the repository lock", async () => {
  const deps = fakeDeps()
  let releaseWrite!: () => void
  const writeMayFinish = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  let markWriteStarted!: () => void
  const writeStarted = new Promise<void>((resolve) => {
    markWriteStarted = resolve
  })
  deps.writeText = async (_grantId, entryId, content, expectedVersion) => {
    deps.writes.push({ entryId, content, expectedVersion })
    markWriteStarted()
    await writeMayFinish
    return entry("main.ts", "src/main.ts", "file", "v2")
  }
  const fs = createGitFileSystem(deps)
  const directoryCtx = { actor: "ui", permissions: [], intent: "directory" } as const
  const repo = (await fs.readDirectory(fs.descriptor.root, directoryCtx)).entries[0].target
  const src = (await fs.readDirectory(repo, directoryCtx)).entries.find(
    (item) => item.name === "src",
  )
  assert.ok(src)
  const source = (await fs.readDirectory(src.target, directoryCtx)).entries[0].target

  const write = fs.write(
    source,
    { data: "next", expectedVersion: "v1" },
    { actor: "ui", permissions: [], intent: "write" },
  )
  await writeStarted
  const fetch = fs.invoke(repo, GIT_ACTIONS.fetch, undefined, {
    actor: "ui",
    permissions: [],
    intent: "action",
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(deps.commands, [], "repo action must wait for the in-flight child write")

  releaseWrite()
  await Promise.all([write, fetch])
  assert.deepEqual(deps.commands, [`fetch:${FIRST_MOUNT.path}`])
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

test("git filesystem: repository actions enforce their fresh root expectedVersion", async () => {
  const deps = fakeDeps()
  const fs = createGitFileSystem(deps)
  const repo = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target
  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const
  const metadataCtx = { actor: "ui", permissions: [], intent: "metadata" } as const
  const currentVersion = (await fs.stat(repo, metadataCtx))?.version
  assert.ok(currentVersion)

  const loadSnapshot = deps.loadSnapshot
  deps.loadSnapshot = async () => {
    throw new Error("undefined expectedVersion must not trigger a semantic snapshot read")
  }
  await fs.invoke(repo, GIT_ACTIONS.fetch, undefined, actionCtx)
  assert.deepEqual(deps.commands, [`fetch:${FIRST_MOUNT.path}`])
  deps.commands.length = 0
  deps.loadSnapshot = loadSnapshot

  for (const [action, input] of [
    [GIT_ACTIONS.fetch, undefined],
    [GIT_ACTIONS.pull, undefined],
    [GIT_ACTIONS.push, undefined],
    [GIT_ACTIONS.createBranch, { name: "stale" }],
    [GIT_ACTIONS.commit, { message: "stale" }],
    [GIT_ACTIONS.delete, undefined],
  ] as const) {
    await assert.rejects(
      fs.invoke(repo, action, input, actionCtx, { expectedVersion: `${currentVersion}:stale` }),
      (error) => error instanceof FileSystemError && error.code === "conflict",
    )
  }
  await assert.rejects(
    fs.invoke(repo, GIT_ACTIONS.delete, undefined, actionCtx, { expectedVersion: null }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(deps.commands, [])
  assert.deepEqual(deps.revocations, [])
  assert.deepEqual(deps.loadRepos(), [FIRST_MOUNT])

  await fs.invoke(repo, GIT_ACTIONS.commit, { message: "ship" }, actionCtx, {
    expectedVersion: currentVersion,
  })
  assert.deepEqual(deps.commands, [`commit:${FIRST_MOUNT.path}:ship`])
  await fs.invoke(repo, GIT_ACTIONS.delete, undefined, actionCtx, {
    expectedVersion: currentVersion,
  })
  assert.deepEqual(deps.revocations, [FIRST_MOUNT.grantId])
  assert.deepEqual(deps.loadRepos(), [])
})

test("git filesystem: a non-current remote-tracking ref invalidates the root action token", async () => {
  const deps = fakeDeps()
  let snapshot: GitSnapshot = {
    ...(await deps.loadSnapshot(FIRST_MOUNT.path)),
    upstream: "origin/main",
    refs: [
      { refname: "refs/heads/main", objectname: "a".repeat(40) },
      { refname: "refs/remotes/origin/main", objectname: "a".repeat(40) },
      { refname: "refs/remotes/fork/release", objectname: "b".repeat(40) },
    ],
  }
  deps.loadSnapshot = async (path) => ({
    ...snapshot,
    repoPath: path,
    refs: snapshot.refs.map((ref) => ({ ...ref })),
  })
  const fs = createGitFileSystem(deps)
  const repo = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target
  const metadataCtx = { actor: "ui", permissions: [], intent: "metadata" } as const
  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const
  const staleVersion = (await fs.stat(repo, metadataCtx))?.version
  assert.ok(staleVersion)

  snapshot = {
    ...snapshot,
    refs: snapshot.refs.map((ref) =>
      ref.refname === "refs/remotes/fork/release" ? { ...ref, objectname: "c".repeat(40) } : ref,
    ),
  }

  assert.notEqual((await fs.stat(repo, metadataCtx))?.version, staleVersion)
  await assert.rejects(
    fs.invoke(repo, GIT_ACTIONS.fetch, undefined, actionCtx, {
      expectedVersion: staleVersion,
    }),
    (error) => error instanceof FileSystemError && error.code === "conflict",
  )
  assert.deepEqual(deps.commands, [])
})

test("git data import waits for in-flight repository actions and is the manifest route", async () => {
  const deps = fakeDeps()
  let releaseAction!: () => void
  const actionMayFinish = new Promise<void>((resolve) => {
    releaseAction = resolve
  })
  let markActionStarted!: () => void
  const actionStarted = new Promise<void>((resolve) => {
    markActionStarted = resolve
  })
  const events: string[] = []
  deps.runAction = async () => {
    events.push("action:start")
    markActionStarted()
    await actionMayFinish
    events.push("action:end")
    return { command: "git fetch", stdout: "ok", stderr: "", code: 0 }
  }
  const fs = createGitFileSystem(deps)
  const repo = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target
  const action = fs.invoke(repo, GIT_ACTIONS.fetch, undefined, {
    actor: "ui",
    permissions: [],
    intent: "action",
  })
  await actionStarted

  const imported = importGitReposJsonWithWriteLocks(
    "git-package",
    async (raw) => {
      assert.equal(raw, "git-package")
      events.push("import")
      return { repos: 0 }
    },
    deps.loadRepos,
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ["action:start"])

  releaseAction()
  await Promise.all([action, imported])
  assert.deepEqual(events, ["action:start", "action:end", "import"])
  assert.equal(gitManifest.dataPorts[0]?.importJson, importGitReposJsonWithWriteLocks)
})

test("git data-port import invalidates open root, repository and child displays only on success", async () => {
  const deps = fakeDeps()
  const fs = createGitFileSystem(deps)
  const directoryCtx = { actor: "ui", permissions: [], intent: "directory" } as const
  const watchCtx = { actor: "ui", permissions: [], intent: "watch" } as const
  const repo = (await fs.readDirectory(fs.descriptor.root, directoryCtx)).entries[0].target
  const sourceDirectory = (await fs.readDirectory(repo, directoryCtx)).entries.find(
    (entry) => entry.name === "src",
  )
  assert.ok(sourceDirectory)
  const source = (await fs.readDirectory(sourceDirectory.target, directoryCtx)).entries[0].target
  const rootEvents: string[] = []
  const repoEvents: string[] = []
  const sourceEvents: string[] = []
  const rootWatch = fs.watch?.(fs.descriptor.root, watchCtx, (event) =>
    rootEvents.push(`${event.type}:${event.ref.fileId}`),
  )
  const repoWatch = fs.watch?.(repo, watchCtx, (event) =>
    repoEvents.push(`${event.type}:${event.ref.fileId}`),
  )
  const sourceWatch = fs.watch?.(source, watchCtx, (event) =>
    sourceEvents.push(`${event.type}:${event.ref.fileId}`),
  )
  assert.ok(rootWatch)
  assert.ok(repoWatch)
  assert.ok(sourceWatch)

  const result = await importGitReposJsonWithWriteLocks(
    "git-package",
    async () => ({ repos: 1 }),
    deps.loadRepos,
  )
  assert.deepEqual(result, { repos: 1 })
  assert.deepEqual(rootEvents, [`changed:${fs.descriptor.root.fileId}`])
  assert.deepEqual(repoEvents, [`changed:${repo.fileId}`])
  assert.deepEqual(sourceEvents, [`changed:${source.fileId}`])

  await assert.rejects(
    importGitReposJsonWithWriteLocks(
      "broken-package",
      async () => {
        throw new Error("git import rejected")
      },
      deps.loadRepos,
    ),
    /git import rejected/,
  )
  assert.equal(rootEvents.length, 1)
  assert.equal(repoEvents.length, 1)
  assert.equal(sourceEvents.length, 1)

  rootWatch.dispose()
  repoWatch.dispose()
  sourceWatch.dispose()
})

test("git filesystem: concurrent repository actions serialize version checks with mutations", async () => {
  const deps = fakeDeps()
  let snapshot = await deps.loadSnapshot(FIRST_MOUNT.path)
  deps.loadSnapshot = async (path) => ({
    ...snapshot,
    repoPath: path,
    files: snapshot.files.map((file) => ({ ...file })),
    log: [...snapshot.log],
    remotes: [...snapshot.remotes],
    refs: snapshot.refs.map((ref) => ({ ...ref })),
  })

  let releaseFirst!: () => void
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let markFirstStarted!: () => void
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve
  })
  let actionRuns = 0
  deps.runAction = async (root, action) => {
    actionRuns += 1
    deps.commands.push(`${action}:${root}`)
    if (actionRuns === 1) {
      markFirstStarted()
      await firstMayFinish
      snapshot = {
        ...snapshot,
        branch: "after-fetch",
        statusRaw: "## after-fetch",
      }
    }
    return { command: `git ${action}`, stdout: "ok", stderr: "", code: 0 }
  }

  const fs = createGitFileSystem(deps)
  const repo = (
    await fs.readDirectory(fs.descriptor.root, {
      actor: "ui",
      permissions: [],
      intent: "directory",
    })
  ).entries[0].target
  const actionCtx = { actor: "ui", permissions: [], intent: "action" } as const
  const expectedVersion = (
    await fs.stat(repo, { actor: "ui", permissions: [], intent: "metadata" })
  )?.version
  assert.ok(expectedVersion)

  const first = fs.invoke(repo, GIT_ACTIONS.fetch, undefined, actionCtx, {
    expectedVersion,
  })
  await firstStarted
  const second = fs.invoke(repo, GIT_ACTIONS.fetch, undefined, actionCtx, {
    expectedVersion,
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  releaseFirst()

  const [firstResult, secondResult] = await Promise.allSettled([first, second])
  assert.equal(firstResult.status, "fulfilled")
  assert.equal(secondResult.status, "rejected")
  assert.ok(secondResult.reason instanceof FileSystemError)
  assert.equal(secondResult.reason.code, "conflict")
  assert.equal(actionRuns, 1)
  assert.deepEqual(deps.commands, [`fetch:${FIRST_MOUNT.path}`])
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
  const childWatch = fs.watch?.(
    secondChild,
    { actor: "ui", permissions: [], intent: "watch" },
    (event) => childEvents.push(event.type),
  )
  assert.ok(childWatch)

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
  childWatch.dispose()
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
