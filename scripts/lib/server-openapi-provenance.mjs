import { createHash } from "node:crypto"

export const SERVER_OPENAPI_PROVENANCE_VERSION = 1
export const DEFAULT_SERVER_SOURCE_REPOSITORY = "jinziyou/wonita"
export const DEFAULT_SERVER_SOURCE_PATH = "apps/apiserver/openapi.json"
export const DEFAULT_SERVER_ARTIFACT_PATH = "openapi/server.json"

const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex")
}

function assertSourceMetadata({ repository, commit, sourcePath, artifactPath }) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`source.repository 必须是 owner/repository: ${repository}`)
  }
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error("source.commit 必须是 40 位小写十六进制 Git commit")
  }
  if (!sourcePath || sourcePath.startsWith("/") || sourcePath.includes("..")) {
    throw new Error(`source.path 必须是仓库内相对路径: ${sourcePath}`)
  }
  if (!artifactPath || artifactPath.startsWith("/") || artifactPath.includes("..")) {
    throw new Error(`artifact.path 必须是仓库内相对路径: ${artifactPath}`)
  }
}

export function createServerOpenApiProvenance({
  artifactContent,
  repository = DEFAULT_SERVER_SOURCE_REPOSITORY,
  commit,
  sourcePath = DEFAULT_SERVER_SOURCE_PATH,
  artifactPath = DEFAULT_SERVER_ARTIFACT_PATH,
}) {
  assertSourceMetadata({ repository, commit, sourcePath, artifactPath })
  return {
    schemaVersion: SERVER_OPENAPI_PROVENANCE_VERSION,
    source: {
      repository,
      commit,
      path: sourcePath,
    },
    artifact: {
      path: artifactPath,
      sha256: sha256(artifactContent),
    },
  }
}

export function validateServerOpenApiProvenance({
  provenance,
  artifactContent,
  artifactPath = DEFAULT_SERVER_ARTIFACT_PATH,
}) {
  const errors = []
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    return ["provenance 根节点必须是对象"]
  }
  if (provenance.schemaVersion !== SERVER_OPENAPI_PROVENANCE_VERSION) {
    errors.push(`schemaVersion 必须是 ${SERVER_OPENAPI_PROVENANCE_VERSION}`)
  }

  const source = provenance.source
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    errors.push("source 必须是对象")
  } else {
    if (!REPOSITORY_PATTERN.test(source.repository ?? "")) {
      errors.push("source.repository 必须是 owner/repository")
    }
    if (!COMMIT_PATTERN.test(source.commit ?? "")) {
      errors.push("source.commit 必须是 40 位小写十六进制 Git commit")
    }
    if (!source.path || source.path.startsWith("/") || source.path.includes("..")) {
      errors.push("source.path 必须是仓库内相对路径")
    }
  }

  const artifact = provenance.artifact
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    errors.push("artifact 必须是对象")
  } else {
    if (artifact.path !== artifactPath) {
      errors.push(`artifact.path 必须是 ${artifactPath}`)
    }
    if (!SHA256_PATTERN.test(artifact.sha256 ?? "")) {
      errors.push("artifact.sha256 必须是 64 位小写十六进制 SHA-256")
    } else {
      const actualSha256 = sha256(artifactContent)
      if (artifact.sha256 !== actualSha256) {
        errors.push(`artifact.sha256 不匹配（记录 ${artifact.sha256}，实际 ${actualSha256}）`)
      }
    }
  }
  return errors
}
