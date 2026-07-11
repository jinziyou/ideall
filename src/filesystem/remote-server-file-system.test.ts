import { test } from "node:test"
import assert from "node:assert/strict"
import {
  getServerPort,
  registerServerPort,
  type Info,
  type ServerPort,
} from "@protocol/server-port"
import {
  readRemoteServerFile,
  remoteCommunityDirectoryRef,
  remoteInfoDirectoryRef,
  remoteInfoQueryRef,
  remoteInfoRef,
  remotePeerPublicationsRef,
  remoteServerFileSystem,
  remoteServerRootRef,
  type RemoteInfoQueryResult,
} from "./remote-server-file-system"
import { FileSystemError } from "./types"

const INFO: Info = {
  url: "https://example.test/article",
  title: "文件化远程资讯",
  data: "content",
  language: "zh",
  labels: [],
  publisher: { domain: "example.test", name: "Example", period: 0 },
  collect_time: 2,
  publish_time: 1,
}

function backend(): ServerPort {
  const unused = async () => ({ ok: false as const, message: "unused" })
  return {
    queryInfo: async () => ({ ok: true, data: [INFO] }),
    getRelatedInfo: async () => [],
    getInfo: async () => ({ ok: true, data: INFO }),
    getEntityDetail: async () => null,
    listPeers: async () => ({
      ok: true,
      data: [{ id: 7, name: "Peer", publication_count: 1 }],
    }),
    getPeerPublications: async () => ({
      ok: true,
      data: [{ id: 9, title: "Post", url: "", body: "Body", created_at: 3 }],
    }),
    publish: async (_token, draft) => ({
      ok: true,
      data: {
        id: 10,
        title: draft.title,
        url: draft.url ?? "",
        body: draft.body ?? "",
        created_at: 4,
      },
    }),
    deletePublication: unused,
    getServerPublicKey: unused,
    login: unused,
    register: unused,
    getMe: unused,
    updateProfile: unused,
  }
}

test("remote server filesystem: remote content has stable file refs and directory entries", async (t) => {
  const original = getServerPort()
  t.after(() => registerServerPort(original))
  registerServerPort(backend())

  const root = await remoteServerFileSystem.readDirectory(
    remoteServerRootRef,
    { actor: "ui", permissions: [], intent: "directory" },
    {},
  )
  assert.deepEqual(
    root.entries.map((entry) => entry.target),
    [remoteInfoDirectoryRef, remoteCommunityDirectoryRef],
  )

  const infoPage = await remoteServerFileSystem.readDirectory(
    remoteInfoDirectoryRef,
    { actor: "ui", permissions: [], intent: "directory" },
    { limit: 20 },
  )
  assert.equal(infoPage.entries[0]?.name, INFO.title)
  assert.deepEqual(infoPage.entries[0]?.target, remoteInfoRef(INFO.url))

  const communityPage = await remoteServerFileSystem.readDirectory(
    remoteCommunityDirectoryRef,
    { actor: "ui", permissions: [], intent: "directory" },
    {},
  )
  assert.deepEqual(communityPage.entries[0]?.target, remotePeerPublicationsRef("7"))
})

test("remote server filesystem: info facade reads through provider and enforces actor permission", async (t) => {
  const original = getServerPort()
  t.after(() => registerServerPort(original))
  registerServerPort(backend())

  const result = await readRemoteServerFile<RemoteInfoQueryResult>(remoteInfoQueryRef({}))
  assert.equal(result.ok && result.data?.[0]?.title, INFO.title)

  await assert.rejects(
    remoteServerFileSystem.read(
      remoteInfoRef(INFO.url),
      { actor: "agent", permissions: [], intent: "content" },
      { encoding: "json" },
    ),
    (error: unknown) => error instanceof FileSystemError && error.code === "permission-denied",
  )

  await assert.rejects(
    remoteServerFileSystem.read(
      remoteInfoRef(INFO.url),
      { actor: "engine", permissions: [], intent: "content" },
      { encoding: "json" },
    ),
    (error: unknown) => error instanceof FileSystemError && error.code === "permission-denied",
  )

  const activeRef = remoteInfoRef(INFO.url)
  const activeEngine = await remoteServerFileSystem.read(
    activeRef,
    { actor: "engine", permissions: [], intent: "content", activeFile: activeRef },
    { encoding: "json" },
  )
  assert.equal(
    typeof activeEngine.data === "object" &&
      activeEngine.data !== null &&
      "ok" in activeEngine.data &&
      activeEngine.data.ok,
    true,
  )

  const permitted = await remoteServerFileSystem.read(
    remoteInfoRef(INFO.url),
    { actor: "agent", permissions: ["remote:read"], intent: "content" },
    { encoding: "json" },
  )
  assert.equal(
    typeof permitted.data === "object" &&
      permitted.data !== null &&
      "ok" in permitted.data &&
      permitted.data.ok,
    true,
  )

  await assert.rejects(
    remoteServerFileSystem.read(
      remoteInfoRef(INFO.url),
      { actor: "ui", permissions: [], intent: "content" },
      { range: { start: 0, end: 1 } },
    ),
    (error: unknown) => error instanceof FileSystemError && error.code === "unsupported",
  )
})

test("remote server filesystem: equivalent info queries have one stable file identity", () => {
  const left = remoteInfoQueryRef({
    publisher_domain: "example.test",
    page_size_offset: [20, 0],
  })
  const right = remoteInfoQueryRef({
    page_size_offset: [20, 0],
    publisher_domain: "example.test",
  })
  assert.deepEqual(left, right)
})

test("remote server filesystem: directory cursor advances by the returned item count", async (t) => {
  const original = getServerPort()
  t.after(() => registerServerPort(original))
  const queries: Array<[number, number] | null | undefined> = []
  registerServerPort({
    ...backend(),
    queryInfo: async (query) => {
      queries.push(query.page_size_offset)
      return {
        ok: true,
        data: [INFO, { ...INFO, url: `${INFO.url}/2`, title: "Second" }],
      }
    },
  })

  const first = await remoteServerFileSystem.readDirectory(
    remoteInfoDirectoryRef,
    { actor: "ui", permissions: [], intent: "directory" },
    { limit: 2 },
  )
  assert.equal(first.nextCursor, "2")
  await remoteServerFileSystem.readDirectory(
    remoteInfoDirectoryRef,
    { actor: "ui", permissions: [], intent: "directory" },
    { limit: 2, cursor: first.nextCursor },
  )
  assert.deepEqual(queries, [
    [2, 0],
    [2, 2],
  ])
})
