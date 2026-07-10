import type { IdeallFile } from "@protocol/file-system"

/**
 * UI 层内置引擎的严格渲染目标。
 *
 * 这里刻意不做“按文件类型猜 Viewer”的兜底：文件类型只用于引擎匹配，真正打开后必须由
 * 已写入标签的 engineId 决定视图。否则手动选择 preview/code 时会被旧 Node/Panel Viewer
 * 截获，界面显示的引擎与实际 Renderer 不一致。
 */
export type FileEngineRenderer =
  | "node-note"
  | "node-bookmark"
  | "node-feed"
  | "node-thread"
  | "directory"
  | "audio-file"
  | "audio-library"
  | "database"
  | "git"
  | "shell"
  | "browser"
  | "code"
  | "connected"
  | "panel"
  | "preview"
  | "unsupported"

function property(file: IdeallFile, key: string): unknown {
  return file.properties?.[key]
}

function isNodeResource(file: IdeallFile, kind: string): boolean {
  return property(file, "resourceScheme") === "node" && property(file, "resourceKind") === kind
}

/** 解析 engineId 对应的唯一 Renderer；不兼容时明确返回 unsupported，不借用其他引擎。 */
export function resolveFileEngineRenderer(file: IdeallFile, engineId: string): FileEngineRenderer {
  switch (engineId) {
    case "ideall.note":
      return isNodeResource(file, "note") ? "node-note" : "unsupported"
    case "ideall.bookmark":
      return isNodeResource(file, "bookmark") ? "node-bookmark" : "unsupported"
    case "ideall.feed":
      return isNodeResource(file, "feed") ? "node-feed" : "unsupported"
    case "ideall.thread":
      return isNodeResource(file, "thread") ? "node-thread" : "unsupported"
    case "ideall.directory":
      return file.kind === "directory" ? "directory" : "unsupported"
    case "ideall.audio":
      return property(file, "tabKind") === "audio" ? "audio-library" : "audio-file"
    case "ideall.database":
      return "database"
    case "ideall.git":
      return "git"
    case "ideall.shell":
      return "shell"
    case "ideall.browser":
      return typeof property(file, "url") === "string" ||
        property(file, "resourceScheme") === "browser"
        ? "browser"
        : "unsupported"
    case "ideall.code":
      return "code"
    case "ideall.connected":
      return ["info", "community", "tool", "app"].includes(
        typeof property(file, "resourceScheme") === "string"
          ? (property(file, "resourceScheme") as string)
          : "",
      )
        ? "connected"
        : "unsupported"
    case "ideall.panel":
      return typeof property(file, "panelId") === "string" ? "panel" : "unsupported"
    case "ideall.preview":
      return "preview"
    default:
      return "unsupported"
  }
}
