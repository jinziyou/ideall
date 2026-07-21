import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { unionMerge, type SyncRecord } from "@protocol/sync"
import { SYNC_PART_MAX_CIPHERTEXT_CHARS } from "@protocol/sync"
import { decryptBytes, deriveKeys } from "@/lib/sync-crypto"
import { bytesToHex } from "@/lib/hex"
import { runDomainSync } from "./sync-domain-machine"
import { SYNC_MAX_ATTEMPTS, type DomainSyncConfig } from "./sync-domain-runner"

const CODE = "0123456789abcdef0123456789abcdef"
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

type LargeRecord = SyncRecord & { payload: string }
type StoredPart = { iv: string; ciphertext: string; content_sha256: string }
type PartitionServerOptions = {
  ambiguousCommitResponseOnce?: boolean
  rejectCommitStatus?: number
  replaceGenerationOnPartGetOnce?: boolean
  alwaysPart404?: boolean
}

const textEncoder = new TextEncoder()

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value))
  return bytesToHex(new Uint8Array(digest))
}

function partSha256(iv: string, ciphertext: string): Promise<string> {
  return sha256Hex(`${iv}\0${ciphertext}`)
}

async function partsSha256(parts: Map<number, StoredPart>, partCount: number): Promise<string> {
  const lines = Array.from(
    { length: partCount },
    (_, index) => `${index}:${parts.get(index)!.content_sha256}\n`,
  ).join("")
  return sha256Hex(lines)
}

function flipHex(value: string): string {
  return `${value[0] === "0" ? "1" : "0"}${value.slice(1)}`
}

function response(status: number, data?: unknown): Response {
  return new Response(data === undefined ? null : JSON.stringify(data), {
    status,
    headers: data === undefined ? undefined : { "Content-Type": "application/json" },
  })
}

function installPartitionServer(options: PartitionServerOptions = {}) {
  const generations = new Map<string, Map<number, StoredPart>>()
  let manifest: {
    generation: string
    part_count: number
    version: number
    updated_at_ms: number
  } | null = null
  let commitCount = 0
  let discardCount = 0
  let manifestGetCount = 0
  let part404Count = 0
  let ambiguousCommitResponse = options.ambiguousCommitResponseOnce ?? false
  let replaceGenerationOnPartGet = options.replaceGenerationOnPartGetOnce ?? false
  const controls = {
    tamperPartDigest: false,
    tamperManifestDigest: false,
  }

  const manifestData = async () => {
    if (!manifest) return null
    const parts = generations.get(manifest.generation) ?? new Map<number, StoredPart>()
    const digest = await partsSha256(parts, manifest.part_count)
    return {
      ...manifest,
      total_ciphertext_chars: [...parts.values()].reduce(
        (sum, part) => sum + part.ciphertext.length,
        0,
      ),
      parts_sha256: controls.tamperManifestDigest ? flipHex(digest) : digest,
    }
  }

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://server.test")
    const method = init.method ?? "GET"
    const generationMatch = url.pathname.match(/\/generations\/([0-9a-f]{32})/)
    const partMatch = url.pathname.match(/\/parts\/(\d+)$/)

    if (url.pathname.endsWith("/manifest")) {
      if (method === "GET") {
        manifestGetCount += 1
        const data = await manifestData()
        return data
          ? response(200, { data })
          : response(404, { error: { code: "not_found", message: "missing" } })
      }
      const expected = Number(url.searchParams.get("expected"))
      if (expected !== (manifest?.version ?? 0)) {
        return response(409, { error: { code: "conflict", message: "conflict" } })
      }
      if (options.rejectCommitStatus !== undefined) {
        return response(options.rejectCommitStatus, {
          error: { code: "rejected", message: "raw server rejection" },
        })
      }
      const body = JSON.parse(String(init.body)) as { generation: string; part_count: number }
      const parts = generations.get(body.generation)
      if (!parts || parts.size !== body.part_count) return response(422, {})
      manifest = {
        generation: body.generation,
        part_count: body.part_count,
        version: (manifest?.version ?? 0) + 1,
        updated_at_ms: Date.now(),
      }
      commitCount += 1
      if (ambiguousCommitResponse) {
        ambiguousCommitResponse = false
        return new Response("{", { status: 200, headers: { "Content-Type": "application/json" } })
      }
      return response(200, { data: await manifestData() })
    }

    if (generationMatch && partMatch) {
      const generation = generationMatch[1]!
      const partIndex = Number(partMatch[1])
      if (method === "PUT") {
        const body = JSON.parse(String(init.body)) as { iv: string; ciphertext: string }
        const contentSha256 = await partSha256(body.iv, body.ciphertext)
        const parts = generations.get(generation) ?? new Map<number, StoredPart>()
        parts.set(partIndex, {
          ...body,
          content_sha256: contentSha256,
        })
        generations.set(generation, parts)
        return response(200, { data: { generation, part_index: partIndex, created: true } })
      }
      if (method === "GET" && manifest?.generation === generation) {
        if (options.alwaysPart404 || replaceGenerationOnPartGet) {
          if (replaceGenerationOnPartGet) {
            replaceGenerationOnPartGet = false
            const replacement = generation === "f".repeat(32) ? "e".repeat(32) : "f".repeat(32)
            generations.set(replacement, new Map(generations.get(generation)!))
            generations.delete(generation)
            manifest = {
              ...manifest,
              generation: replacement,
              version: manifest.version + 1,
              updated_at_ms: Date.now(),
            }
          }
          part404Count += 1
          return response(404, { error: { code: "not_found", message: "replaced" } })
        }
        const part = generations.get(generation)?.get(partIndex)
        return part
          ? response(200, {
              data: {
                generation,
                part_index: partIndex,
                ...part,
                content_sha256: controls.tamperPartDigest
                  ? flipHex(part.content_sha256)
                  : part.content_sha256,
              },
            })
          : response(404, {})
      }
    }

    if (generationMatch && method === "DELETE") {
      discardCount += 1
      generations.delete(generationMatch[1]!)
      return response(204)
    }

    throw new Error(`unexpected sync request: ${method} ${url}`)
  }) as typeof fetch

  return {
    generations,
    get manifest() {
      return manifest
    },
    get commitCount() {
      return commitCount
    },
    get discardCount() {
      return discardCount
    },
    get manifestGetCount() {
      return manifestGetCount
    },
    get part404Count() {
      return part404Count
    },
    controls,
  }
}

function makeLargeConfig(initial: LargeRecord[]) {
  let local = structuredClone(initial)
  let bulkCount = 0
  const config: DomainSyncConfig<LargeRecord> = {
    keyScope: "notes",
    budget: { maxRecords: 100, maxPlaintextBytes: 1_000_000, maxCiphertextBase64Chars: 1_400_000 },
    listLocal: async () => structuredClone(local),
    merge: unionMerge,
    gc: (records) => records,
    async bulkPut(records) {
      bulkCount += 1
      local = structuredClone(records)
      return structuredClone(local)
    },
    isValidRemote(value): value is LargeRecord {
      const record = value as Partial<LargeRecord>
      return (
        !!record &&
        typeof record.id === "string" &&
        typeof record.createdAt === "number" &&
        typeof record.updatedAt === "number" &&
        typeof record.payload === "string"
      )
    },
  }
  return {
    config,
    get local() {
      return local
    },
    get bulkCount() {
      return bulkCount
    },
    setLocal(records: LargeRecord[]) {
      local = structuredClone(records)
    },
  }
}

test("partitioned sync: splits raw UTF-8, commits last, and reads only the committed generation", async () => {
  const server = installPartitionServer()
  const original: LargeRecord = {
    id: "large",
    createdAt: 1,
    updatedAt: 1,
    // 大于单片且使切点落在多字节字符内；必须先重组字节再 UTF-8 解码。
    payload: "汉".repeat(100_000),
  }
  let local: LargeRecord[] = [original]
  const config: DomainSyncConfig<LargeRecord> = {
    keyScope: "notes",
    budget: {
      maxRecords: 10,
      maxPlaintextBytes: 1_000_000,
      maxCiphertextBase64Chars: 1_400_000,
    },
    listLocal: async () => structuredClone(local),
    merge: unionMerge,
    gc: (records) => records,
    async bulkPut(records) {
      local = structuredClone(records)
      return structuredClone(local)
    },
    isValidRemote(value): value is LargeRecord {
      const record = value as Partial<LargeRecord>
      return (
        !!record &&
        typeof record.id === "string" &&
        typeof record.createdAt === "number" &&
        typeof record.updatedAt === "number" &&
        typeof record.payload === "string"
      )
    },
  }

  await runDomainSync(CODE, config)
  assert.equal(server.commitCount, 1)
  assert.ok(server.manifest)
  assert.ok(server.manifest.part_count >= 2, "large snapshot should use multiple parts")

  const stored = server.generations.get(server.manifest.generation)!
  const plaintext: Uint8Array[] = []
  for (let index = 0; index < server.manifest.part_count; index += 1) {
    const part = stored.get(index)!
    assert.ok(part.ciphertext.length <= SYNC_PART_MAX_CIPHERTEXT_CHARS)
    const { key } = await deriveKeys(CODE, "notes", index)
    plaintext.push(
      await decryptBytes(key, part.iv, part.ciphertext, SYNC_PART_MAX_CIPHERTEXT_CHARS),
    )
  }
  const joined = new Uint8Array(plaintext.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of plaintext) {
    joined.set(part, offset)
    offset += part.byteLength
  }
  assert.deepEqual(JSON.parse(new TextDecoder().decode(joined)), [original])

  local = []
  const result = await runDomainSync(CODE, config)
  assert.deepEqual(local, [original])
  assert.deepEqual(result, { total: 1, added: 1 })
  assert.equal(server.commitCount, 1, "equivalent committed snapshot should not be republished")
})

test("partitioned sync: maps V2 AES-GCM authentication failure to a stable sync-code error", async () => {
  const server = installPartitionServer()
  const record: LargeRecord = { id: "secret", createdAt: 1, updatedAt: 1, payload: "ciphertext" }
  const state = makeLargeConfig([record])
  await runDomainSync(CODE, state.config)
  state.setLocal([])

  await assert.rejects(
    runDomainSync("fedcba9876543210fedcba9876543210", state.config),
    /解密失败：同步码可能不一致/,
  )
  assert.deepEqual(state.local, [])
  assert.equal(server.commitCount, 1)
})

test("partitioned sync: a replaced generation part 404 restarts from the latest manifest", async () => {
  const server = installPartitionServer({ replaceGenerationOnPartGetOnce: true })
  const record: LargeRecord = { id: "moving", createdAt: 1, updatedAt: 1, payload: "snapshot" }
  const state = makeLargeConfig([record])
  await runDomainSync(CODE, state.config)
  state.setLocal([])
  const manifestReadsBefore = server.manifestGetCount

  assert.deepEqual(await runDomainSync(CODE, state.config), { total: 1, added: 1 })
  assert.deepEqual(state.local, [record])
  assert.equal(server.part404Count, 1)
  assert.equal(server.manifestGetCount - manifestReadsBefore, 2)
  assert.equal(server.commitCount, 1, "retry should consume the replacement without republishing")
})

test("partitioned sync: repeated stale-generation 404 stops at the shared retry limit", async () => {
  const server = installPartitionServer({ alwaysPart404: true })
  const state = makeLargeConfig([
    { id: "moving", createdAt: 1, updatedAt: 1, payload: "never stable" },
  ])
  await runDomainSync(CODE, state.config)
  const manifestReadsBefore = server.manifestGetCount

  await assert.rejects(runDomainSync(CODE, state.config), /远端同步快照持续更新，请稍后重试/)
  assert.equal(server.part404Count, SYNC_MAX_ATTEMPTS)
  assert.equal(server.manifestGetCount - manifestReadsBefore, SYNC_MAX_ATTEMPTS)
})

test("partitioned sync: rejects a part whose content_sha256 does not bind its IV and ciphertext", async () => {
  const server = installPartitionServer()
  const state = makeLargeConfig([
    { id: "digest", createdAt: 1, updatedAt: 1, payload: "part digest" },
  ])
  await runDomainSync(CODE, state.config)
  state.setLocal([])
  server.controls.tamperPartDigest = true

  await assert.rejects(runDomainSync(CODE, state.config), /同步分片 1 摘要不一致/)
  assert.deepEqual(state.local, [])
})

test("partitioned sync: rejects a manifest whose parts_sha256 does not bind the ordered parts", async () => {
  const server = installPartitionServer()
  const state = makeLargeConfig([
    { id: "digest", createdAt: 1, updatedAt: 1, payload: "manifest digest" },
  ])
  await runDomainSync(CODE, state.config)
  state.setLocal([])
  server.controls.tamperManifestDigest = true

  await assert.rejects(runDomainSync(CODE, state.config), /同步清单分片摘要不一致/)
  assert.deepEqual(state.local, [])
})

test("partitioned sync: recovers when manifest commit succeeds but its response is unusable", async () => {
  const server = installPartitionServer({ ambiguousCommitResponseOnce: true })
  const record: LargeRecord = { id: "commit", createdAt: 1, updatedAt: 1, payload: "atomic" }
  const state = makeLargeConfig([record])

  assert.deepEqual(await runDomainSync(CODE, state.config), { total: 1, added: 0 })
  assert.equal(server.commitCount, 1)
  assert.equal(server.discardCount, 0, "a generation observed as active must never be discarded")
  assert.equal(server.manifestGetCount, 2, "client should verify an ambiguous commit by rereading")

  assert.deepEqual(await runDomainSync(CODE, state.config), { total: 1, added: 0 })
  assert.equal(server.commitCount, 1, "verified commit should not be published again")
})

for (const scenario of [
  { status: 401, message: /跨端同步已升级为账号绑定，请先登录/ },
  { status: 403, message: /跨端同步已升级为账号绑定，请先登录/ },
  { status: 413, message: /同步数据超过服务端配额/ },
  { status: 422, message: /同步数据超过服务端配额/ },
  { status: 429, message: /同步请求过于频繁，请稍后重试/ },
]) {
  test(`partitioned sync: maps manifest commit ${scenario.status} to a stable user error`, async () => {
    const server = installPartitionServer({ rejectCommitStatus: scenario.status })
    const state = makeLargeConfig([
      { id: `status-${scenario.status}`, createdAt: 1, updatedAt: 1, payload: "rejected" },
    ])

    await assert.rejects(runDomainSync(CODE, state.config), scenario.message)
    assert.equal(server.commitCount, 0)
    assert.equal(server.discardCount, 1)
  })
}
