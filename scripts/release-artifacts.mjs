import { createHash } from "node:crypto"
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { minisignPublicKeyId, minisignSignatureKeyId } from "./release-preflight.mjs"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const LABELS = {
  "macos-arm64": { platform: "darwin", arch: "aarch64" },
  "macos-x64": { platform: "darwin", arch: "x86_64", assetArch: "x64" },
  "linux-x64": { platform: "linux", arch: "x86_64" },
  "windows-x64": { platform: "windows", arch: "x86_64" },
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".."
}

function normalizeMacUpdaterName(name, version, assetArch) {
  for (const suffix of [".app.tar.gz.sig", ".app.tar.gz"]) {
    if (!name.endsWith(suffix)) continue
    const stem = name.slice(0, -suffix.length).replace(new RegExp(`_${version}_[^_]+$`), "")
    return `${stem}_${version}_${assetArch}${suffix}`
  }
  return name
}

function strictString(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label}必须是非空字符串`)
  return value
}

function assertSafeAssetName(name, label) {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error(`${label}: asset 名称必须是非空字符串`)
  }
  if (
    name === "." ||
    name === ".." ||
    path.posix.isAbsolute(name) ||
    path.win32.isAbsolute(name) ||
    path.posix.basename(name) !== name ||
    path.win32.basename(name) !== name
  ) {
    throw new Error(`${label}: asset 名称必须是单一文件名: ${JSON.stringify(name)}`)
  }
  return name
}

function validateManifestEntries(entries, label) {
  const names = new Set()
  for (const entry of entries) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error(`${label}: manifest file 条目无效`)
    }
    assertSafeAssetName(entry.name, label)
    if (names.has(entry.name)) {
      throw new Error(`${label}: stage manifest 内 asset 名称冲突: ${entry.name}`)
    }
    names.add(entry.name)
  }
}

function resolveStageAsset(manifestFile, name, label) {
  const manifestDir = realpathSync(path.dirname(manifestFile))
  const assetDir = realpathSync(path.join(path.dirname(manifestFile), "assets"))
  if (!isInside(manifestDir, assetDir)) {
    throw new Error(`${label}: stage assets 目录越出 stage: ${assetDir}`)
  }

  const source = realpathSync(path.join(assetDir, name))
  if (!isInside(assetDir, source)) {
    throw new Error(`${label}: workflow artifact 越出 stage assets: ${name}`)
  }
  return source
}

export function stageReleaseArtifacts({ label, version, artifactPaths, outputDir, root = ROOT }) {
  const target = LABELS[label]
  if (!target) throw new Error(`未知 desktop label: ${label}`)
  strictString(version, "version")
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) {
    throw new Error(`${label}: tauri-action 未返回 artifactPaths`)
  }

  const realRoot = realpathSync(root)
  rmSync(outputDir, { recursive: true, force: true })
  const assetDir = path.join(outputDir, "assets")
  mkdirSync(assetDir, { recursive: true })

  const files = []
  const names = new Set()
  for (const artifactPath of artifactPaths) {
    strictString(artifactPath, `${label} artifact path`)
    const absolutePath = realpathSync(path.resolve(root, artifactPath))
    if (!isInside(realRoot, absolutePath)) {
      throw new Error(`${label}: artifact 越出仓库: ${artifactPath}`)
    }
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) continue
    if (!stats.isFile() || stats.size <= 0) {
      throw new Error(`${label}: artifact 不是非空普通文件: ${artifactPath}`)
    }

    let name = path.basename(absolutePath)
    if (target.platform === "darwin") {
      name = normalizeMacUpdaterName(name, version, target.assetArch ?? target.arch)
    }
    if (names.has(name)) throw new Error(`${label}: artifact 名称冲突: ${name}`)
    names.add(name)

    const destination = path.join(assetDir, name)
    copyFileSync(absolutePath, destination)
    files.push({ name, size: stats.size, sha256: sha256(destination) })
  }

  if (files.length === 0) throw new Error(`${label}: 没有可暂存的文件 artifact`)
  files.sort((a, b) => a.name.localeCompare(b.name))
  const manifest = { schemaVersion: 1, label, version, files }
  writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function walkFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

function readStageManifest(file, version) {
  const raw = JSON.parse(readFileSync(file, "utf8"))
  if (raw?.schemaVersion !== 1 || !LABELS[raw.label] || raw.version !== version) {
    throw new Error(`无效或版本不匹配的 stage manifest: ${file}`)
  }
  if (!Array.isArray(raw.files) || raw.files.length === 0) {
    throw new Error(`stage manifest 没有 files: ${file}`)
  }
  validateManifestEntries(raw.files, raw.label)
  return raw
}

function findOne(files, predicate, description) {
  const matches = files.filter((file) => predicate(file))
  if (matches.length !== 1) {
    throw new Error(`${description}: 期望 1 个，实际 ${matches.length} 个`)
  }
  return matches[0]
}

function requireInstallerPair(files, predicate, description) {
  const installer = findOne(files, predicate, description)
  const signature = findOne(
    files,
    (file) => file.name === `${installer.name}.sig`,
    `${description}.sig`,
  )
  return { installer, signature }
}

function releaseUrl(repository, tag, name) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
}

function updaterEntry(pair, repository, tag, outputDir) {
  return {
    signature: readFileSync(path.join(outputDir, pair.signature.name), "utf8"),
    url: releaseUrl(repository, tag, pair.installer.name),
  }
}

function validatePlatformAssets(filesByLabel) {
  const arm = filesByLabel.get("macos-arm64")
  findOne(arm, (file) => file.name.endsWith(".dmg"), "macOS arm64 DMG")
  const armUpdater = requireInstallerPair(
    arm,
    (file) => file.name.endsWith("_aarch64.app.tar.gz"),
    "macOS arm64 updater",
  )

  const x64 = filesByLabel.get("macos-x64")
  findOne(x64, (file) => file.name.endsWith(".dmg"), "macOS x64 DMG")
  const x64Updater = requireInstallerPair(
    x64,
    (file) => file.name.endsWith("_x64.app.tar.gz"),
    "macOS x64 updater",
  )

  const linux = filesByLabel.get("linux-x64")
  findOne(linux, (file) => file.name.endsWith(".deb"), "Linux DEB")
  findOne(linux, (file) => file.name.endsWith(".rpm"), "Linux RPM")
  const linuxUpdater = requireInstallerPair(
    linux,
    (file) => file.name.endsWith(".AppImage"),
    "Linux AppImage updater",
  )

  const windows = filesByLabel.get("windows-x64")
  const msiUpdater = requireInstallerPair(
    windows,
    (file) => file.name.endsWith(".msi"),
    "Windows MSI updater",
  )
  const nsisUpdater = requireInstallerPair(
    windows,
    (file) => file.name.endsWith("-setup.exe"),
    "Windows NSIS updater",
  )

  return { armUpdater, x64Updater, linuxUpdater, msiUpdater, nsisUpdater }
}

export function prepareReleaseArtifacts({
  inputDir,
  outputDir,
  version,
  tag,
  repository,
  notes = "",
  pubDate = new Date().toISOString(),
  root = ROOT,
}) {
  for (const [value, label] of [
    [version, "version"],
    [tag, "tag"],
    [repository, "repository"],
    [pubDate, "pubDate"],
  ]) {
    strictString(value, label)
  }

  const manifestFiles = walkFiles(inputDir).filter(
    (file) => path.basename(file) === "manifest.json",
  )
  const manifests = manifestFiles.map((file) => ({ file, data: readStageManifest(file, version) }))
  const byLabel = new Map()
  for (const manifest of manifests) {
    if (byLabel.has(manifest.data.label)) {
      throw new Error(`重复的 stage manifest: ${manifest.data.label}`)
    }
    byLabel.set(manifest.data.label, manifest)
  }
  for (const label of Object.keys(LABELS)) {
    if (!byLabel.has(label)) throw new Error(`缺少平台 stage manifest: ${label}`)
  }
  if (byLabel.size !== Object.keys(LABELS).length) throw new Error("存在未知平台 stage manifest")

  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })
  const names = new Set()
  const filesByLabel = new Map()
  for (const [label, manifest] of byLabel) {
    const files = []
    for (const entry of manifest.data.files) {
      if (names.has(entry.name)) throw new Error(`跨平台 Release asset 名称冲突: ${entry.name}`)
      names.add(entry.name)
      const source = resolveStageAsset(manifest.file, entry.name, label)
      const stats = statSync(source)
      if (stats.size !== entry.size || sha256(source) !== entry.sha256) {
        throw new Error(`${label}: workflow artifact 校验失败: ${entry.name}`)
      }
      copyFileSync(source, path.join(outputDir, entry.name))
      files.push(entry)
    }
    filesByLabel.set(label, files)
  }

  const updater = validatePlatformAssets(filesByLabel)
  const config = JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"))
  const publicKey = config.plugins?.updater?.pubkey
  const publicKeyId = minisignPublicKeyId(publicKey)
  for (const file of [...names].filter((name) => name.endsWith(".sig"))) {
    const signature = readFileSync(path.join(outputDir, file), "utf8")
    if (minisignSignatureKeyId(signature) !== publicKeyId) {
      throw new Error(`updater signature key id 与配置公钥不匹配: ${file}`)
    }
  }

  const latest = {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      "darwin-aarch64": updaterEntry(updater.armUpdater, repository, tag, outputDir),
      "darwin-aarch64-app": updaterEntry(updater.armUpdater, repository, tag, outputDir),
      "darwin-x86_64": updaterEntry(updater.x64Updater, repository, tag, outputDir),
      "darwin-x86_64-app": updaterEntry(updater.x64Updater, repository, tag, outputDir),
      "linux-x86_64": updaterEntry(updater.linuxUpdater, repository, tag, outputDir),
      "linux-x86_64-appimage": updaterEntry(updater.linuxUpdater, repository, tag, outputDir),
      "windows-x86_64": updaterEntry(updater.msiUpdater, repository, tag, outputDir),
      "windows-x86_64-msi": updaterEntry(updater.msiUpdater, repository, tag, outputDir),
      "windows-x86_64-nsis": updaterEntry(updater.nsisUpdater, repository, tag, outputDir),
    },
  }
  writeFileSync(path.join(outputDir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`)

  const checksumFiles = readdirSync(outputDir).sort()
  const checksums = checksumFiles
    .map((name) => `${sha256(path.join(outputDir, name))}  ${name}`)
    .join("\n")
  writeFileSync(path.join(outputDir, "SHA256SUMS"), `${checksums}\n`)

  const releaseFiles = readdirSync(outputDir)
    .sort()
    .map((name) => {
      const file = path.join(outputDir, name)
      return { name, size: statSync(file).size, sha256: sha256(file) }
    })
  const manifest = {
    schemaVersion: 1,
    version,
    tag,
    repository,
    updaterPlatforms: Object.keys(latest.platforms),
    files: releaseFiles,
  }
  writeFileSync(
    path.join(outputDir, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  return { manifest, latest }
}

function parseArtifactPaths(value) {
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error("TAURI_ARTIFACT_PATHS 不是合法 JSON")
  }
  return parsed
}

function main() {
  const command = process.argv[2]
  if (command === "stage") {
    const manifest = stageReleaseArtifacts({
      label: process.env.RELEASE_LABEL,
      version: process.env.RELEASE_VERSION,
      artifactPaths: parseArtifactPaths(process.env.TAURI_ARTIFACT_PATHS),
      outputDir: path.resolve(process.env.RELEASE_STAGE_DIR || "release-stage"),
    })
    console.log(`✓ ${manifest.label}: 暂存 ${manifest.files.length} 个 Release artifacts`)
    return
  }
  if (command === "prepare") {
    const result = prepareReleaseArtifacts({
      inputDir: path.resolve(process.env.RELEASE_INPUT_DIR || "release-input"),
      outputDir: path.resolve(process.env.RELEASE_OUTPUT_DIR || "release-ready"),
      version: process.env.RELEASE_VERSION,
      tag: process.env.RELEASE_TAG,
      repository: process.env.GITHUB_REPOSITORY,
      notes: process.env.RELEASE_NOTES || "",
    })
    console.log(
      `✓ Release assets 就绪: ${result.manifest.files.length} 个文件 / ${result.manifest.updaterPlatforms.length} 个 updater targets`,
    )
    return
  }
  console.log(`用法:
  node scripts/release-artifacts.mjs stage
  node scripts/release-artifacts.mjs prepare

stage 读取 RELEASE_LABEL / RELEASE_VERSION / TAURI_ARTIFACT_PATHS / RELEASE_STAGE_DIR。
prepare 读取 RELEASE_INPUT_DIR / RELEASE_OUTPUT_DIR / RELEASE_VERSION / RELEASE_TAG / GITHUB_REPOSITORY。`)
  if (command && command !== "--help" && command !== "-h") process.exitCode = 1
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    main()
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
