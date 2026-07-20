import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileRef } from "@protocol/file-system"
import {
  FileSystemError,
  type FileActionInvokeOptions,
  type FileWriteInput,
} from "@/filesystem/types"
import { FileDocumentClient, readFileDocument, type FileDocumentGateway } from "./file-document"

const REF: FileRef = { fileSystemId: "test.documents", fileId: "settings" }

type DocumentValue = { model: string; enabled: boolean }

function decodeDocument(value: unknown): DocumentValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("document must be an object")
  }
  const candidate = value as Partial<DocumentValue>
  if (typeof candidate.model !== "string" || typeof candidate.enabled !== "boolean") {
    throw new Error("invalid document")
  }
  return { model: candidate.model, enabled: candidate.enabled }
}

function memoryGateway(initial: DocumentValue) {
  let value = { ...initial }
  let revision = 1
  let conflictOnce = false
  let readFailure: Error | null = null
  let invocations = 0
  const invocationOptions: Array<FileActionInvokeOptions | undefined> = []
  const writes: FileWriteInput[] = []
  const gateway: FileDocumentGateway = {
    async read() {
      if (readFailure) {
        const error = readFailure
        readFailure = null
        throw error
      }
      return {
        data: { ...value },
        mediaType: "application/json",
        version: `v${revision}`,
      }
    },
    async write(_ref, input) {
      writes.push(input)
      if (conflictOnce) {
        conflictOnce = false
        value = { ...value, model: "external" }
        revision += 1
        throw new FileSystemError("conflict", "changed", REF)
      }
      assert.equal(input.expectedVersion, `v${revision}`)
      value = decodeDocument(input.data)
      revision += 1
      return {
        ref: REF,
        kind: "file",
        name: "settings.json",
        mediaType: "application/json",
        capabilities: ["read", "write"],
        source: { kind: "app", id: "test" },
        version: `v${revision}`,
      }
    },
    async invoke(_ref, action, _input, options) {
      if (action !== "toggle") throw new Error("unknown action")
      invocationOptions.push(options)
      invocations += 1
      value = { ...value, enabled: !value.enabled }
      revision += 1
      return { changed: true }
    },
  }
  return {
    gateway,
    writes,
    value: () => value,
    invocations: () => invocations,
    invocationOptions: () => invocationOptions,
    conflictNext: () => {
      conflictOnce = true
    },
    failNextRead: (error: Error) => {
      readFailure = error
    },
  }
}

test("file document: read decodes the provider body and preserves version metadata", async () => {
  const fixture = memoryGateway({ model: "m1", enabled: true })
  assert.deepEqual(await readFileDocument(fixture.gateway, REF, decodeDocument), {
    data: { model: "m1", enabled: true },
    mediaType: "application/json",
    version: "v1",
  })
})

test("file document: rapid patches serialize against the latest committed version", async () => {
  const fixture = memoryGateway({ model: "m1", enabled: false })
  const client = new FileDocumentClient(REF, decodeDocument, fixture.gateway)
  await client.refresh()

  const model = client.update((current) => ({ ...current, model: "m2" }))
  const enabled = client.update((current) => ({ ...current, enabled: true }))
  await Promise.all([model, enabled])

  assert.deepEqual(fixture.value(), { model: "m2", enabled: true })
  assert.deepEqual(
    fixture.writes.map((write) => write.expectedVersion),
    ["v1", "v2"],
  )
  assert.equal(client.snapshot()?.version, "v3")
})

test("file document: one conflict reloads and replays only the requested field patch", async () => {
  const fixture = memoryGateway({ model: "m1", enabled: false })
  const client = new FileDocumentClient(REF, decodeDocument, fixture.gateway)
  await client.refresh()
  fixture.conflictNext()

  const snapshot = await client.update((current) => ({ ...current, enabled: true }))

  assert.deepEqual(snapshot.data, { model: "external", enabled: true })
  assert.deepEqual(fixture.value(), { model: "external", enabled: true })
  assert.deepEqual(
    fixture.writes.map((write) => write.expectedVersion),
    ["v1", "v2"],
  )
})

test("file document: committed write stays successful when its follow-up refresh fails", async () => {
  const fixture = memoryGateway({ model: "m1", enabled: false })
  const client = new FileDocumentClient(REF, decodeDocument, fixture.gateway)
  await client.refresh()
  const refreshFailure = new Error("refresh unavailable")
  fixture.failNextRead(refreshFailure)

  const snapshot = await client.update((current) => ({ ...current, enabled: true }))

  assert.deepEqual(snapshot.data, { model: "m1", enabled: true })
  assert.equal(snapshot.version, "v2")
  assert.equal(snapshot.stale, true)
  assert.equal(snapshot.refreshError, refreshFailure)
  await client.update((current) => ({ ...current, model: "m2" }))
  assert.deepEqual(
    fixture.writes.map((write) => write.expectedVersion),
    ["v1", "v2"],
  )
  assert.deepEqual(fixture.value(), { model: "m2", enabled: true })
})

test("file document: specialized actions share the queue and refresh the public body", async () => {
  const fixture = memoryGateway({ model: "m1", enabled: false })
  const client = new FileDocumentClient(REF, decodeDocument, fixture.gateway)
  await client.refresh()

  const outcome = await client.invoke<{ changed: boolean }>("toggle")

  assert.deepEqual(outcome.result, { changed: true })
  assert.ok(outcome.snapshot)
  assert.deepEqual(outcome.snapshot.data, { model: "m1", enabled: true })
  assert.equal(outcome.refreshError, null)
  assert.equal(client.snapshot()?.version, "v2")
  assert.deepEqual(fixture.invocationOptions(), [{ expectedVersion: "v1" }])
})

test("file document: queued actions capture the latest refreshed snapshot version", async () => {
  const fixture = memoryGateway({ model: "m1", enabled: false })
  const client = new FileDocumentClient(REF, decodeDocument, fixture.gateway)
  await client.refresh()

  const first = client.invoke("toggle")
  const second = client.invoke("toggle")
  await Promise.all([first, second])

  assert.deepEqual(fixture.invocationOptions(), [
    { expectedVersion: "v1" },
    { expectedVersion: "v2" },
  ])
  assert.equal(client.snapshot()?.version, "v3")
})

test("file document: absent snapshots skip CAS while versionless snapshots require no version", async () => {
  const fixture = memoryGateway({ model: "m1", enabled: false })
  const options: Array<FileActionInvokeOptions | undefined> = []
  const gateway: FileDocumentGateway = {
    ...fixture.gateway,
    async read(ref) {
      const { version: _version, ...result } = await fixture.gateway.read(ref)
      return result
    },
    async invoke(ref, action, input, invokeOptions) {
      options.push(invokeOptions)
      return fixture.gateway.invoke(ref, action, input, invokeOptions)
    },
  }
  const client = new FileDocumentClient(REF, decodeDocument, gateway)

  await client.invoke("toggle")
  await client.invoke("toggle")

  assert.deepEqual(options, [undefined, { expectedVersion: null }])
})

test("file document: committed action stays successful when its follow-up refresh fails", async () => {
  const fixture = memoryGateway({ model: "m1", enabled: false })
  const client = new FileDocumentClient(REF, decodeDocument, fixture.gateway)
  await client.refresh()
  const refreshFailure = new Error("refresh unavailable")
  fixture.failNextRead(refreshFailure)

  const outcome = await client.invoke<{ changed: boolean }>("toggle")

  assert.deepEqual(outcome.result, { changed: true })
  assert.equal(outcome.snapshot, null)
  assert.equal(outcome.refreshError, refreshFailure)
  assert.equal(client.snapshot(), null)
  assert.deepEqual(fixture.value(), { model: "m1", enabled: true })
  assert.equal(fixture.invocations(), 1)
})
