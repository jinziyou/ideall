import type { NoteContent } from "@protocol/files"

/** 递归提取块文档纯文本，不依赖具体编辑器实现。 */
export function noteText(content: NoteContent): string {
  const parts: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return
    const value = node as { text?: unknown; children?: unknown }
    if (typeof value.text === "string") parts.push(value.text)
    if (Array.isArray(value.children)) {
      for (const child of value.children) walk(child)
    }
  }
  for (const block of content) walk(block)
  return parts.join(" ").replace(/\s+/g, " ").trim()
}
