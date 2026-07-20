"use client"

import * as React from "react"
import highlight from "highlight.js/lib/core"

import { cn } from "@/lib/utils"
import { HIGHLIGHT_LANGUAGES, highlightLanguageForFile } from "./highlight-languages"

export type CodeEditorProps = {
  value: string
  filename: string
  language?: string
  readOnly?: boolean
  className?: string
  onChange: (value: string) => void
}

for (const [name, grammar] of Object.entries(HIGHLIGHT_LANGUAGES)) {
  if (!highlight.getLanguage(name)) highlight.registerLanguage(name, grammar)
}

const syntaxClassName =
  "**:[.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable]:text-blue-700 dark:**:[.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable]:text-blue-300 **:[.hljs-built\\_in,.hljs-symbol]:text-orange-700 dark:**:[.hljs-built\\_in,.hljs-symbol]:text-orange-300 **:[.hljs-comment,.hljs-code,.hljs-formula]:text-muted-foreground **:[.hljs-emphasis]:italic **:[.hljs-keyword,.hljs-doctag,.hljs-template-tag,.hljs-template-variable,.hljs-type]:text-red-700 dark:**:[.hljs-keyword,.hljs-doctag,.hljs-template-tag,.hljs-template-variable,.hljs-type]:text-red-300 **:[.hljs-name,.hljs-quote,.hljs-selector-tag,.hljs-selector-pseudo]:text-green-700 dark:**:[.hljs-name,.hljs-quote,.hljs-selector-tag,.hljs-selector-pseudo]:text-green-300 **:[.hljs-regexp,.hljs-string]:text-sky-800 dark:**:[.hljs-regexp,.hljs-string]:text-sky-300 **:[.hljs-section,.hljs-strong]:font-bold **:[.hljs-title]:text-violet-700 dark:**:[.hljs-title]:text-violet-300"

export default function CodeEditor({
  value,
  filename,
  language,
  readOnly = false,
  className,
  onChange,
}: CodeEditorProps) {
  const codeRef = React.useRef<HTMLPreElement>(null)
  const gutterRef = React.useRef<HTMLPreElement>(null)
  const languageName = highlightLanguageForFile(filename, language)
  const highlighted = React.useMemo(() => {
    if (!languageName) return escapeHtml(value)
    try {
      return highlight.highlight(value, { language: languageName, ignoreIllegals: true }).value
    } catch {
      return escapeHtml(value)
    }
  }, [languageName, value])
  const lines = React.useMemo(
    () => Array.from({ length: Math.max(1, value.split("\n").length) }, (_, index) => index + 1),
    [value],
  )

  const syncScroll = React.useCallback((target: HTMLTextAreaElement) => {
    if (codeRef.current) {
      codeRef.current.style.transform = `translate(${-target.scrollLeft}px, ${-target.scrollTop}px)`
    }
    if (gutterRef.current) {
      gutterRef.current.style.transform = `translateY(${-target.scrollTop}px)`
    }
  }, [])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (readOnly || event.key !== "Tab") return
      event.preventDefault()
      const target = event.currentTarget
      const next = indentSelection(
        value,
        target.selectionStart,
        target.selectionEnd,
        event.shiftKey,
      )
      onChange(next.value)
      window.requestAnimationFrame(() => {
        target.setSelectionRange(next.selectionStart, next.selectionEnd)
      })
    },
    [onChange, readOnly, value],
  )

  return (
    <div
      className={cn(
        "relative h-full overflow-hidden bg-background text-left font-mono text-[13px] leading-[1.55]",
        className,
      )}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <aside className="absolute inset-y-0 left-0 w-14 overflow-hidden border-r bg-muted/35 text-right text-muted-foreground">
          <pre
            ref={gutterRef}
            className="m-0 min-h-full px-3 py-2.5 font-inherit leading-[inherit]"
          >
            {lines.join("\n")}
          </pre>
        </aside>
        <pre
          ref={codeRef}
          className={cn(
            "absolute left-14 top-0 m-0 min-h-full min-w-[calc(100%-3.5rem)] whitespace-pre px-3 py-2.5 font-inherit leading-[inherit] text-foreground",
            syntaxClassName,
          )}
        >
          <code dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }} />
        </pre>
      </div>
      <textarea
        value={value}
        readOnly={readOnly}
        wrap="off"
        spellCheck={false}
        aria-label={`${filename} 代码${readOnly ? "预览" : "编辑器"}`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={(event) => syncScroll(event.currentTarget)}
        className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre border-0 bg-transparent py-2.5 pl-[4.25rem] pr-3 font-inherit leading-[inherit] text-transparent caret-foreground outline-none selection:bg-primary/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/45"
      />
    </div>
  )
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function indentSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  outdent: boolean,
): { value: string; selectionStart: number; selectionEnd: number } {
  const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1
  const selected = value.slice(lineStart, selectionEnd)

  if (!outdent) {
    const indented = `\t${selected.replaceAll("\n", "\n\t")}`
    return {
      value: value.slice(0, lineStart) + indented + value.slice(selectionEnd),
      selectionStart: selectionStart + 1,
      selectionEnd: selectionEnd + (indented.length - selected.length),
    }
  }

  let removedBeforeStart = 0
  let removedTotal = 0
  const outdented = selected.replace(
    /(^|\n)(\t| {1,2})/g,
    (match, prefix: string, _indent: string, offset: number) => {
      const removed = match.length - prefix.length
      if (lineStart + offset < selectionStart) removedBeforeStart += removed
      removedTotal += removed
      return prefix
    },
  )
  return {
    value: value.slice(0, lineStart) + outdented + value.slice(selectionEnd),
    selectionStart: Math.max(lineStart, selectionStart - removedBeforeStart),
    selectionEnd: Math.max(lineStart, selectionEnd - removedTotal),
  }
}
