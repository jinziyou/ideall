// 外部 / 跨用户来源的 URL 在渲染成 <a href> 或 window.open 前必须做协议白名单:
// React 不会拦截 href 中的 javascript:/data: 等伪协议, 跨用户内容 (订阅的他人 peer
// 发布、被投毒的爬取链接、模型给的书签 URL) 一旦含此类 URL, 受害者点击即在本站
// origin 执行脚本, 可窃取 localStorage 中的 auth token 与同步码 (存储型 XSS)。

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * 校验外部 URL 协议安全, 安全则原样返回, 否则返回 undefined。
 * 用法: `<a href={safeHref(url)}>` —— undefined 时 anchor 不可点 (退化为纯文本链接)。
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  try {
    const u = new URL(url);
    return ALLOWED_PROTOCOLS.has(u.protocol) ? url : undefined;
  } catch {
    return undefined; // 相对路径 / 非法 URL 不作为外链处理
  }
}

/** 安全打开外链: 校验协议 + 强制 noopener,noreferrer (防反向 tabnabbing)。非法则忽略。 */
export function openExternal(url: string | null | undefined): void {
  const href = safeHref(url);
  if (href) window.open(href, "_blank", "noopener,noreferrer");
}
