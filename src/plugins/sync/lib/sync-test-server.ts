import type { SyncBlob, SyncGenerationPart, SyncManifest } from "@protocol/sync"
import { bytesToHex } from "@/lib/hex"

type SyncPartWrite = Pick<SyncGenerationPart, "iv" | "ciphertext">

export type SyncTestServer = {
  /** 当前 manifest 的第 0 片，保留旧测试的解密断言入口。 */
  blob: SyncBlob | null
  manifest: SyncManifest | null
  force409Once: boolean
  alwaysConflict: boolean
  conflictBlobOnce: SyncBlob | null
  /** manifest PUT 次数（延续旧 fake server 的 putCount 语义）。 */
  putCount: number
  partPutCount: number
  discardCount: number
  expectedValues: number[]
  manifestGetCount: number
}

const SHA256_PLACEHOLDER = "0".repeat(64)
const textEncoder = new TextEncoder()

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value))
  return bytesToHex(new Uint8Array(digest))
}

function contentSha256(part: Pick<SyncGenerationPart, "iv" | "ciphertext">): Promise<string> {
  return sha256Hex(`${part.iv}\0${part.ciphertext}`)
}

async function hydrateManifest(
  manifest: SyncManifest,
  parts: Map<number, SyncGenerationPart>,
): Promise<SyncManifest> {
  const digests = await Promise.all(
    Array.from({ length: manifest.part_count }, (_, index) => contentSha256(parts.get(index)!)),
  )
  return {
    ...manifest,
    parts_sha256: await sha256Hex(digests.map((digest, index) => `${index}:${digest}\n`).join("")),
  }
}

function testResponse(status: number, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }
}

function envelope(value: unknown) {
  return testResponse(200, JSON.stringify({ data: value }))
}

function parseBody<T>(init: RequestInit): T {
  if (typeof init.body !== "string") throw new Error("expected JSON request body")
  return JSON.parse(init.body) as T
}

/**
 * 安装 V2 manifest + immutable generation parts + CAS 的内存服务端。
 * 小测试快照均为单片；无 manifest 时客户端直接创建当前分区快照。
 */
export function makeSyncTestServer(initial: SyncBlob | null = null): SyncTestServer {
  const pending = new Map<string, Map<number, SyncPartWrite>>()
  let activeParts = new Map<number, SyncGenerationPart>()
  let generationSequence = 0

  const state: SyncTestServer = {
    blob: null,
    manifest: null,
    force409Once: false,
    alwaysConflict: false,
    conflictBlobOnce: null,
    putCount: 0,
    partPutCount: 0,
    discardCount: 0,
    expectedValues: [],
    manifestGetCount: 0,
  }

  const nextGeneration = () => {
    generationSequence += 1
    return generationSequence.toString(16).padStart(32, "0")
  }

  const activateBlob = (blob: SyncBlob) => {
    const generation = nextGeneration()
    const part: SyncGenerationPart = {
      generation,
      part_index: 0,
      iv: blob.iv,
      ciphertext: blob.ciphertext,
      content_sha256: SHA256_PLACEHOLDER,
    }
    activeParts = new Map([[0, part]])
    state.blob = { ...blob }
    state.manifest = {
      generation,
      part_count: 1,
      total_ciphertext_chars: blob.ciphertext.length,
      parts_sha256: SHA256_PLACEHOLDER,
      version: blob.updated_at,
      updated_at_ms: blob.updated_at,
    }
  }

  if (initial) activateBlob(initial)

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? "GET"
    const path = url.pathname

    const manifestMatch = path.match(/^\/v2\/app\/sync\/[^/]+\/manifest$/)
    if (manifestMatch) {
      if (method === "GET") {
        state.manifestGetCount += 1
        if (!state.manifest) return testResponse(404)
        state.manifest = await hydrateManifest(state.manifest, activeParts)
        return envelope(state.manifest)
      }
      if (method !== "PUT") throw new Error(`unexpected method: ${method} ${path}`)

      state.putCount += 1
      const expected = Number(url.searchParams.get("expected") ?? "0")
      state.expectedValues.push(expected)
      if (state.force409Once) {
        state.force409Once = false
        if (state.conflictBlobOnce) {
          activateBlob(state.conflictBlobOnce)
          state.conflictBlobOnce = null
        }
        return testResponse(409, "conflict")
      }
      if (state.alwaysConflict) return testResponse(409, "conflict")

      const currentVersion = state.manifest?.version ?? 0
      if (expected !== currentVersion) return testResponse(409, "conflict")
      const body = parseBody<{ generation: string; part_count: number }>(init)
      const uploaded = pending.get(body.generation)
      if (!uploaded || body.part_count < 1) return testResponse(422, "parts missing")

      const committedParts = new Map<number, SyncGenerationPart>()
      for (let index = 0; index < body.part_count; index += 1) {
        const write = uploaded.get(index)
        if (!write) return testResponse(422, "parts missing")
        committedParts.set(index, {
          generation: body.generation,
          part_index: index,
          iv: write.iv,
          ciphertext: write.ciphertext,
          content_sha256: SHA256_PLACEHOLDER,
        })
      }

      const version = currentVersion + 1
      activeParts = committedParts
      const first = committedParts.get(0)!
      state.blob = { iv: first.iv, ciphertext: first.ciphertext, updated_at: version }
      state.manifest = {
        generation: body.generation,
        part_count: body.part_count,
        total_ciphertext_chars: [...committedParts.values()].reduce(
          (total, part) => total + part.ciphertext.length,
          0,
        ),
        parts_sha256: SHA256_PLACEHOLDER,
        version,
        updated_at_ms: version,
      }
      pending.delete(body.generation)
      state.manifest = await hydrateManifest(state.manifest, activeParts)
      return envelope(state.manifest)
    }

    const partMatch = path.match(
      /^\/v2\/app\/sync\/[^/]+\/generations\/([0-9a-f]{32})\/parts\/(\d+)$/,
    )
    if (partMatch) {
      const generation = partMatch[1]!
      const partIndex = Number(partMatch[2])
      if (method === "GET") {
        const part =
          state.manifest?.generation === generation ? activeParts.get(partIndex) : undefined
        return part
          ? envelope({ ...part, content_sha256: await contentSha256(part) })
          : testResponse(404)
      }
      if (method !== "PUT") throw new Error(`unexpected method: ${method} ${path}`)
      state.partPutCount += 1
      const part = parseBody<SyncPartWrite>(init)
      const generationParts = pending.get(generation) ?? new Map<number, SyncPartWrite>()
      generationParts.set(partIndex, part)
      pending.set(generation, generationParts)
      return testResponse(204)
    }

    const generationMatch = path.match(/^\/v2\/app\/sync\/[^/]+\/generations\/([0-9a-f]{32})$/)
    if (generationMatch && method === "DELETE") {
      state.discardCount += 1
      pending.delete(generationMatch[1]!)
      return testResponse(204)
    }

    throw new Error(`unexpected request: ${method} ${url}`)
  }) as typeof fetch

  return state
}
