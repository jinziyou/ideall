const HTTP_PROTOCOLS = new Set(["http:", "https:"])

/**
 * 用于“同一信息资产”去重的 HTTP(S) 身份。URL 保留 query，但忽略页面内锚点；
 * URL 自身会规范主机大小写、默认端口和空路径。
 */
export function canonicalHttpUrl(raw: string): string | null {
  if (typeof raw !== "string") return null
  try {
    const url = new URL(raw.trim())
    if (!HTTP_PROTOCOLS.has(url.protocol)) return null
    url.hash = ""
    return url.href
  } catch {
    return null
  }
}
