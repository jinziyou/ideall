"use client"

import * as React from "react"
import type { NodeKind, NodeOfKind } from "@protocol/node"
import { readFile, watchFile } from "@/filesystem/registry"
import { FileSystemError, type FileSystemAccessContext } from "@/filesystem/types"
import { resourceFileRef } from "@/filesystem/resource-file-system"

const UI_READ_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "content",
} as const satisfies FileSystemAccessContext

const UI_WATCH_CONTEXT = {
  actor: "ui",
  permissions: [],
  intent: "watch",
} as const satisfies FileSystemAccessContext

export async function readNodeFile<K extends NodeKind>(
  kind: K,
  id: string,
): Promise<NodeOfKind<K> | null> {
  const ref = resourceFileRef({ scheme: "node", kind, id })
  try {
    const result = await readFile(ref, UI_READ_CONTEXT, { encoding: "json" })
    const data = result.data
    if (
      data == null ||
      typeof data !== "object" ||
      !("kind" in data) ||
      data.kind !== kind ||
      !("id" in data) ||
      data.id !== id
    ) {
      throw new Error(`文件系统返回了不匹配的 Node: ${kind}/${id}`)
    }
    return data as NodeOfKind<K>
  } catch (error) {
    if (error instanceof FileSystemError && error.code === "not-found") return null
    throw error
  }
}

type NodeFileState<K extends NodeKind> = {
  node: NodeOfKind<K> | null
  loading: boolean
  missing: boolean
  error: unknown
}

/** Display 只经 FileSystem 读取 Node，并随 provider 的 watch 事件刷新。 */
export function useNodeFile<K extends NodeKind>(kind: K, id: string): NodeFileState<K> {
  const [state, setState] = React.useState<NodeFileState<K>>({
    node: null,
    loading: true,
    missing: false,
    error: null,
  })

  React.useEffect(() => {
    let alive = true
    const ref = resourceFileRef({ scheme: "node", kind, id })

    const load = async () => {
      try {
        const node = await readNodeFile(kind, id)
        if (alive) {
          setState({ node, loading: false, missing: node === null, error: null })
        }
      } catch (error) {
        if (alive) setState({ node: null, loading: false, missing: false, error })
      }
    }

    setState({ node: null, loading: true, missing: false, error: null })
    void load()

    let watch: ReturnType<typeof watchFile> = null
    try {
      watch = watchFile(ref, UI_WATCH_CONTEXT, () => void load())
    } catch {
      // 不支持 watch 的 provider 仍可完成首次读取。
    }

    return () => {
      alive = false
      watch?.dispose()
    }
  }, [id, kind])

  return state
}
