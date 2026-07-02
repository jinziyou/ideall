"use client"

import { CodeBlockRules } from "@platejs/code-block"
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from "@platejs/code-block/react"
import { common, createLowlight } from "lowlight"

import { CodeBlockElement, CodeLineElement, CodeSyntaxLeaf } from "@/ui/code-block-node"

// common ≈ 37 种主流语言; 全量 all 会把 ~190 种 highlight.js 语法定义打进编辑器 chunk (多 ~1MB)。
// 未注册语言的代码块降级为无高亮纯文本, 不报错。
const lowlight = createLowlight(common)

export const CodeBlockKit = [
  CodeBlockPlugin.configure({
    inputRules: [CodeBlockRules.markdown({ on: "match" })],
    node: { component: CodeBlockElement },
    options: { lowlight },
    shortcuts: { toggle: { keys: "mod+alt+8" } },
  }),
  CodeLinePlugin.withComponent(CodeLineElement),
  CodeSyntaxPlugin.withComponent(CodeSyntaxLeaf),
]
