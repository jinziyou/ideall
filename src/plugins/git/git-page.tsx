"use client"

import * as React from "react"
import {
  Download,
  FolderPlus,
  GitBranch,
  GitCommit,
  GitPullRequest,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react"
import { isFileRef, type FileRef } from "@protocol/file-system"
import { invokeFileAction, readFile, statFile, watchFile } from "@/filesystem/registry"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/empty-state"
import { Input } from "@/ui/input"
import { Textarea } from "@/ui/textarea"
import { GIT_ACTIONS, GIT_ROOT_REF } from "./git-file-system"

type GitStatusFile = { status: string; path: string }
type GitSnapshotRef = { refname: string; objectname: string }
type GitSnapshot = {
  repoPath: string
  branch: string
  upstream?: string
  files: GitStatusFile[]
  log: string[]
  remotes: string[]
  refs: GitSnapshotRef[]
  diffStat: string
  statusRaw: string
}
type GitAction = "fetch" | "pull" | "push"
type GitResult = { command: string; stdout: string; stderr: string; code: number }
type RepoMount = { id: string; path: string; ref: FileRef }

const CONTENT_CONTEXT = { actor: "ui", permissions: [], intent: "content" } as const
const METADATA_CONTEXT = { actor: "ui", permissions: [], intent: "metadata" } as const
const ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const
const WATCH_CONTEXT = { actor: "ui", permissions: [], intent: "watch" } as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null
}

function repoMounts(data: unknown): RepoMount[] {
  if (!isRecord(data) || !Array.isArray(data.repos)) return []
  return data.repos.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.path !== "string" ||
      !isFileRef(item.ref)
    )
      return []
    return [{ id: item.id, path: item.path, ref: item.ref }]
  })
}

function gitSnapshot(data: unknown): GitSnapshot | null {
  if (!isRecord(data)) return null
  const files = Array.isArray(data.files)
    ? data.files.flatMap((file) =>
        isRecord(file) && typeof file.status === "string" && typeof file.path === "string"
          ? [{ status: file.status, path: file.path }]
          : [],
      )
    : null
  const log = stringArray(data.log)
  const remotes = stringArray(data.remotes)
  const refs = Array.isArray(data.refs)
    ? data.refs.flatMap((ref) =>
        isRecord(ref) && typeof ref.refname === "string" && typeof ref.objectname === "string"
          ? [{ refname: ref.refname, objectname: ref.objectname }]
          : [],
      )
    : null
  if (
    typeof data.repoPath !== "string" ||
    typeof data.branch !== "string" ||
    (data.upstream !== undefined && typeof data.upstream !== "string") ||
    typeof data.diffStat !== "string" ||
    typeof data.statusRaw !== "string" ||
    !files ||
    !log ||
    !remotes ||
    !refs
  ) {
    return null
  }
  return {
    repoPath: data.repoPath,
    branch: data.branch,
    ...(typeof data.upstream === "string" ? { upstream: data.upstream } : {}),
    files,
    log,
    remotes,
    refs,
    diffStat: data.diffStat,
    statusRaw: data.statusRaw,
  }
}

function gitResult(data: unknown): GitResult | null {
  if (
    !isRecord(data) ||
    typeof data.command !== "string" ||
    typeof data.stdout !== "string" ||
    typeof data.stderr !== "string" ||
    typeof data.code !== "number"
  ) {
    return null
  }
  return { command: data.command, stdout: data.stdout, stderr: data.stderr, code: data.code }
}

export default function GitPage({
  initialRepoPath,
  embedded = false,
}: { initialRepoPath?: string; embedded?: boolean } = {}) {
  const [repos, setRepos] = React.useState<RepoMount[]>([])
  const [repoPath, setRepoPath] = React.useState(initialRepoPath ?? "")
  const [snapshot, setSnapshot] = React.useState<GitSnapshot | null>(null)
  const [snapshotVersion, setSnapshotVersion] = React.useState<string | null | undefined>(undefined)
  const [lastResult, setLastResult] = React.useState<GitResult | null>(null)
  const [branchName, setBranchName] = React.useState("")
  const [commitMessage, setCommitMessage] = React.useState("")
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const reloadRepos = React.useCallback(async () => {
    const result = await readFile(GIT_ROOT_REF, CONTENT_CONTEXT)
    const next = repoMounts(result.data)
    setRepos(next)
    setRepoPath((current) => current || initialRepoPath || next[0]?.path || "")
    return next
  }, [initialRepoPath])

  React.useEffect(() => {
    let alive = true
    reloadRepos().catch((reason) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Git 仓库读取失败")
    })
    const handle = watchFile(GIT_ROOT_REF, WATCH_CONTEXT, () => {
      if (alive) void reloadRepos()
    })
    return () => {
      alive = false
      handle?.dispose()
    }
  }, [reloadRepos])

  const mountRepo = React.useCallback(async (): Promise<RepoMount | null> => {
    const result = await invokeFileAction(
      GIT_ROOT_REF,
      GIT_ACTIONS.mount,
      undefined,
      ACTION_CONTEXT,
    )
    if (isRecord(result) && result.cancelled === true) return null
    if (
      !isRecord(result) ||
      typeof result.id !== "string" ||
      typeof result.path !== "string" ||
      !isFileRef(result.ref)
    ) {
      throw new Error("Git 文件系统返回了无效挂载")
    }
    await reloadRepos()
    return { id: result.id, path: result.path, ref: result.ref }
  }, [reloadRepos])

  const saveRepo = async () => {
    if (busy) return
    setBusy("mount")
    setError(null)
    try {
      const repo = await mountRepo()
      if (repo) await readSnapshot(repo)
    } catch (e) {
      setError(e instanceof Error ? e.message : "挂载仓库失败")
    } finally {
      setBusy(null)
    }
  }

  const removeRepo = async (repo: RepoMount) => {
    if (busy) return
    setBusy("delete")
    setError(null)
    try {
      const expectedVersion =
        repo.path === repoPath && snapshot
          ? (snapshotVersion ?? null)
          : ((await statFile(repo.ref, METADATA_CONTEXT))?.version ?? null)
      await invokeFileAction(repo.ref, GIT_ACTIONS.delete, undefined, ACTION_CONTEXT, {
        expectedVersion,
      })
      const next = await reloadRepos()
      if (repoPath === repo.path) {
        setRepoPath(next[0]?.path ?? "")
        setSnapshot(null)
        setSnapshotVersion(undefined)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "移除仓库失败")
    } finally {
      setBusy(null)
    }
  }

  const readSnapshot = React.useCallback(async (repo: RepoMount) => {
    const result = await readFile(repo.ref, CONTENT_CONTEXT)
    const next = gitSnapshot(result.data)
    if (!next) throw new Error("Git 文件系统返回了无效状态")
    setSnapshot(next)
    setSnapshotVersion(result.version ?? null)
    setRepoPath(repo.path)
    return next
  }, [])

  const refresh = React.useCallback(
    async (path = repoPath) => {
      const target = path.trim()
      if (!target || busy) return
      setBusy("refresh")
      setError(null)
      try {
        const repo = repos.find((item) => item.path === target)
        if (!repo) throw new Error("仓库尚未挂载")
        await readSnapshot(repo)
        setLastResult(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Git 读取失败")
      } finally {
        setBusy(null)
      }
    },
    [busy, readSnapshot, repoPath, repos],
  )

  const runAction = async (action: GitAction) => {
    if (!repoPath.trim() || busy) return
    setBusy(action)
    setError(null)
    try {
      const repo = repos.find((item) => item.path === repoPath)
      if (!repo) throw new Error("仓库尚未挂载")
      const result = await invokeFileAction(repo.ref, action, undefined, ACTION_CONTEXT, {
        expectedVersion: snapshotVersion ?? null,
      })
      const parsed = gitResult(result)
      if (!parsed) throw new Error("Git 文件系统返回了无效命令结果")
      setLastResult(parsed)
      await readSnapshot(repo)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Git 命令失败")
    } finally {
      setBusy(null)
    }
  }

  const createBranch = async () => {
    if (!repoPath.trim() || busy) return
    setBusy("branch")
    setError(null)
    try {
      const repo = repos.find((item) => item.path === repoPath)
      if (!repo) throw new Error("仓库尚未挂载")
      const result = await invokeFileAction(
        repo.ref,
        GIT_ACTIONS.createBranch,
        { name: branchName },
        ACTION_CONTEXT,
        { expectedVersion: snapshotVersion ?? null },
      )
      const parsed = gitResult(result)
      if (!parsed) throw new Error("Git 文件系统返回了无效命令结果")
      setLastResult(parsed)
      setBranchName("")
      await readSnapshot(repo)
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建分支失败")
    } finally {
      setBusy(null)
    }
  }

  const commit = async () => {
    if (!repoPath.trim() || busy) return
    setBusy("commit")
    setError(null)
    try {
      const repo = repos.find((item) => item.path === repoPath)
      if (!repo) throw new Error("仓库尚未挂载")
      const result = await invokeFileAction(
        repo.ref,
        GIT_ACTIONS.commit,
        { message: commitMessage },
        ACTION_CONTEXT,
        { expectedVersion: snapshotVersion ?? null },
      )
      const parsed = gitResult(result)
      if (!parsed) throw new Error("Git 文件系统返回了无效命令结果")
      setLastResult(parsed)
      setCommitMessage("")
      await readSnapshot(repo)
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败")
    } finally {
      setBusy(null)
    }
  }

  if (!isTauri()) {
    return (
      <div className={cn("mx-auto flex h-full w-full max-w-4xl flex-col gap-6", embedded && "p-3")}>
        {!embedded && <PageHeader />}
        <EmptyState icon={GitBranch} title="Git 工作台仅在桌面 App 中可用" bordered />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "mx-auto flex h-full w-full flex-col gap-4",
        embedded ? "max-w-none p-3" : "max-w-6xl",
      )}
    >
      {!embedded && <PageHeader />}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-3 rounded-lg border border-border/60 bg-card p-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={!!busy}
            onClick={() => void saveRepo()}
          >
            <FolderPlus className="h-4 w-4" />
            选择仓库
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={!repoPath.trim() || !!busy}
            onClick={() => void refresh()}
          >
            <RefreshCw className={cn("h-4 w-4", busy === "refresh" && "animate-spin")} />
            刷新状态
          </Button>

          <div className="min-h-0 flex-1 overflow-auto">
            {repos.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
                暂无已授权仓库
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {repos.map((repo) => (
                  <div
                    key={repo.ref.fileId}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                      repo.path === repoPath ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => void refresh(repo.path)}
                    >
                      <GitBranch className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{repo.path}</span>
                    </button>
                    <button
                      type="button"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => void removeRepo(repo)}
                      aria-label="移除仓库"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-auto rounded-lg border border-border/60 bg-card p-4">
          {!snapshot ? (
            <div className="flex h-full min-h-[360px] items-center justify-center">
              <EmptyState icon={GitPullRequest} title="选择仓库并刷新状态" />
            </div>
          ) : (
            <div className="flex min-h-full flex-col gap-4">
              <section className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-primary" />
                    <h2 className="truncate text-base font-semibold">{snapshot.branch}</h2>
                  </div>
                  {snapshot.upstream && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {snapshot.upstream}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ActionButton
                    icon={Download}
                    label="Fetch"
                    busy={busy === "fetch"}
                    disabled={!!busy}
                    onClick={() => void runAction("fetch")}
                  />
                  <ActionButton
                    icon={GitPullRequest}
                    label="Pull"
                    busy={busy === "pull"}
                    disabled={!!busy}
                    onClick={() => void runAction("pull")}
                  />
                  <ActionButton
                    icon={Send}
                    label="Push"
                    busy={busy === "push"}
                    disabled={!!busy}
                    onClick={() => void runAction("push")}
                  />
                </div>
              </section>

              {error && (
                <pre className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </pre>
              )}

              <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                <div className="rounded-md border border-border/60">
                  <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                    <h3 className="text-sm font-medium">工作区</h3>
                    <span className="text-xs text-muted-foreground">
                      {snapshot.files.length} 个变更
                    </span>
                  </div>
                  <div className="max-h-[360px] overflow-auto p-2">
                    {snapshot.files.length === 0 ? (
                      <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                        工作区干净
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {snapshot.files.map((file) => (
                          <ChangedFile key={`${file.status}:${file.path}`} file={file} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="rounded-md border border-border/60 p-3">
                    <h3 className="mb-2 text-sm font-medium">新建分支</h3>
                    <div className="flex gap-2">
                      <Input
                        value={branchName}
                        onChange={(e) => setBranchName(e.target.value)}
                        placeholder="feature/name"
                        className="h-9"
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1.5"
                        disabled={!branchName.trim() || !!busy}
                        onClick={() => void createBranch()}
                      >
                        <GitBranch className="h-4 w-4" />
                        创建
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-md border border-border/60 p-3">
                    <h3 className="mb-2 text-sm font-medium">提交</h3>
                    <Textarea
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="commit message"
                      className="min-h-20 resize-none"
                    />
                    <div className="mt-2 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1.5"
                        disabled={!commitMessage.trim() || !!busy}
                        onClick={() => void commit()}
                      >
                        <GitCommit className="h-4 w-4" />
                        提交
                      </Button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <OutputBlock title="最近提交" lines={snapshot.log} />
                <OutputBlock title="远端" lines={snapshot.remotes} />
              </section>

              {snapshot.diffStat.trim() && (
                <OutputBlock title="Diff 统计" lines={snapshot.diffStat.split(/\r?\n/)} />
              )}

              {lastResult && (
                <OutputBlock
                  title={`最近命令 · exit ${lastResult.code}`}
                  lines={[lastResult.command, lastResult.stdout, lastResult.stderr].filter(Boolean)}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className={cn("h-4 w-4", busy && "animate-spin")} />
      {label}
    </Button>
  )
}

function ChangedFile({ file }: { file: GitStatusFile }) {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60">
      <span
        className={cn("w-8 shrink-0 font-mono text-xs font-semibold", statusClass(file.status))}
      >
        {file.status}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
    </div>
  )
}

function OutputBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-md border border-border/60">
      <div className="border-b border-border/60 px-3 py-2 text-sm font-medium">{title}</div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-muted-foreground">
        {lines.length ? lines.join("\n") : "无输出"}
      </pre>
    </div>
  )
}

function statusClass(status: string): string {
  if (status.includes("A")) return "text-emerald-600"
  if (status.includes("D")) return "text-destructive"
  if (status.includes("?")) return "text-sky-600"
  if (status.includes("R")) return "text-violet-600"
  return "text-amber-600"
}

function PageHeader() {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Git</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            本地仓库状态、同步、分支与提交
          </p>
        </div>
      </div>
    </div>
  )
}
