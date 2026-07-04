// 一切皆文件: 文件类型识别、预览策略与展示色板的唯一数据来源。
// 不依赖 React, 供资源列表、文件查看器、标签条、agent 上下文等复用。

export type FilePreviewKind =
  | "image"
  | "svg"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "code"
  | "json"
  | "csv"
  | "text"
  | "spreadsheet"
  | "document"
  | "presentation"
  | "archive"
  | "font"
  | "model"
  | "binary"
  | "other"

export type FileKind = "image" | "video" | "audio" | "pdf" | "text" | "archive" | "other"

export type FileTypeTone =
  | "sky"
  | "violet"
  | "emerald"
  | "amber"
  | "rose"
  | "cyan"
  | "slate"
  | "zinc"

export type FileTypeInfo = {
  ext: string
  mime: string
  kind: FileKind
  preview: FilePreviewKind
  group: "image" | "media" | "document" | "code" | "data" | "archive" | "binary" | "other"
  label: string
  editable: boolean
  language?: string
  tone: FileTypeTone
}

const EXT_LANG: Record<string, string> = {
  js: "JavaScript",
  jsx: "JavaScript React",
  mjs: "JavaScript",
  cjs: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript React",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  less: "Less",
  html: "HTML",
  htm: "HTML",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  py: "Python",
  rb: "Ruby",
  php: "PHP",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  go: "Go",
  rs: "Rust",
  c: "C",
  h: "C Header",
  cpp: "C++",
  cxx: "C++",
  cc: "C++",
  hpp: "C++ Header",
  cs: "C#",
  fs: "F#",
  fsx: "F#",
  dart: "Dart",
  scala: "Scala",
  lua: "Lua",
  r: "R",
  jl: "Julia",
  pl: "Perl",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hrl: "Erlang Header",
  clj: "Clojure",
  cljs: "ClojureScript",
  hs: "Haskell",
  ml: "OCaml",
  mli: "OCaml Interface",
  nim: "Nim",
  zig: "Zig",
  elm: "Elm",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  fish: "Fish",
  ps1: "PowerShell",
  bat: "Batch",
  cmd: "Batch",
  sql: "SQL",
  graphql: "GraphQL",
  gql: "GraphQL",
  proto: "Protocol Buffers",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  toml: "TOML",
  ini: "INI",
  env: "Environment",
  lock: "Lockfile",
}

const CODE_EXTS = new Set(Object.keys(EXT_LANG))
const MARKDOWN_EXTS = new Set(["md", "markdown", "mdx"])
const JSON_EXTS = new Set(["json", "jsonc", "json5", "map", "webmanifest", "ipynb"])
const CSV_EXTS = new Set(["csv", "tsv"])
const YAML_EXTS = new Set(["yml", "yaml"])
const TEXT_EXTS = new Set([
  "txt",
  "log",
  "xml",
  "rtf",
  "tex",
  "diff",
  "patch",
  "gitignore",
  "gitattributes",
  "editorconfig",
])
const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "heic",
  "heif",
])
const VIDEO_EXTS = new Set([
  "mp4",
  "webm",
  "mov",
  "m4v",
  "avi",
  "mkv",
  "ogv",
  "wmv",
  "mpg",
  "mpeg",
  "3gp",
])
const AUDIO_EXTS = new Set([
  "mp3",
  "wav",
  "ogg",
  "oga",
  "m4a",
  "aac",
  "flac",
  "opus",
  "weba",
  "aiff",
  "aif",
])
const ARCHIVE_EXTS = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "zst",
  "cab",
  "dmg",
  "iso",
  "apk",
])
const SPREADSHEET_EXTS = new Set(["xls", "xlsx", "xlsm", "ods", "numbers"])
const DOCUMENT_EXTS = new Set(["doc", "docx", "odt", "pages", "epub", "mobi"])
const PRESENTATION_EXTS = new Set(["ppt", "pptx", "pps", "ppsx", "odp", "key"])
const FONT_EXTS = new Set(["ttf", "otf", "woff", "woff2", "eot"])
const MODEL_EXTS = new Set(["obj", "fbx", "glb", "gltf", "stl", "usdz"])
const DATABASE_EXTS = new Set(["db", "sqlite", "sqlite3", "duckdb"])
const BINARY_DATA_EXTS = new Set(["parquet", "arrow", "avro", "orc", "feather"])

export function fileExtension(name: string): string {
  const base = name.trim().toLowerCase().split(/[\\/]/).pop() ?? ""
  if (!base) return ""
  if (base === "dockerfile" || base === "makefile") return base
  if (base.startsWith(".") && !base.includes(".", 1)) return base.slice(1)
  return base.split(".").pop() ?? ""
}

export function fileTypeInfo(name: string, type = ""): FileTypeInfo {
  const ext = fileExtension(name)
  const mime = type.toLowerCase()

  if (mime.startsWith("image/svg") || ext === "svg") {
    return info(ext, mime, "image", "svg", "image", "SVG", true, "SVG", "emerald")
  }
  if (mime.startsWith("image/") || IMAGE_EXTS.has(ext)) {
    return info(
      ext,
      mime,
      "image",
      "image",
      "image",
      extLabel(ext, "Image"),
      false,
      undefined,
      "emerald",
    )
  }
  if (mime.startsWith("video/") || VIDEO_EXTS.has(ext)) {
    return info(
      ext,
      mime,
      "video",
      "video",
      "media",
      extLabel(ext, "Video"),
      false,
      undefined,
      "rose",
    )
  }
  if (mime.startsWith("audio/") || AUDIO_EXTS.has(ext)) {
    return info(
      ext,
      mime,
      "audio",
      "audio",
      "media",
      extLabel(ext, "Audio"),
      false,
      undefined,
      "cyan",
    )
  }
  if (mime === "application/pdf" || ext === "pdf") {
    return info(ext, mime, "pdf", "pdf", "document", "PDF", false, undefined, "rose")
  }
  if (MARKDOWN_EXTS.has(ext)) {
    return info(
      ext,
      mime,
      "text",
      "markdown",
      "document",
      ext === "mdx" ? "MDX" : "Markdown",
      true,
      "Markdown",
      "sky",
    )
  }
  if (JSON_EXTS.has(ext) || mime.includes("json")) {
    return info(ext, mime, "text", "json", "data", "JSON", true, "JSON", "amber")
  }
  if (CSV_EXTS.has(ext)) {
    return info(
      ext,
      mime,
      "text",
      "csv",
      "data",
      ext === "tsv" ? "TSV" : "CSV",
      true,
      ext.toUpperCase(),
      "amber",
    )
  }
  if (YAML_EXTS.has(ext) || mime.includes("yaml")) {
    return info(ext, mime, "text", "code", "data", "YAML", true, "YAML", "amber")
  }
  if (CODE_EXTS.has(ext) || mime.includes("javascript")) {
    return info(
      ext,
      mime,
      "text",
      "code",
      "code",
      EXT_LANG[ext] ?? extLabel(ext, "Code"),
      true,
      EXT_LANG[ext] ?? ext.toUpperCase(),
      "violet",
    )
  }
  if (mime.startsWith("text/") || TEXT_EXTS.has(ext) || mime.includes("xml")) {
    return info(
      ext,
      mime,
      "text",
      "text",
      "document",
      extLabel(ext, "Text"),
      true,
      ext ? ext.toUpperCase() : "Text",
      "sky",
    )
  }
  if (SPREADSHEET_EXTS.has(ext) || mime.includes("spreadsheet") || mime.includes("excel")) {
    return info(
      ext,
      mime,
      "other",
      "spreadsheet",
      "document",
      extLabel(ext, "Spreadsheet"),
      false,
      undefined,
      "emerald",
    )
  }
  if (
    DOCUMENT_EXTS.has(ext) ||
    mime.includes("msword") ||
    mime.includes("wordprocessingml") ||
    mime.includes("opendocument.text")
  ) {
    return info(
      ext,
      mime,
      "other",
      "document",
      "document",
      extLabel(ext, "Document"),
      false,
      undefined,
      "sky",
    )
  }
  if (PRESENTATION_EXTS.has(ext) || mime.includes("presentation") || mime.includes("powerpoint")) {
    return info(
      ext,
      mime,
      "other",
      "presentation",
      "document",
      extLabel(ext, "Presentation"),
      false,
      undefined,
      "amber",
    )
  }
  if (DATABASE_EXTS.has(ext)) {
    return info(
      ext,
      mime,
      "other",
      "binary",
      "data",
      extLabel(ext, "Database"),
      false,
      undefined,
      "amber",
    )
  }
  if (BINARY_DATA_EXTS.has(ext)) {
    return info(
      ext,
      mime,
      "other",
      "binary",
      "data",
      extLabel(ext, "Data"),
      false,
      undefined,
      "amber",
    )
  }
  if (
    ARCHIVE_EXTS.has(ext) ||
    mime.includes("zip") ||
    mime.includes("compressed") ||
    mime.includes("gzip")
  ) {
    return info(
      ext,
      mime,
      "archive",
      "archive",
      "archive",
      extLabel(ext, "Archive"),
      false,
      undefined,
      "slate",
    )
  }
  if (FONT_EXTS.has(ext) || mime.includes("font")) {
    return info(
      ext,
      mime,
      "other",
      "font",
      "binary",
      extLabel(ext, "Font"),
      false,
      undefined,
      "violet",
    )
  }
  if (MODEL_EXTS.has(ext)) {
    return info(
      ext,
      mime,
      "other",
      "model",
      "binary",
      extLabel(ext, "3D"),
      false,
      undefined,
      "cyan",
    )
  }
  if (mime) {
    return info(
      ext,
      mime,
      "other",
      "binary",
      "binary",
      extLabel(ext, "Binary"),
      false,
      undefined,
      "zinc",
    )
  }
  return info(ext, mime, "other", "other", "other", extLabel(ext, "File"), false, undefined, "zinc")
}

export function fileKind(name: string, type = ""): FileKind {
  return fileTypeInfo(name, type).kind
}

export function isEditableFile(name: string, type = ""): boolean {
  return fileTypeInfo(name, type).editable
}

function info(
  ext: string,
  mime: string,
  kind: FileKind,
  preview: FilePreviewKind,
  group: FileTypeInfo["group"],
  label: string,
  editable: boolean,
  language: string | undefined,
  tone: FileTypeTone,
): FileTypeInfo {
  return { ext, mime, kind, preview, group, label, editable, language, tone }
}

function extLabel(ext: string, fallback: string): string {
  return ext ? ext.toUpperCase() : fallback
}
