import { createHash } from "node:crypto"
import { createReadStream, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const API_VERSION = "2022-11-28"

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const RELEASE_VISIBILITY_DELAYS_MS = [0, 250, 500, 1_000, 2_000, 4_000, 8_000]

async function waitForRelease(client, tag, predicate, visibilityDelays) {
  let release = null
  for (const delay of visibilityDelays) {
    if (delay) await sleep(delay)
    release = await client.getReleaseByTag(tag)
    if (predicate(release)) return release
  }
  return release
}

export function readPreparedRelease(directory) {
  const manifestPath = path.join(directory, "release-manifest.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error("release-manifest.json 无效")
  }

  const names = new Set()
  const files = manifest.files.map((entry) => {
    if (
      typeof entry?.name !== "string" ||
      names.has(entry.name) ||
      path.basename(entry.name) !== entry.name ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error("release manifest file 条目无效")
    }
    names.add(entry.name)
    const file = path.join(directory, entry.name)
    const stats = statSync(file)
    if (stats.size !== entry.size || sha256(file) !== entry.sha256) {
      throw new Error(`发布前 artifact 校验失败: ${entry.name}`)
    }
    return { ...entry, path: file }
  })
  for (const required of ["latest.json", "SHA256SUMS"]) {
    if (!names.has(required)) throw new Error(`release manifest 缺少 ${required}`)
  }
  return { manifest, files }
}

export class GitHubReleaseClient {
  constructor({ owner, repo, token, apiUrl = "https://api.github.com" }) {
    this.owner = owner
    this.repo = repo
    this.token = token
    this.apiUrl = apiUrl.replace(/\/$/, "")
  }

  async request(
    endpoint,
    { method = "GET", body, allow404 = false, allowMissingReference = false } = {},
  ) {
    const response = await fetch(`${this.apiUrl}${endpoint}`, {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "ideall-release-publisher",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (allow404 && response.status === 404) return null
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1_000)
      if (allowMissingReference && response.status === 422) {
        try {
          if (JSON.parse(detail)?.message === "Reference does not exist") return null
        } catch {
          // Preserve the original GitHub API error below when the body is not JSON.
        }
      }
      throw new Error(`${method} ${endpoint} -> ${response.status}: ${detail}`)
    }
    if (response.status === 204) return null
    return response.json()
  }

  repoEndpoint(suffix) {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${suffix}`
  }

  getReleaseByTag(tag) {
    return this.request(this.repoEndpoint(`/releases/tags/${encodeURIComponent(tag)}`), {
      allow404: true,
    })
  }

  getRef(tag) {
    return this.request(this.repoEndpoint(`/git/ref/tags/${encodeURIComponent(tag)}`), {
      allow404: true,
    })
  }

  createRef(tag, sha) {
    return this.request(this.repoEndpoint("/git/refs"), {
      method: "POST",
      body: { ref: `refs/tags/${tag}`, sha },
    })
  }

  deleteRef(tag) {
    return this.request(this.repoEndpoint(`/git/refs/tags/${encodeURIComponent(tag)}`), {
      method: "DELETE",
      allow404: true,
      allowMissingReference: true,
    })
  }

  createRelease(data) {
    return this.request(this.repoEndpoint("/releases"), { method: "POST", body: data })
  }

  updateRelease(id, data) {
    return this.request(this.repoEndpoint(`/releases/${id}`), { method: "PATCH", body: data })
  }

  deleteRelease(id) {
    return this.request(this.repoEndpoint(`/releases/${id}`), {
      method: "DELETE",
      allow404: true,
    })
  }

  listAssets(id) {
    return this.request(this.repoEndpoint(`/releases/${id}/assets?per_page=100`))
  }

  async uploadAsset(release, file) {
    const uploadUrl = release.upload_url.replace("{?name,label}", "")
    const endpoint = `${uploadUrl}?name=${encodeURIComponent(file.name)}`
    let lastError
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(10 * 60_000),
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/octet-stream",
            "Content-Length": String(file.size),
            "X-GitHub-Api-Version": API_VERSION,
            "User-Agent": "ideall-release-publisher",
          },
          body: createReadStream(file.path),
          duplex: "half",
        })
        if (!response.ok) {
          throw new Error(
            `upload ${file.name} -> ${response.status}: ${(await response.text()).slice(0, 500)}`,
          )
        }
        return response.json()
      } catch (error) {
        lastError = error
        if (attempt < 3) await sleep(attempt * 1_000)
      }
    }
    throw lastError
  }
}

async function cleanupRelease(client, release, tag, logger) {
  if (release) {
    try {
      await client.deleteRelease(release.id)
    } catch (error) {
      logger.warn(`清理 staging release 失败: ${error.message}`)
    }
  }
  try {
    await client.deleteRef(tag)
  } catch (error) {
    logger.warn(`清理 staging tag 失败: ${error.message}`)
  }
}

async function assertRemoteAssets(client, release, files) {
  const assets = await client.listAssets(release.id)
  const expected = new Map(files.map((file) => [file.name, file]))
  if (assets.length !== expected.size) {
    throw new Error(`staging Release asset 数量错误: ${assets.length} != ${expected.size}`)
  }
  for (const asset of assets) {
    const file = expected.get(asset.name)
    if (!file || asset.state !== "uploaded" || asset.size !== file.size) {
      throw new Error(`staging Release asset 校验失败: ${asset.name}`)
    }
    if (asset.digest && asset.digest !== `sha256:${file.sha256}`) {
      throw new Error(`staging Release asset digest 校验失败: ${asset.name}`)
    }
  }
}

async function promoteFormalRelease(client, staging, metadata) {
  const existing = await client.getReleaseByTag(metadata.tag)
  if (existing && !existing.draft) {
    throw new Error(`正式 Release ${metadata.tag} 已发布，拒绝覆盖`)
  }
  if (existing) await client.deleteRelease(existing.id)
  const promoted = await client.updateRelease(staging.id, {
    tag_name: metadata.tag,
    target_commitish: metadata.sha,
    name: metadata.name,
    body: metadata.body,
    draft: true,
    prerelease: false,
  })
  await client.deleteRef(metadata.stagingTag)
  return promoted
}

async function promoteEdgeRelease(client, staging, metadata, logger, visibilityDelays) {
  const oldRelease = await client.getReleaseByTag(metadata.tag)
  const oldRef = await client.getRef(metadata.tag)
  if (oldRelease && !oldRef) throw new Error("现有 app-edge Release 缺少对应 git tag，拒绝切换")

  const backupTag = `${metadata.tag}-backup-${metadata.runId}-${metadata.runAttempt}`
  await client.deleteRef(backupTag)
  let oldMoved = false
  try {
    if (oldRef) await client.createRef(backupTag, oldRef.object.sha)
    if (oldRelease) {
      const moved = await client.updateRelease(oldRelease.id, {
        tag_name: backupTag,
        target_commitish: oldRef.object.sha,
        name: oldRelease.name,
        body: oldRelease.body,
        draft: false,
        prerelease: true,
        make_latest: "false",
      })
      oldMoved = true
      if (moved.id !== oldRelease.id || moved.draft || !moved.prerelease) {
        throw new Error("旧 app-edge Release 迁移到备份通道失败")
      }
      const visibleBackup = await waitForRelease(
        client,
        backupTag,
        (release) => release?.id === oldRelease.id && !release.draft && release.prerelease,
        visibilityDelays,
      )
      if (visibleBackup?.id !== oldRelease.id) {
        throw new Error("旧 app-edge backup Release 在等待期内不可见")
      }
    }
    if (oldRef) await client.deleteRef(metadata.tag)

    const promoted = await client.updateRelease(staging.id, {
      tag_name: metadata.tag,
      target_commitish: metadata.sha,
      name: metadata.name,
      body: metadata.body,
      draft: false,
      prerelease: true,
      make_latest: "false",
    })
    const active = await waitForRelease(
      client,
      metadata.tag,
      (release) => release?.id === staging.id && !release.draft && release.prerelease,
      visibilityDelays,
    )
    if (active?.id !== staging.id || active.draft || !active.prerelease) {
      throw new Error("app-edge staging Release 切换后校验失败")
    }

    if (oldRelease) await client.deleteRelease(oldRelease.id)
    await client.deleteRef(backupTag)
    await client.deleteRef(metadata.stagingTag)
    return promoted
  } catch (error) {
    const active = await waitForRelease(
      client,
      metadata.tag,
      (release) => release?.id === staging.id && !release.draft && release.prerelease,
      visibilityDelays,
    ).catch(() => null)
    if (active?.id === staging.id && !active.draft) {
      logger.warn(`app-edge 已切换，但清理旧资源失败: ${error.message}`)
      return active
    }

    try {
      await client.deleteRef(metadata.tag)
      if (oldRef) await client.createRef(metadata.tag, oldRef.object.sha)
      if (oldRelease && oldMoved) {
        await client.updateRelease(oldRelease.id, {
          tag_name: metadata.tag,
          target_commitish: oldRef.object.sha,
          name: oldRelease.name,
          body: oldRelease.body,
          draft: false,
          prerelease: true,
          make_latest: "false",
        })
      }
      await client.deleteRelease(staging.id)
      await client.deleteRef(metadata.stagingTag)
      await client.deleteRef(backupTag)
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "app-edge 切换失败且回滚未完整完成")
    }
    throw error
  }
}

export async function publishPreparedRelease({
  client,
  prepared,
  metadata,
  logger = console,
  visibilityDelays = RELEASE_VISIBILITY_DELAYS_MS,
}) {
  const stagingTag = `ideall-staging-${metadata.runId}-${metadata.runAttempt}`
  const fullMetadata = { ...metadata, stagingTag }
  const stale = await client.getReleaseByTag(stagingTag)
  if (stale) await client.deleteRelease(stale.id)
  await client.deleteRef(stagingTag)

  let staging
  try {
    staging = await client.createRelease({
      tag_name: stagingTag,
      target_commitish: metadata.sha,
      name: `ideall staging ${metadata.runId}.${metadata.runAttempt}`,
      body: "Artifact-first staging Release. Do not publish manually.",
      draft: true,
      prerelease: !metadata.isTag,
      ...(metadata.isTag ? {} : { make_latest: "false" }),
    })
    for (const file of prepared.files) await client.uploadAsset(staging, file)
    await assertRemoteAssets(client, staging, prepared.files)
  } catch (error) {
    await cleanupRelease(client, staging, stagingTag, logger)
    throw error
  }

  try {
    return metadata.isTag
      ? await promoteFormalRelease(client, staging, fullMetadata)
      : await promoteEdgeRelease(client, staging, fullMetadata, logger, visibilityDelays)
  } catch (error) {
    const active = await client.getReleaseByTag(metadata.tag).catch(() => null)
    if (active?.id !== staging.id) await cleanupRelease(client, staging, stagingTag, logger)
    throw error
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`用法:
  node scripts/release-publish.mjs

说明:
  校验 RELEASE_OUTPUT_DIR 后创建 staging draft、上传并复核全部资产，最后发布 tag draft或可回滚切换 app-edge。`)
    return
  }
  const [owner, repo] = String(process.env.GITHUB_REPOSITORY || "").split("/")
  const token = process.env.GITHUB_TOKEN
  if (!owner || !repo || !token) throw new Error("缺少 GITHUB_REPOSITORY 或 GITHUB_TOKEN")
  const directory = path.resolve(process.env.RELEASE_OUTPUT_DIR || "release-ready")
  const prepared = readPreparedRelease(directory)
  const isTag = process.env.GITHUB_REF_TYPE === "tag"
  const tag = isTag ? process.env.GITHUB_REF_NAME : "app-edge"
  if (
    prepared.manifest.tag !== tag ||
    prepared.manifest.repository !== process.env.GITHUB_REPOSITORY
  ) {
    throw new Error("prepared Release manifest 与当前发布目标不一致")
  }
  const metadata = {
    isTag,
    tag,
    sha: process.env.GITHUB_SHA,
    name: isTag ? `ideall ${tag}` : "ideall (edge · main 最新构建)",
    body: isTag ? "" : `main 分支自动构建 · ${process.env.GITHUB_SHA}`,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "1",
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (key !== "isTag" && !value) throw new Error(`缺少发布元数据: ${key}`)
  }
  const client = new GitHubReleaseClient({
    owner,
    repo,
    token,
    apiUrl: process.env.GITHUB_API_URL,
  })
  const release = await publishPreparedRelease({ client, prepared, metadata })
  console.log(`✓ Release 已就绪: ${release.html_url ?? `${tag} (#${release.id})`}`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(`✗ ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  })
}
