import { executeCommand } from "@/plugins/shell/shell-commands"

export type GitStatusFile = {
  status: string
  path: string
}

export type GitSnapshot = {
  repoPath: string
  branch: string
  upstream?: string
  files: GitStatusFile[]
  log: string[]
  remotes: string[]
  diffStat: string
  statusRaw: string
}

export type GitAction = "fetch" | "pull" | "push"

export type GitResult = {
  command: string
  stdout: string
  stderr: string
  code: number
}

function isWindows(): boolean {
  return typeof window !== "undefined" && window.navigator.userAgent.includes("Win")
}

function shellQuote(value: string): string {
  if (isWindows()) return `'${value.replace(/'/g, "''")}'`
  return `'${value.replace(/'/g, "'\\''")}'`
}

async function runGit(repoPath: string, args: string[]): Promise<GitResult> {
  const command = ["git", "-C", repoPath, ...args]
    .map((part, idx) => (idx === 0 ? part : shellQuote(part)))
    .join(" ")
  const result = await executeCommand(command)
  return { command, ...result }
}

function parseStatus(raw: string): Pick<GitSnapshot, "branch" | "upstream" | "files"> {
  const lines = raw.split(/\r?\n/).filter(Boolean)
  const head = lines.find((line) => line.startsWith("## "))
  const branchLine = head?.replace(/^##\s+/, "") ?? "HEAD"
  const [branchPart, upstreamPart] = branchLine.split("...")
  const files = lines
    .filter((line) => !line.startsWith("## "))
    .map((line) => ({
      status: line.slice(0, 2).trim() || "?",
      path: line.slice(3).trim(),
    }))
  return {
    branch: branchPart || "HEAD",
    upstream: upstreamPart,
    files,
  }
}

function ensureRepoPath(repoPath: string): string {
  const next = repoPath.trim()
  if (!next) throw new Error("需要仓库路径")
  return next
}

function ensureBranchName(name: string): string {
  const next = name.trim()
  if (!next) throw new Error("需要分支名")
  if (next.startsWith("-") || !/^[A-Za-z0-9._/-]+$/.test(next)) {
    throw new Error("分支名只能包含字母、数字、点、下划线、斜杠和短横线")
  }
  return next
}

export async function loadGitSnapshot(repoPath: string): Promise<GitSnapshot> {
  const path = ensureRepoPath(repoPath)
  const status = await runGit(path, ["status", "--short", "--branch"])
  if (status.code !== 0) {
    throw new Error(status.stderr || status.stdout || "git status failed")
  }
  const [log, remotes, diff] = await Promise.all([
    runGit(path, ["log", "--oneline", "--decorate", "-n", "12"]),
    runGit(path, ["remote", "-v"]),
    runGit(path, ["diff", "--stat"]),
  ])
  const parsed = parseStatus(status.stdout)
  return {
    repoPath: path,
    ...parsed,
    log: (log.stdout || log.stderr).split(/\r?\n/).filter(Boolean),
    remotes: (remotes.stdout || remotes.stderr).split(/\r?\n/).filter(Boolean),
    diffStat: diff.stdout || diff.stderr,
    statusRaw: status.stdout,
  }
}

export async function runGitAction(repoPath: string, action: GitAction): Promise<GitResult> {
  const path = ensureRepoPath(repoPath)
  if (action === "fetch") return runGit(path, ["fetch", "--all", "--prune"])
  if (action === "pull") return runGit(path, ["pull", "--ff-only"])
  return runGit(path, ["push"])
}

export async function createGitBranch(repoPath: string, branchName: string): Promise<GitResult> {
  return runGit(ensureRepoPath(repoPath), ["checkout", "-b", ensureBranchName(branchName)])
}

export async function commitGit(repoPath: string, message: string): Promise<GitResult> {
  const msg = message.trim()
  if (!msg) throw new Error("需要提交信息")
  return runGit(ensureRepoPath(repoPath), ["commit", "-m", msg])
}
