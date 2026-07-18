"use client"

import * as React from "react"
import { Clock, EyeOff, Pause, Play, Trash2, X } from "lucide-react"
import { Panel } from "@/ui/panel"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/empty-state"
import { FileTypeIcon } from "@/shared/file-type-icon"
import { formatTime } from "@/lib/format"
import { openTarget } from "@/workspace/store"
import {
  clearRecentlyUsed,
  isRecentlyUsedEnabled,
  isRecentlyUsedPaused,
  listRecentlyUsed,
  removeRecentlyUsedEntry,
  setRecentlyUsedEnabled,
  setRecentlyUsedEntryPrivate,
  setRecentlyUsedPaused,
  subscribeRecentlyUsed,
  type RecentlyUsedEntry,
} from "@/workspace/recently-used"
import { parseFileRefKey } from "@protocol/file-system"

/**
 * 「最近打开」面板（docs/freedesktop-alignment.md §6 S5a）：
 * recently-used 访问记录的可视面。默认关闭且发现式启用；私密项（XBEL private）
 * 保留在文件里但不在列表展示。
 */

type Snapshot = Readonly<{
  enabled: boolean
  paused: boolean
  entries: readonly RecentlyUsedEntry[]
}>

function readSnapshot(): Snapshot {
  return {
    enabled: isRecentlyUsedEnabled(),
    paused: isRecentlyUsedPaused(),
    entries: listRecentlyUsed(),
  }
}

function useRecentlyUsed(): Snapshot & { refresh(): void } {
  const [snapshot, setSnapshot] = React.useState<Snapshot>(readSnapshot)
  React.useEffect(() => subscribeRecentlyUsed(() => setSnapshot(readSnapshot())), [])
  return { ...snapshot, refresh: () => setSnapshot(readSnapshot()) }
}

export function RecentlyOpenedPanel() {
  const { enabled, paused, entries, refresh } = useRecentlyUsed()
  const visibleEntries = enabled ? entries.filter((entry) => entry.private !== true) : []

  const headerActions = enabled ? (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => {
          setRecentlyUsedPaused(!paused)
          refresh()
        }}
      >
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {paused ? "继续记录" : "暂停记录"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs"
        disabled={entries.length === 0}
        onClick={() => {
          clearRecentlyUsed()
          refresh()
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
        清空
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        onClick={() => {
          setRecentlyUsedEnabled(false)
          refresh()
        }}
      >
        停用
      </Button>
    </>
  ) : null

  return (
    <Panel title="最近打开" action={headerActions}>
      {!enabled ? (
        <EmptyState
          icon={Clock}
          title="最近打开默认关闭"
          description="启用后，本机打开过的文件会按时间记录在这里；随时可暂停、清空或停用，记录只留在本机，不参与同步。"
          bordered={false}
          className="py-6"
          action={
            <Button
              size="sm"
              onClick={() => {
                setRecentlyUsedEnabled(true)
                refresh()
              }}
            >
              启用最近打开
            </Button>
          }
        />
      ) : visibleEntries.length === 0 ? (
        <EmptyState
          icon={Clock}
          title={paused ? "记录已暂停" : "还没有打开记录"}
          description={
            paused
              ? "暂停期间不会记录新的打开；继续记录后，本机打开过的文件会出现在这里。"
              : "在本机打开任意文件后，会按时间记录在这里；私密项与移除的条目不会展示。"
          }
          bordered={false}
          className="py-6"
        />
      ) : (
        <ol className="flex flex-col">
          {visibleEntries.map((entry) => (
            <li
              key={entry.refKey}
              className="group flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-accent/60"
            >
              <FileTypeIcon name={entry.name} type={entry.mediaType} className="h-4 w-4" />
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:underline"
                onClick={() => {
                  const ref = parseFileRefKey(entry.refKey)
                  if (ref) {
                    void openTarget({
                      type: "file",
                      ref,
                      engineId: entry.engineId,
                      transient: true,
                    })
                  }
                }}
              >
                <span className="truncate font-medium">{entry.name}</span>
              </button>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title="标记为私密（保留记录但不在列表展示）"
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  onClick={() => {
                    setRecentlyUsedEntryPrivate(entry.refKey, true)
                    refresh()
                  }}
                >
                  <EyeOff className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="移除该条目"
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  onClick={() => {
                    removeRecentlyUsedEntry(entry.refKey)
                    refresh()
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                  {formatTime(entry.openedAt)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
