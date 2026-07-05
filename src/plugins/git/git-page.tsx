"use client"

import * as React from "react"
import {
  Download,
  GitBranch,
  GitCommit,
  GitPullRequest,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { Button } from "@/ui/button"
import { EmptyState } from "@/ui/empty-state"
import { Input } from "@/ui/input"
import { Textarea } from "@/ui/textarea"
import {
  commitGit,
  createGitBranch,
  loadGitSnapshot,
  runGitAction,
  type GitAction,
  type GitResult,
  type GitSnapshot,
  type GitStatusFile,
} from "./git-commands"
import { addGitRepo, loadGitRepos, removeGitRepo, saveGitRepos } from "./git-repos-store"

export default function GitPage() {
  const [repos, setRepos] = React.useState<string[]>([])
  const [repoPath, setRepoPath] = React.useState("")
  const [snapshot, setSnapshot] = React.useState<GitSnapshot | null>(null)
  const [lastResult, setLastResult] = React.useState<GitResult | null>(null)
  const [branchName, setBranchName] = React.useState("")
  const [commitMessage, setCommitMessage] = React.useState("")
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const saved = loadGitRepos()
    setRepos(saved)
    setRepoPath(saved[0] ?? "")
  }, [])

  const persistRepos = (next: string[]) => {
    setRepos(next)
    saveGitRepos(next)
  }

  const saveRepo = () => {
    persistRepos(addGitRepo(repos, repoPath))
  }

  const removeRepo = (path: string) => {
    const next = removeGitRepo(repos, path)
    persistRepos(next)
    if (repoPath === path) {
      setRepoPath(next[0] ?? "")
      setSnapshot(null)
    }
  }

  const refresh = React.useCallback(
    async (path = repoPath) => {
      const target = path.trim()
      if (!target || busy) return
      setBusy("refresh")
      setError(null)
      try {
        const next = await loadGitSnapshot(target)
        setSnapshot(next)
        setRepoPath(target)
        setLastResult(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Git 读取失败")
      } finally {
        setBusy(null)
      }
    },
    [busy, repoPath],
  )

  const runAction = async (action: GitAction) => {
    if (!repoPath.trim() || busy) return
    setBusy(action)
    setError(null)
    try {
      const result = await runGitAction(repoPath, action)
      setLastResult(result)
      await refresh(repoPath)
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
      const result = await createGitBranch(repoPath, branchName)
      setLastResult(result)
      setBranchName("")
      await refresh(repoPath)
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
      const result = await commitGit(repoPath, commitMessage)
      setLastResult(result)
      setCommitMessage("")
      await refresh(repoPath)
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败")
    } finally {
      setBusy(null)
    }
  }

  if (!isTauri()) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader />
        <EmptyState icon={GitBranch} title="Git 工作台仅在桌面 App 中可用" bordered />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4">
      <PageHeader />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-3 rounded-lg border border-border/60 bg-card p-3">
          <div className="flex items-center gap-2">
            <Input
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void refresh()
              }}
              placeholder="/path/to/repo"
              className="h-9"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              onClick={saveRepo}
              aria-label="保存仓库"
            >
              <Save className="h-4 w-4" />
            </Button>
          </div>
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
                暂无已保存仓库
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {repos.map((path) => (
                  <div
                    key={path}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                      path === repoPath ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => void refresh(path)}
                    >
                      <GitBranch className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{path}</span>
                    </button>
                    <button
                      type="button"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => removeRepo(path)}
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
