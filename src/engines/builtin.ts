import type { EngineDescriptor } from "@protocol/engine"
import { EngineRegistry } from "./registry"

export const BUILTIN_ENGINES = [
  {
    engineId: "ideall.note",
    label: "笔记",
    match: { mediaTypes: ["application/vnd.ideall.note+json"] },
    priority: 1000,
    layout: "fill",
    access: "read-write",
    supportsStandaloneWindow: true,
    iconHint: "note",
  },
  {
    engineId: "ideall.bookmark",
    label: "书签",
    match: { mediaTypes: ["application/vnd.ideall.bookmark+json"] },
    priority: 950,
    layout: "padded",
    access: "read-write",
    supportsStandaloneWindow: true,
    iconHint: "bookmark",
  },
  {
    engineId: "ideall.feed",
    label: "关注",
    match: { mediaTypes: ["application/vnd.ideall.feed+json"] },
    priority: 950,
    layout: "padded",
    access: "read-only",
    supportsStandaloneWindow: true,
    iconHint: "feed",
  },
  {
    engineId: "ideall.thread",
    label: "对话",
    match: { mediaTypes: ["application/vnd.ideall.thread+json"] },
    priority: 950,
    layout: "fill",
    access: "read-write",
    supportsStandaloneWindow: true,
    iconHint: "thread",
  },
  {
    engineId: "ideall.audio",
    label: "音频",
    match: {
      kinds: ["file", "directory"],
      mediaTypes: [
        "audio/*",
        "application/vnd.ideall.audio+json",
        "application/vnd.ideall.audio.library+json",
      ],
    },
    priority: 900,
    layout: "padded",
    access: "read-only",
    supportsStandaloneWindow: true,
    iconHint: "audio",
  },
  {
    engineId: "ideall.installed-app",
    label: "本机应用",
    match: {
      kinds: ["file"],
      mediaTypes: ["application/vnd.ideall.installed-app+json"],
    },
    priority: 940,
    layout: "padded",
    access: "read-only",
    supportsStandaloneWindow: false,
    iconHint: "app",
  },
  {
    engineId: "ideall.database",
    label: "数据库",
    match: {
      kinds: ["file", "directory"],
      mediaTypes: [
        "application/vnd.ideall.database+json",
        "application/vnd.ideall.database.workspace+json",
        "application/x-sqlite3",
      ],
    },
    priority: 880,
    layout: "padded",
    access: "read-write",
    supportsStandaloneWindow: true,
    iconHint: "database",
  },
  {
    engineId: "ideall.git",
    label: "Git",
    match: {
      kinds: ["file", "directory"],
      mediaTypes: [
        "inode/directory",
        "application/vnd.ideall.git+json",
        "application/vnd.ideall.git.repositories+json",
      ],
      properties: { git: true },
    },
    priority: 870,
    layout: "padded",
    access: "read-write",
    supportsStandaloneWindow: false,
    iconHint: "git",
  },
  {
    engineId: "ideall.shell",
    label: "终端",
    match: { mediaTypes: ["application/vnd.ideall.shell+json"] },
    priority: 860,
    layout: "fill",
    access: "read-write",
    supportsStandaloneWindow: false,
    iconHint: "terminal",
  },
  {
    engineId: "ideall.code",
    label: "开发",
    match: {
      kinds: ["file"],
      mediaTypes: [
        "text/*",
        "application/json",
        "application/vnd.ideall.database+json",
        "application/javascript",
        "application/typescript",
        "application/xml",
        "image/svg+xml",
      ],
    },
    priority: 700,
    layout: "fill",
    access: "read-write",
    suspension: "serializable",
    supportsStandaloneWindow: true,
    iconHint: "code",
  },
  {
    engineId: "ideall.directory",
    label: "文件树",
    match: { kinds: ["directory"] },
    priority: 600,
    layout: "padded",
    access: "read-only",
    supportsStandaloneWindow: true,
    iconHint: "folder",
  },
  {
    engineId: "ideall.browser",
    label: "浏览器",
    match: {
      mediaTypes: [
        "text/uri-list",
        "application/vnd.ideall.browser.*+json",
        "application/vnd.ideall.bookmark+json",
      ],
    },
    // text/uri-list 也会命中通用 Code 的 text/*；浏览器语义更具体，应优先。
    priority: 750,
    layout: "fill",
    access: "read-only",
    // BrowserView 依赖仅授权给 main 窗口的 Tauri browser IPC。
    supportsStandaloneWindow: false,
    iconHint: "browser",
  },
  {
    engineId: "ideall.connected",
    label: "连接应用",
    match: {
      mediaTypes: [
        "application/vnd.ideall.info.*+json",
        "application/vnd.ideall.community.*+json",
        "application/vnd.ideall.tool.*+json",
        "application/vnd.ideall.app+json",
      ],
    },
    priority: 500,
    layout: "fill",
    access: "read-only",
    // 连接 App 可能使用 browser/apps/secure-store 等主窗口宿主能力。
    supportsStandaloneWindow: false,
    iconHint: "connected",
  },
  {
    engineId: "ideall.panel-fill",
    label: "ideall 面板",
    match: {
      mediaTypes: ["application/vnd.ideall.panel.*+json"],
      properties: { panelLayout: "fill" },
    },
    priority: 451,
    layout: "fill",
    access: "read-only",
    supportsStandaloneWindow: false,
    iconHint: "panel",
  },
  {
    engineId: "ideall.panel",
    label: "ideall 面板",
    match: {
      mediaTypes: ["application/vnd.ideall.panel.*+json"],
      properties: { panelLayout: "padded" },
    },
    priority: 450,
    layout: "padded",
    access: "read-only",
    // 面板是主窗口功能入口，其中包含 Apps、设置与 Agent 等特权宿主 UI。
    supportsStandaloneWindow: false,
    iconHint: "panel",
  },
  {
    engineId: "ideall.preview",
    label: "通用预览",
    match: { kinds: ["file", "directory"] },
    priority: -1000,
    layout: "fill",
    access: "read-only",
    suspension: "serializable",
    supportsStandaloneWindow: true,
    iconHint: "file",
  },
] as const satisfies readonly EngineDescriptor[]

export const engineRegistry = new EngineRegistry()

export function registerBuiltInEngines(): void {
  for (const descriptor of BUILTIN_ENGINES) {
    if (!engineRegistry.get(descriptor.engineId)) engineRegistry.register(descriptor)
  }
}
