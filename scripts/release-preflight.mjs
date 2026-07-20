import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

function decodeMinisignText(value, label, { outerBase64 = false } = {}) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}为空`)
  const text = outerBase64 ? Buffer.from(value.trim(), "base64").toString("utf8") : value.trim()
  if (!text.startsWith("untrusted comment:")) {
    throw new Error(`${label}不是 minisign 文本`)
  }
  return text
}

function firstPacket(text, label) {
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry && !entry.endsWith("comment:") && !entry.includes("comment:"))
  if (!line || !/^[A-Za-z0-9+/]+={0,2}$/.test(line)) {
    throw new Error(`${label}缺少 minisign 数据包`)
  }
  const packet = Buffer.from(line, "base64")
  if (packet.length < 10) throw new Error(`${label}的 minisign 数据包过短`)
  return packet
}

export function minisignPublicKeyId(publicKey) {
  const text = decodeMinisignText(publicKey, "updater 公钥", { outerBase64: true })
  return firstPacket(text, "updater 公钥").subarray(2, 10).toString("hex")
}

export function minisignSignatureKeyId(signature) {
  const text = decodeMinisignText(signature, "updater 签名", { outerBase64: true })
  return firstPacket(text, "updater 签名").subarray(2, 10).toString("hex")
}

export function assertEmbedOriginAllowed(embedBase, csp) {
  let origin
  try {
    origin = new URL(embedBase).origin
  } catch {
    throw new Error(`NEXT_PUBLIC_EMBED_BASE 不是绝对 URL: ${embedBase}`)
  }

  const frameDirective = String(csp)
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive === "frame-src" || directive.startsWith("frame-src "))
  if (!frameDirective) throw new Error("Tauri CSP 缺少 frame-src")

  const allowed = new Set(frameDirective.split(/\s+/).slice(1))
  if (!allowed.has(origin)) {
    throw new Error(`NEXT_PUBLIC_EMBED_BASE origin ${origin} 不在 Tauri CSP frame-src 中`)
  }
  return origin
}

export function assertSignatureMatchesPublicKey(signature, publicKey) {
  const signatureId = minisignSignatureKeyId(signature)
  const publicKeyId = minisignPublicKeyId(publicKey)
  if (signatureId !== publicKeyId) {
    throw new Error(`updater 私钥与配置公钥不匹配 (${signatureId} != ${publicKeyId})`)
  }
  return publicKeyId
}

export function runReleasePreflight({ root = ROOT, env = process.env } = {}) {
  const configPath = path.join(root, "src-tauri", "tauri.conf.json")
  const config = JSON.parse(readFileSync(configPath, "utf8"))
  const embedOrigin = assertEmbedOriginAllowed(
    env.NEXT_PUBLIC_EMBED_BASE,
    config.app?.security?.csp,
  )

  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error("bundle.createUpdaterArtifacts=true，但未配置 TAURI_SIGNING_PRIVATE_KEY")
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "ideall-release-preflight-"))
  const fixturePath = path.join(tempDir, "signing-fixture.txt")
  try {
    writeFileSync(fixturePath, "ideall updater signing preflight\n", "utf8")
    const result = spawnSync(PNPM, ["tauri", "signer", "sign", fixturePath], {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    })
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "签名命令失败").trim().slice(-800)
      throw new Error(`updater 私钥或密码无效: ${detail}`)
    }

    const signaturePath = `${fixturePath}.sig`
    const signature = readFileSync(signaturePath, "utf8")
    const keyId = assertSignatureMatchesPublicKey(signature, config.plugins?.updater?.pubkey)
    return { embedOrigin, keyId }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`用法:
  node scripts/release-preflight.mjs

说明:
  校验构建期 embed origin 已被 Tauri CSP 放行，并实际签名临时文件以验证 updater 私钥、密码及配置公钥匹配。`)
    process.exit(0)
  }
  try {
    const result = runReleasePreflight()
    console.log(
      `✓ Release preflight 通过: embed=${result.embedOrigin}, updater-key=${result.keyId}`,
    )
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
