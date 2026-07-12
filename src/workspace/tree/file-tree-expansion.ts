"use client"

import * as React from "react"
import { fileRefKey, type FileRef, type IdeallFile } from "@protocol/file-system"

export const FILE_TREE_EXPANDED_STORAGE_KEY = "ideall:file-system-tree:expanded"

/** 目录若明确声明没有子项，就按普通页面处理；未知时保留可展开能力。 */
export function fileCanExpand(
  file: IdeallFile | null | undefined,
): file is IdeallFile & { kind: "directory" } {
  return file?.kind === "directory" && file.properties?.hasChildren !== false
}

export function updateExpandedFileKeys(
  current: Set<string>,
  ref: FileRef,
  expanded: boolean,
): Set<string> {
  const key = fileRefKey(ref)
  if (current.has(key) === expanded) return current
  const next = new Set(current)
  if (expanded) next.add(key)
  else next.delete(key)
  return next
}

function readExpandedFileKeys(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(FILE_TREE_EXPANDED_STORAGE_KEY)
    if (!raw) return new Set()
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value)
      ? new Set(value.filter((item): item is string => typeof item === "string"))
      : new Set()
  } catch {
    return new Set()
  }
}

export function useFileTreeExpansion() {
  // 初始状态在服务端/客户端首次渲染都保持一致 (空集合)，避免读取 localStorage 导致 hydration mismatch；
  // 真实的展开记忆改为挂载后的 effect 里再读取。
  const [expanded, setExpandedKeys] = React.useState<Set<string>>(() => new Set())

  React.useEffect(() => {
    setExpandedKeys(readExpandedFileKeys())
  }, [])

  React.useEffect(() => {
    try {
      window.localStorage.setItem(FILE_TREE_EXPANDED_STORAGE_KEY, JSON.stringify([...expanded]))
    } catch {
      /* storage unavailable */
    }
  }, [expanded])

  const setExpanded = React.useCallback((ref: FileRef, value: boolean) => {
    setExpandedKeys((current) => updateExpandedFileKeys(current, ref, value))
  }, [])

  return { expanded, setExpanded }
}
