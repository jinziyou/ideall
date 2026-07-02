// 由域名 / URL 推断 favicon 地址 (Google s2 服务) —— 书签与关注仓库共用, 失败降级为空串。

/** 由域名推断 favicon; 域名为空时降级为空串。 */
export function faviconForDomain(domain: string): string {
  const host = domain.trim()
  return host ? `https://www.google.com/s2/favicons?domain=${host}&sz=64` : ""
}

/** 由完整 URL 推断 favicon (取 hostname); 解析失败降级为空串。 */
export function faviconForUrl(url: string): string {
  try {
    return faviconForDomain(new URL(url).hostname)
  } catch {
    return ""
  }
}
