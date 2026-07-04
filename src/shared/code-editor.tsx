"use client"

import * as React from "react"
import CodeMirror from "@uiw/react-codemirror"
import { EditorView, keymap } from "@codemirror/view"
import { indentWithTab } from "@codemirror/commands"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import type { Extension } from "@codemirror/state"
import { cpp } from "@codemirror/lang-cpp"
import { css } from "@codemirror/lang-css"
import { go } from "@codemirror/lang-go"
import { html } from "@codemirror/lang-html"
import { java } from "@codemirror/lang-java"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { php } from "@codemirror/lang-php"
import { python } from "@codemirror/lang-python"
import { rust } from "@codemirror/lang-rust"
import { sql } from "@codemirror/lang-sql"
import { xml } from "@codemirror/lang-xml"
import { yaml } from "@codemirror/lang-yaml"
import { fileExtension } from "@/lib/format"
import { cn } from "@/lib/utils"

export type CodeEditorProps = {
  value: string
  filename: string
  language?: string
  readOnly?: boolean
  className?: string
  onChange: (value: string) => void
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
    fontSize: "13px",
    lineHeight: "1.55",
  },
  ".cm-content": {
    padding: "10px 0",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--muted) / 0.35)",
    color: "hsl(var(--muted-foreground))",
    borderRight: "1px solid hsl(var(--border))",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--accent) / 0.35)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "hsl(var(--accent) / 0.55)",
    color: "hsl(var(--foreground))",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "hsl(var(--primary) / 0.22)",
  },
  "&.cm-focused": {
    outline: "2px solid hsl(var(--ring) / 0.45)",
    outlineOffset: "-2px",
  },
})

export default function CodeEditor({
  value,
  filename,
  language,
  readOnly = false,
  className,
  onChange,
}: CodeEditorProps) {
  const extensions = React.useMemo(
    () => [
      ...languageExtensions(filename, language),
      EditorView.lineWrapping,
      highlightSelectionMatches(),
      keymap.of([indentWithTab, ...searchKeymap]),
      editorTheme,
    ],
    [filename, language],
  )

  return (
    <CodeMirror
      value={value}
      height="100%"
      editable={!readOnly}
      readOnly={readOnly}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        rectangularSelection: true,
        crosshairCursor: true,
      }}
      extensions={extensions}
      onChange={onChange}
      className={cn("h-full overflow-hidden bg-background text-left", className)}
    />
  )
}

function languageExtensions(filename: string, language = ""): Extension[] {
  const ext = fileExtension(filename)
  const label = language.toLowerCase()
  if (["js", "mjs", "cjs"].includes(ext)) return [javascript()]
  if (ext === "jsx") return [javascript({ jsx: true })]
  if (ext === "ts") return [javascript({ typescript: true })]
  if (ext === "tsx") return [javascript({ jsx: true, typescript: true })]
  if (["json", "jsonc", "json5", "map", "webmanifest", "ipynb"].includes(ext)) return [json()]
  if (["md", "markdown", "mdx"].includes(ext)) return [markdown()]
  if (["html", "htm", "vue", "svelte", "astro"].includes(ext)) return [html()]
  if (["css", "scss", "sass", "less"].includes(ext)) return [css()]
  if (ext === "py" || label.includes("python")) return [python()]
  if (["java", "kt", "kts"].includes(ext)) return [java()]
  if (ext === "php") return [php()]
  if (ext === "rs") return [rust()]
  if (ext === "go") return [go()]
  if (["sql", "sqlite", "duckdb"].includes(ext)) return [sql()]
  if (["xml", "svg"].includes(ext)) return [xml()]
  if (["yml", "yaml"].includes(ext)) return [yaml()]
  if (["c", "h", "cpp", "cxx", "cc", "hpp"].includes(ext)) return [cpp()]
  return []
}
