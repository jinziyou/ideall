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

export type GitShellPlatform = "posix" | "windows"

export function gitShellPlatform(
  userAgent = typeof window !== "undefined" ? window.navigator.userAgent : "",
): GitShellPlatform {
  return userAgent.includes("Win") ? "windows" : "posix"
}

export function quoteGitArg(
  value: string,
  platform: GitShellPlatform = gitShellPlatform(),
): string {
  if (platform === "windows") return `'${value.replace(/'/g, "''")}'`
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function buildGitCommand(
  repoPath: string,
  args: string[],
  platform: GitShellPlatform = gitShellPlatform(),
): string {
  return ["git", "-C", repoPath, ...args]
    .map((part, idx) => (idx === 0 ? part : quoteGitArg(part, platform)))
    .join(" ")
}

async function runGit(repoPath: string, args: string[]): Promise<GitResult> {
  const command = buildGitCommand(repoPath, args)
  const result = await executeCommand(command)
  return { command, ...result }
}

export function parseGitStatus(raw: string): Pick<GitSnapshot, "branch" | "upstream" | "files"> {
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

export function ensureGitRepoPath(repoPath: string): string {
  const next = repoPath.trim()
  if (!next) throw new Error("需要仓库路径")
  return next
}

export function validateGitBranchName(name: string): string {
  const next = name.trim()
  if (!next) throw new Error("需要分支名")
  if (next.startsWith("-") || !/^[A-Za-z0-9._/-]+$/.test(next)) {
    throw new Error("分支名只能包含字母、数字、点、下划线、斜杠和短横线")
  }
  return next
}

export async function loadGitSnapshot(repoPath: string): Promise<GitSnapshot> {
  const path = ensureGitRepoPath(repoPath)
  const status = await runGit(path, ["status", "--short", "--branch"])
  if (status.code !== 0) {
    throw new Error(status.stderr || status.stdout || "git status failed")
  }
  const [log, remotes, diff] = await Promise.all([
    runGit(path, ["log", "--oneline", "--decorate", "-n", "12"]),
    runGit(path, ["remote", "-v"]),
    runGit(path, ["diff", "--stat"]),
  ])
  const parsed = parseGitStatus(status.stdout)
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
  const path = ensureGitRepoPath(repoPath)
  if (action === "fetch") return runGit(path, ["fetch", "--all", "--prune"])
  if (action === "pull") return runGit(path, ["pull", "--ff-only"])
  return runGit(path, ["push"])
}

export async function createGitBranch(repoPath: string, branchName: string): Promise<GitResult> {
  return runGit(ensureGitRepoPath(repoPath), ["checkout", "-b", validateGitBranchName(branchName)])
}

export async function commitGit(repoPath: string, message: string): Promise<GitResult> {
  const msg = message.trim()
  if (!msg) throw new Error("需要提交信息")
  return runGit(ensureGitRepoPath(repoPath), ["commit", "-m", msg])
}
