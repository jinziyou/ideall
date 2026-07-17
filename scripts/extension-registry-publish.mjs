import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { GitHubReleaseClient, publishPreparedRelease } from "./release-publish.mjs"
import { readPreparedExtensionRegistry } from "./extension-registry-artifacts.mjs"

const RELEASE_TAG = "extension-registry"
const ROOT_ASSET = "registry.json"
const MAX_ROOT_BYTES = 256 * 1024

function exactEnvelope(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("现有 Registry 根资产不是对象")
  }
  const keys = Object.keys(value).sort().join(",")
  if (keys !== "payload,schemaVersion,signature" || value.schemaVersion !== 1) {
    throw new Error("现有 Registry 根资产信封无效")
  }
  if (typeof value.payload !== "string" || typeof value.signature !== "string") {
    throw new Error("现有 Registry 根资产信封字段无效")
  }
  return value
}

export function registrySequenceFromEnvelope(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_ROOT_BYTES) {
    throw new Error("现有 Registry 根资产大小无效")
  }
  let envelope
  let payload
  try {
    envelope = exactEnvelope(JSON.parse(bytes.toString("utf8")))
    payload = JSON.parse(envelope.payload)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("现有 Registry")) throw error
    throw new Error("现有 Registry 根资产 JSON 无效")
  }
  if (
    payload?.schemaVersion !== 1 ||
    payload?.registry !== "ideall.official" ||
    payload?.cursor !== null ||
    !Number.isSafeInteger(payload?.sequence) ||
    payload.sequence < 1
  ) {
    throw new Error("现有 Registry 根资产 payload 无效")
  }
  return payload.sequence
}

export function assertSequenceAdvances(previous, next) {
  if (!Number.isSafeInteger(next) || next < 1) throw new Error("新 Registry sequence 无效")
  if (previous !== null && (!Number.isSafeInteger(previous) || next <= previous)) {
    throw new Error(`拒绝发布非递增 Registry sequence: ${next} <= ${previous}`)
  }
}

async function downloadCurrentRoot(client) {
  const release = await client.getReleaseByTag(RELEASE_TAG)
  if (!release) return null
  if (release.draft) throw new Error("现有 Extension Registry Release 仍是 draft")
  const assets = await client.listAssets(release.id)
  const roots = assets.filter((asset) => asset.name === ROOT_ASSET)
  if (roots.length !== 1) throw new Error("现有 Extension Registry Release 缺少唯一 registry.json")
  const asset = roots[0]
  if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ROOT_BYTES) {
    throw new Error("现有 registry.json 远端大小无效")
  }
  const response = await fetch(asset.url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${client.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ideall-extension-registry-publisher",
    },
  })
  if (!response.ok) throw new Error(`读取现有 registry.json 失败: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length !== asset.size) throw new Error("现有 registry.json 下载大小不匹配")
  return registrySequenceFromEnvelope(bytes)
}

export async function publishExtensionRegistry({ client, prepared, metadata, logger = console }) {
  const previous = await downloadCurrentRoot(client)
  assertSequenceAdvances(previous, prepared.manifest.sequence)
  return publishPreparedRelease({
    client,
    prepared,
    logger,
    metadata: {
      isTag: false,
      tag: RELEASE_TAG,
      sha: metadata.sha,
      name: "ideall extension registry",
      body: `Signed extension registry sequence ${prepared.manifest.sequence}; expires ${new Date(prepared.manifest.expiresAt).toISOString()}.`,
      runId: metadata.runId,
      runAttempt: metadata.runAttempt,
    },
  })
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`用法:
  node scripts/extension-registry-publish.mjs

说明:
  校验 registry-ready，拒绝 sequence 回退，再通过 staging Release 原子切换
  extension-registry 固定通道。`)
    return
  }
  const [owner, repo] = String(process.env.GITHUB_REPOSITORY || "").split("/")
  const token = process.env.GITHUB_TOKEN
  if (!owner || !repo || !token) throw new Error("缺少 GITHUB_REPOSITORY 或 GITHUB_TOKEN")
  const directory = path.resolve(process.env.REGISTRY_OUTPUT_DIR || "registry-ready")
  const prepared = readPreparedExtensionRegistry(directory)
  if (prepared.manifest.releaseRepository !== process.env.GITHUB_REPOSITORY) {
    throw new Error("prepared Registry manifest 与当前仓库不一致")
  }
  const metadata = {
    sha: process.env.REGISTRY_TARGET_SHA || process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "1",
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!value) throw new Error(`缺少发布元数据: ${key}`)
  }
  const client = new GitHubReleaseClient({
    owner,
    repo,
    token,
    apiUrl: process.env.GITHUB_API_URL,
  })
  const release = await publishExtensionRegistry({ client, prepared, metadata })
  console.log(`✓ Extension Registry 已发布: ${release.html_url ?? `#${release.id}`}`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(`✗ ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  })
}
