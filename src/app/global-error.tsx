"use client"

import { useEffect } from "react"

// 根 layout 自身的全局错误兜底 (THEME_INIT / BootGate.registerAll / metadata 抛错时)。
// global-error 会替换整个根 layout, 故不依赖 globals.css —— 用内联样式自包含, 保证崩溃也有恢复 UI。
// 段内渲染错误 (layout 之内) 仍由 app/error.tsx → shell/error 承接。
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[global-error]", error)
  }, [error])

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#0b0b0c",
          color: "#e7e7e9",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ width: "100%", maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.05rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            应用启动出错
          </h1>
          <p style={{ fontSize: "0.85rem", opacity: 0.7, margin: "0 0 1rem" }}>
            请重试；若反复出现，可回到「我的」。
          </p>
          <pre
            style={{
              fontSize: "0.72rem",
              textAlign: "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "0.5rem",
              padding: "0.75rem",
              margin: "0 0 1rem",
              opacity: 0.8,
            }}
          >
            {error.message || "未知错误"}
            {error.digest ? `\ndigest: ${error.digest}` : ""}
          </pre>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
            <button
              onClick={() => window.location.assign("/home")}
              style={{
                padding: "0.45rem 0.9rem",
                fontSize: "0.85rem",
                borderRadius: "0.5rem",
                border: "1px solid rgba(255,255,255,0.16)",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              回到「我的」
            </button>
            <button
              onClick={() => reset()}
              style={{
                padding: "0.45rem 0.9rem",
                fontSize: "0.85rem",
                borderRadius: "0.5rem",
                border: "none",
                background: "#e7e7e9",
                color: "#0b0b0c",
                cursor: "pointer",
              }}
            >
              重试
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
