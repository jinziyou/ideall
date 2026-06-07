import * as React from "react"
import { WONITA_PATH } from "@/lib/brand"

/**
 * Wonita 品牌字形 (内联 SVG, fill=currentColor) —— 跟随文字色, 暗色安全。
 * 用内联而非 <img src="/wonita.svg">: <img> 加载的 SVG 取不到 CSS currentColor, 暗色下会变黑消失。
 */
export function WonitaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 128 128"
      fill="currentColor"
      className={className}
      role="img"
      aria-label="Wonita"
    >
      <path d={WONITA_PATH} />
    </svg>
  )
}
