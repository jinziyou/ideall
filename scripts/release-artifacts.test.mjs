import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { prepareReleaseArtifacts, stageReleaseArtifacts } from "./release-artifacts.mjs"
import { assertEmbedOriginAllowed, assertSignatureMatchesPublicKey } from "./release-preflight.mjs"
import { GitHubReleaseClient, publishPreparedRelease } from "./release-publish.mjs"

function makeMinisignFixtures() {
  const keyId = Buffer.from("0102030405060708", "hex")
  const publicPacket = Buffer.alloc(42)
  publicPacket.write("Ed")
  keyId.copy(publicPacket, 2)
  const publicText = `untrusted comment: minisign public key\n${publicPacket.toString("base64")}\n`

  const signaturePacket = Buffer.alloc(74)
  signaturePacket.write("ED")
  keyId.copy(signaturePacket, 2)
  const globalPacket = Buffer.alloc(74)
  const signatureText = `untrusted comment: signature\n${signaturePacket.toString("base64")}\ntrusted comment: timestamp:0\n${globalPacket.toString("base64")}\n`
  const signature = Buffer.from(signatureText).toString("base64")
  return { publicKey: Buffer.from(publicText).toString("base64"), signature }
}

function writeArtifact(dir, name, contents = name) {
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  writeFileSync(file, contents)
  return file
}

function createReleaseFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ideall-release-artifacts-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const keys = makeMinisignFixtures()
  const configDir = path.join(root, "src-tauri")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    path.join(configDir, "tauri.conf.json"),
    JSON.stringify({ plugins: { updater: { pubkey: keys.publicKey } } }),
  )

  const version = "0.1.0"
  const definitions = {
    "macos-arm64": [
      ["ideall_0.1.0_aarch64.dmg"],
      ["ideall.app.tar.gz"],
      ["ideall.app.tar.gz.sig", keys.signature],
    ],
    "macos-x64": [
      ["ideall_0.1.0_x64.dmg"],
      ["ideall.app.tar.gz"],
      ["ideall.app.tar.gz.sig", keys.signature],
    ],
    "linux-x64": [
      ["ideall_0.1.0_amd64.deb"],
      ["ideall_0.1.0_amd64.deb.sig", keys.signature],
      ["ideall-0.1.0-1.x86_64.rpm"],
      ["ideall-0.1.0-1.x86_64.rpm.sig", keys.signature],
      ["ideall_0.1.0_amd64.AppImage"],
      ["ideall_0.1.0_amd64.AppImage.sig", keys.signature],
    ],
    "windows-x64": [
      ["ideall_0.1.0_x64_en-US.msi"],
      ["ideall_0.1.0_x64_en-US.msi.sig", keys.signature],
      ["ideall_0.1.0_x64-setup.exe"],
      ["ideall_0.1.0_x64-setup.exe.sig", keys.signature],
    ],
  }

  const stageRoot = path.join(root, "stages")
  for (const [label, files] of Object.entries(definitions)) {
    const buildDir = path.join(root, "build", label)
    const paths = files.map(([name, contents]) => writeArtifact(buildDir, name, contents))
    stageReleaseArtifacts({
      label,
      version,
      artifactPaths: paths,
      outputDir: path.join(stageRoot, `desktop-${label}`),
      root,
    })
  }
  return { root, stageRoot, version }
}

function stageManifestFile(stageRoot, label) {
  return path.join(stageRoot, `desktop-${label}`, "manifest.json")
}

function prepareFixture({ root, stageRoot, version }) {
  return prepareReleaseArtifacts({
    inputDir: stageRoot,
    outputDir: path.join(root, "ready"),
    version,
    tag: "app-v0.1.0",
    repository: "jinziyou/ideall",
    notes: "release notes",
    pubDate: "2026-07-11T00:00:00.000Z",
    root,
  })
}

test("release preflight 校验 embed CSP 和 updater key id", () => {
  const keys = makeMinisignFixtures()
  assert.equal(
    assertEmbedOriginAllowed(
      "https://portal.example.test/info",
      "default-src 'self'; frame-src 'self' https://portal.example.test;",
    ),
    "https://portal.example.test",
  )
  assert.throws(
    () => assertEmbedOriginAllowed("https://evil.example", "frame-src 'self'"),
    /不在 Tauri CSP/,
  )
  assert.equal(assertSignatureMatchesPublicKey(keys.signature, keys.publicKey), "0102030405060708")
})

test("删除不存在的 GitHub tag ref 保持幂等且不吞掉其他 422", async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const client = new GitHubReleaseClient({
    owner: "jinziyou",
    repo: "ideall",
    token: "test-token",
  })

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "Reference does not exist" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    })
  await assert.doesNotReject(client.deleteRef("missing"))

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "Validation Failed" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    })
  await assert.rejects(client.deleteRef("invalid"), /422:.*Validation Failed/)
})

test("artifact-first 聚合四个平台并确定性生成 latest.json 与 SHA256SUMS", (t) => {
  const fixture = createReleaseFixture(t)
  const { root } = fixture
  const outputDir = path.join(root, "ready")
  const result = prepareFixture(fixture)
  assert.deepEqual(result.manifest.updaterPlatforms, [
    "darwin-aarch64",
    "darwin-aarch64-app",
    "darwin-x86_64",
    "darwin-x86_64-app",
    "linux-x86_64",
    "linux-x86_64-appimage",
    "windows-x86_64",
    "windows-x86_64-msi",
    "windows-x86_64-nsis",
  ])
  assert.match(
    result.latest.platforms["darwin-aarch64"].url,
    /app-v0\.1\.0\/ideall_0\.1\.0_aarch64\.app\.tar\.gz$/,
  )
  assert.equal(result.latest.platforms["windows-x86_64"].url.endsWith(".msi"), true)
  assert.match(readFileSync(path.join(outputDir, "SHA256SUMS"), "utf8"), /latest\.json/)
})

test("prepare 拒绝不安全的 stage manifest asset 名称", async (t) => {
  const cases = [
    ["空名", "", /名称必须是非空字符串/],
    ["上级路径", "../escape", /名称必须是单一文件名/],
    ["POSIX 绝对路径", "/tmp/escape", /名称必须是单一文件名/],
    ["Windows 绝对路径", "C:\\escape", /名称必须是单一文件名/],
    ["POSIX 路径分隔符", "nested/escape", /名称必须是单一文件名/],
    ["Windows 路径分隔符", "nested\\escape", /名称必须是单一文件名/],
  ]

  for (const [description, unsafeName, expected] of cases) {
    await t.test(description, (t) => {
      const fixture = createReleaseFixture(t)
      const manifestFile = stageManifestFile(fixture.stageRoot, "macos-arm64")
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
      manifest.files[0].name = unsafeName
      writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
      assert.throws(() => prepareFixture(fixture), expected)
    })
  }
})

test("prepare 拒绝同一 stage manifest 内的重复 asset 名称", (t) => {
  const fixture = createReleaseFixture(t)
  const manifestFile = stageManifestFile(fixture.stageRoot, "macos-arm64")
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
  manifest.files[1].name = manifest.files[0].name
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)

  assert.throws(() => prepareFixture(fixture), /stage manifest 内 asset 名称冲突/)
})

test("prepare 拒绝指向 stage assets 目录外的符号链接", (t) => {
  const fixture = createReleaseFixture(t)
  const manifestFile = stageManifestFile(fixture.stageRoot, "macos-arm64")
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
  const entry = manifest.files[0]
  const assetFile = path.join(path.dirname(manifestFile), "assets", entry.name)
  const outsideFile = writeArtifact(
    path.join(fixture.root, "outside-stage"),
    entry.name,
    readFileSync(assetFile),
  )
  rmSync(assetFile)
  try {
    symlinkSync(outsideFile, assetFile, "file")
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("当前系统不允许创建文件符号链接")
      return
    }
    throw error
  }

  assert.throws(() => prepareFixture(fixture), /越出 stage assets/)
})

class FakeReleaseClient {
  constructor({ failUpload = false, failPromotion = false, promotionVisibilityMisses = 0 } = {}) {
    this.failUpload = failUpload
    this.failPromotion = failPromotion
    this.promotionVisibilityMisses = promotionVisibilityMisses
    this.nextId = 2
    this.releases = new Map([
      [
        "app-edge",
        {
          id: 1,
          tag_name: "app-edge",
          name: "old edge",
          body: "old",
          draft: false,
          prerelease: true,
          upload_url: "https://uploads.invalid/{?name,label}",
          assets: [],
        },
      ],
    ])
    this.refs = new Map([["app-edge", { object: { sha: "old-sha" } }]])
  }

  async getReleaseByTag(tag) {
    const release = this.releases.get(tag) ?? null
    if (tag === "app-edge" && release?.id !== 1 && this.promotionVisibilityMisses > 0) {
      this.promotionVisibilityMisses -= 1
      return null
    }
    return release
  }
  async getRef(tag) {
    return this.refs.get(tag) ?? null
  }
  async createRef(tag, sha) {
    this.refs.set(tag, { object: { sha } })
  }
  async deleteRef(tag) {
    this.refs.delete(tag)
  }
  async createRelease(data) {
    const release = {
      id: this.nextId++,
      ...data,
      upload_url: "https://uploads.invalid/{?name,label}",
      assets: [],
    }
    this.releases.set(data.tag_name, release)
    return release
  }
  async updateRelease(id, data) {
    const entry = [...this.releases].find(([, release]) => release.id === id)
    if (!entry) throw new Error("missing release")
    if (this.failPromotion && data.tag_name === "app-edge" && id !== 1) {
      throw new Error("promotion failed")
    }
    const [oldTag, release] = entry
    this.releases.delete(oldTag)
    Object.assign(release, data)
    this.releases.set(data.tag_name ?? oldTag, release)
    if (data.tag_name && data.target_commitish) {
      this.refs.set(data.tag_name, { object: { sha: data.target_commitish } })
    }
    return release
  }
  async deleteRelease(id) {
    const entry = [...this.releases].find(([, release]) => release.id === id)
    if (entry) this.releases.delete(entry[0])
  }
  async uploadAsset(release, file) {
    if (this.failUpload) throw new Error("upload failed")
    release.assets.push({ name: file.name, size: file.size, state: "uploaded" })
  }
  async listAssets(id) {
    return [...this.releases.values()].find((release) => release.id === id)?.assets ?? []
  }
}

function publishFixture(client) {
  return publishPreparedRelease({
    client,
    prepared: { files: [{ name: "asset.bin", size: 1, sha256: "0".repeat(64) }] },
    metadata: {
      isTag: false,
      tag: "app-edge",
      sha: "new-sha",
      name: "new edge",
      body: "new",
      runId: "42",
      runAttempt: "1",
    },
    logger: { warn() {} },
    visibilityDelays: [0, 1, 1],
  })
}

function publishTagFixture(client) {
  return publishPreparedRelease({
    client,
    prepared: { files: [{ name: "asset.bin", size: 1, sha256: "0".repeat(64) }] },
    metadata: {
      isTag: true,
      tag: "app-v0.1.0",
      sha: "tag-sha",
      name: "ideall app-v0.1.0",
      body: "",
      runId: "43",
      runAttempt: "1",
    },
    logger: { warn() {} },
  })
}

test("staging asset 上传失败时旧 app-edge 完全保留", async () => {
  const client = new FakeReleaseClient({ failUpload: true })
  await assert.rejects(publishFixture(client), /upload failed/)
  assert.equal(client.releases.get("app-edge")?.id, 1)
  assert.equal(client.refs.get("app-edge")?.object.sha, "old-sha")
})

test("app-edge promotion 失败时回滚旧 Release 与 tag", async () => {
  const client = new FakeReleaseClient({ failPromotion: true })
  await assert.rejects(publishFixture(client), /promotion failed/)
  assert.equal(client.releases.get("app-edge")?.id, 1)
  assert.equal(client.refs.get("app-edge")?.object.sha, "old-sha")
})

test("app-edge promotion 等待 GitHub tag Release 最终一致后再清理旧版本", async () => {
  const client = new FakeReleaseClient({ promotionVisibilityMisses: 1 })
  const release = await publishFixture(client)
  assert.equal(release.id, 2)
  assert.equal(client.releases.get("app-edge")?.id, 2)
  assert.equal(client.refs.get("app-edge")?.object.sha, "new-sha")
  assert.equal(client.releases.has("app-edge-backup-42-1"), false)
})

test("正式 tag 在资产完整后仍保持 draft 且不是 prerelease", async () => {
  const client = new FakeReleaseClient()
  await publishTagFixture(client)
  const release = client.releases.get("app-v0.1.0")
  assert.equal(release?.draft, true)
  assert.equal(release?.prerelease, false)
  assert.equal(Object.hasOwn(release, "make_latest"), false)
})
