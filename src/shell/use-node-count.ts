"use client"

import * as React from "react"
import { readFile } from "@/filesystem/registry"
import { walkFileDirectory } from "@/filesystem/directory-walk"
import { watchFileSet } from "@/filesystem/watch-set"
import { trashRootRef } from "@/filesystem/trash-file-system"
import {
  corePlaceRef,
  resourceRefForFile,
  type CorePlaceId,
} from "@/filesystem/resource-file-system"

const DIRECTORY_CONTEXT = { actor: "ui", permissions: [], intent: "directory" } as const
const CONTENT_CONTEXT = { actor: "ui", permissions: [], intent: "content" } as const
const WATCH_CONTEXT = { actor: "ui", permissions: [], intent: "watch" } as const
const COUNT_ROOTS = ["subscriptions", "bookmarks", "files", "notes"].map((place) =>
  corePlaceRef(place as CorePlaceId),
)

async function countPlaceKind(
  place: CorePlaceId,
  countedKind: "note" | "bookmark" | "file" | "feed",
  recursiveKind?: "note" | "folder",
): Promise<number> {
  const entries = await walkFileDirectory(corePlaceRef(place), DIRECTORY_CONTEXT, (entry) => {
    const resource = resourceRefForFile(entry.target)
    return Boolean(recursiveKind && resource?.scheme === "node" && resource.kind === recursiveKind)
  })
  return entries.reduce((count, entry) => {
    const resource = resourceRefForFile(entry.target)
    return count + Number(resource?.scheme === "node" && resource.kind === countedKind)
  }, 0)
}

/**
 * 「我的」内容计数 (关注 + 书签 + 资源 + 笔记)。订阅对应 FileSystem 目录实时刷新,
 * 数值增加时 flash 一下 (供「我的」导航项挂数量 badge)。原 nav-link 内联逻辑抽出, 供 rail / 底栏共用。
 */
export function useNodeCount(): { count: number | null; flash: boolean } {
  const [count, setCount] = React.useState<number | null>(null)
  const [flash, setFlash] = React.useState(false)
  const prev = React.useRef<number | null>(null)

  React.useEffect(() => {
    let alive = true
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const [subCount, bmCount, fileCount, noteCount] = await Promise.all([
          countPlaceKind("subscriptions", "feed"),
          countPlaceKind("bookmarks", "bookmark", "folder"),
          countPlaceKind("files", "file"),
          countPlaceKind("notes", "note", "note"),
        ])
        if (!alive) return
        const n = subCount + bmCount + fileCount + noteCount
        if (prev.current !== null && n > prev.current) {
          setFlash(true)
          clearTimeout(flashTimer) // 快速连续关注时不让多枚计时器叠加
          flashTimer = setTimeout(() => {
            if (alive) setFlash(false)
          }, 650)
        }
        prev.current = n
        setCount(n)
      } catch {
        /* 本地读取失败时静默, 不显示 badge */
      }
    }
    load()
    const watch = watchFileSet(COUNT_ROOTS, WATCH_CONTEXT, () => void load())
    return () => {
      alive = false
      clearTimeout(flashTimer)
      watch?.dispose()
    }
  }, [])

  return { count, flash }
}

/** 回收站删除标记数量。删除/恢复/清空均经回收站 provider watch 刷新。 */
export function useTrashCount(): { count: number | null; flash: boolean } {
  const [count, setCount] = React.useState<number | null>(null)
  const [flash, setFlash] = React.useState(false)
  const prev = React.useRef<number | null>(null)

  React.useEffect(() => {
    let alive = true
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const result = await readFile(trashRootRef, CONTENT_CONTEXT)
        const n =
          result.data != null &&
          typeof result.data === "object" &&
          "count" in result.data &&
          typeof result.data.count === "number"
            ? result.data.count
            : 0
        if (!alive) return
        if (prev.current !== null && n > prev.current) {
          setFlash(true)
          clearTimeout(flashTimer)
          flashTimer = setTimeout(() => {
            if (alive) setFlash(false)
          }, 650)
        }
        prev.current = n
        setCount(n)
      } catch {
        /* 本地读取失败时静默, 不显示 badge */
      }
    }
    load()
    const watch = watchFileSet([trashRootRef], WATCH_CONTEXT, () => void load())
    return () => {
      alive = false
      clearTimeout(flashTimer)
      watch?.dispose()
    }
  }, [])

  return { count, flash }
}
