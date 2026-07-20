import type { LanguageFn } from "highlight.js"

import { fileExtension } from "@/lib/format"

const genericSource: LanguageFn = (hljs) => ({
  name: "Source",
  keywords: {
    keyword:
      "as async await break case catch class const continue def do else enum export extends false finally fn for from function if import in interface let match new null package private protected public return static struct switch throw trait true try type var while with yield",
    literal: "false null true undefined",
  },
  contains: [
    hljs.C_LINE_COMMENT_MODE,
    hljs.C_BLOCK_COMMENT_MODE,
    hljs.HASH_COMMENT_MODE,
    hljs.QUOTE_STRING_MODE,
    hljs.APOS_STRING_MODE,
    hljs.C_NUMBER_MODE,
  ],
})

// All supported formats share a compact tokenizer that preserves comments, strings, numbers and
// common keywords without shipping a parser per language.
export const HIGHLIGHT_LANGUAGES: Readonly<Record<string, LanguageFn>> = Object.freeze({
  bash: genericSource,
  c: genericSource,
  cpp: genericSource,
  css: genericSource,
  go: genericSource,
  html: genericSource,
  java: genericSource,
  javascript: genericSource,
  json: genericSource,
  jsx: genericSource,
  markdown: genericSource,
  php: genericSource,
  python: genericSource,
  rust: genericSource,
  sql: genericSource,
  tsx: genericSource,
  typescript: genericSource,
  xml: genericSource,
  yaml: genericSource,
})

export function highlightLanguageForFile(filename: string, language = ""): string | null {
  const extension = fileExtension(filename)
  const label = language.toLowerCase()

  if (["js", "mjs", "cjs", "jsx"].includes(extension)) return "javascript"
  if (["ts", "tsx"].includes(extension)) return "typescript"
  if (["json", "jsonc", "json5", "map", "webmanifest", "ipynb"].includes(extension)) {
    return "json"
  }
  if (["md", "markdown", "mdx"].includes(extension)) return "markdown"
  if (["html", "htm", "vue", "svelte", "astro"].includes(extension)) return "html"
  if (["css", "scss", "sass", "less"].includes(extension)) return "css"
  if (extension === "py" || label.includes("python")) return "python"
  if (["java", "kt", "kts"].includes(extension)) return "java"
  if (extension === "php") return "php"
  if (extension === "rs") return "rust"
  if (extension === "go") return "go"
  if (["sql", "sqlite", "duckdb"].includes(extension)) return "sql"
  if (["xml", "svg"].includes(extension)) return "xml"
  if (["yml", "yaml"].includes(extension)) return "yaml"
  if (["c", "h", "cpp", "cxx", "cc", "hpp"].includes(extension)) return "cpp"
  if (["sh", "bash", "zsh", "fish"].includes(extension) || label.includes("shell")) return "bash"
  return null
}
