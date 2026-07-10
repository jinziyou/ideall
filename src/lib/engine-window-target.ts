/**
 * 独立引擎窗口只通过这一组不透明标识定位内容。文件 key 的具体编码由
 * filesystem 层负责；本模块只保证它可安全、无损地放进内部 URL。
 */
export interface EngineWindowTarget {
  fileKey: string
  engineId: string
}

export interface ParsedEngineWindowUrl extends EngineWindowTarget {
  pathname: string
  display: "window"
}

const FALLBACK_PATHNAME = "/home"
const MAX_FILE_KEY_LENGTH = 2_048
const MAX_ENGINE_ID_LENGTH = 128
const MAX_URL_LENGTH = 8_192
const MAX_PATHNAME_LENGTH = 256
const ENGINE_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/
const PATHNAME_RE = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/

function hasUnpairedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

export function assertEngineWindowTarget(target: EngineWindowTarget): void {
  if (
    typeof target.fileKey !== "string" ||
    target.fileKey.trim().length === 0 ||
    target.fileKey.length > MAX_FILE_KEY_LENGTH ||
    CONTROL_RE.test(target.fileKey) ||
    target.fileKey.includes("\ufffd") ||
    hasUnpairedSurrogate(target.fileKey)
  ) {
    throw new TypeError("无效的文件引用")
  }
  if (
    typeof target.engineId !== "string" ||
    target.engineId.length > MAX_ENGINE_ID_LENGTH ||
    !ENGINE_ID_RE.test(target.engineId)
  ) {
    throw new TypeError("无效的引擎标识")
  }
}

function isWorkspacePathname(pathname: string): boolean {
  if (
    pathname.length === 0 ||
    pathname.length > MAX_PATHNAME_LENGTH ||
    CONTROL_RE.test(pathname) ||
    pathname.includes("\\") ||
    !PATHNAME_RE.test(pathname)
  ) {
    return false
  }
  return pathname !== "/auth" && !pathname.startsWith("/auth/")
}

/**
 * 独立窗口复用当前工作区 route；认证页、非法路径和根路径统一落到 Home。
 * 不保留原 query/hash，避免把会话恢复或其它路由状态带进新窗口。
 */
export function normalizeEngineWindowPathname(pathname?: string | null): string {
  if (typeof pathname !== "string") return FALLBACK_PATHNAME
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  if (normalized === "/" || !isWorkspacePathname(normalized)) return FALLBACK_PATHNAME
  return normalized
}

export function parseEngineWindowUrl(url: string): ParsedEngineWindowUrl {
  if (
    typeof url !== "string" ||
    url.length === 0 ||
    url.length > MAX_URL_LENGTH ||
    !url.startsWith("/") ||
    url.startsWith("//") ||
    url.includes("\\") ||
    CONTROL_RE.test(url)
  ) {
    throw new TypeError("无效的引擎窗口 URL")
  }

  const base = new URL("https://ideall.invalid/")
  const parsed = new URL(url, base)
  if (
    parsed.origin !== base.origin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    normalizeEngineWindowPathname(parsed.pathname) !== parsed.pathname
  ) {
    throw new TypeError("引擎窗口 URL 必须指向内部工作区")
  }

  const allowedKeys = new Set(["file", "engine", "display"])
  const entries = [...parsed.searchParams.entries()]
  if (
    entries.length !== 3 ||
    entries.some(([key]) => !allowedKeys.has(key)) ||
    parsed.searchParams.getAll("file").length !== 1 ||
    parsed.searchParams.getAll("engine").length !== 1 ||
    parsed.searchParams.getAll("display").length !== 1 ||
    parsed.searchParams.get("display") !== "window"
  ) {
    throw new TypeError("引擎窗口 URL 参数无效")
  }

  const target = {
    fileKey: parsed.searchParams.get("file") ?? "",
    engineId: parsed.searchParams.get("engine") ?? "",
  }
  assertEngineWindowTarget(target)
  return { ...target, pathname: parsed.pathname, display: "window" }
}

/** 构造只含 file/engine/display 的内部深链；display=window 禁止走主会话恢复。 */
export function buildEngineWindowUrl(
  target: EngineWindowTarget,
  currentPathname?: string | null,
): string {
  assertEngineWindowTarget(target)
  const pathname = normalizeEngineWindowPathname(currentPathname)
  const search = new URLSearchParams({
    file: target.fileKey,
    engine: target.engineId,
    display: "window",
  })
  const url = `${pathname}?${search.toString()}`
  parseEngineWindowUrl(url)
  return url
}

function targetHash(target: EngineWindowTarget): string {
  let hash = 0x811c9dc5
  const input = `${target.fileKey}\u0000${target.engineId}`
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(7, "0")
}

/**
 * Tauri label 只含安全字符。target 仅以短 hash 出现，nonce 提供每次打开的唯一性，
 * 避免把文件标识泄漏到原生窗口 label。
 */
export function buildEngineWindowLabel(target: EngineWindowTarget, nonce: string): string {
  assertEngineWindowTarget(target)
  if (typeof nonce !== "string" || !/^[A-Fa-f0-9-]{24,72}$/.test(nonce)) {
    throw new TypeError("无效的窗口 nonce")
  }
  const compactNonce = nonce.replaceAll("-", "").toLowerCase()
  if (compactNonce.length < 24 || compactNonce.length > 64) {
    throw new TypeError("无效的窗口 nonce")
  }
  return `engine-${targetHash(target)}-${compactNonce.slice(0, 32)}`
}
