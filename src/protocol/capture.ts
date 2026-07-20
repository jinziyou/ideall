import type { Bookmark } from "./files"

/** FileSystem specialized action：把外部内容幂等捕获为本地书签。 */
export const CAPTURE_BOOKMARK_ACTION = "capture.bookmark"

/** 捕获对象统一进入“我的 / 收件箱”；归档只移除此标签。 */
export const CAPTURE_INBOX_TAG = "收件箱"

export const CAPTURE_BOOKMARK_TITLE_LIMIT = 512
export const CAPTURE_BOOKMARK_URL_LIMIT = 8_192
export const CAPTURE_BOOKMARK_DESCRIPTION_LIMIT = 2_000
export const CAPTURE_BOOKMARK_FAVICON_LIMIT = 8_192

/** 新闻、社区、浏览器与普通外链共用的最小捕获输入。 */
export type CaptureBookmarkInput = Readonly<{
  title: string
  url: string
  description?: string
  favicon?: string
}>

/** 同一 canonical URL 已存在时返回原对象，不重复创建或重新放回收件箱。 */
export type CaptureBookmarkResult = Readonly<{
  status: "created" | "existing"
  bookmark: Bookmark
}>
