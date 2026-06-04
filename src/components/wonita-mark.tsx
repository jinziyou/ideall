import * as React from "react"

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
      <path d="M17.4921 60.364L22.0561 55.7999L44.0407 64.5423L44.4264 64.1566L40.698 37.158L45.2621 32.5939L49.5047 67.0493L58.19 79.189L64.4545 41.4545H69.9091L89.2727 78.0909H89.7273L95.8182 41.4545L101.364 41.4545L93.6364 88H88.1818L68.9091 51.4545H68.4545L62.3636 88H56.7273L56.9355 86.7457L56.8329 86.8483L45.5192 71.0348L17.4921 60.364Z" />
    </svg>
  )
}
