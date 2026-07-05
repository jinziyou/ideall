import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildGitCommand,
  ensureGitRepoPath,
  gitShellPlatform,
  parseGitStatus,
  quoteGitArg,
  validateGitBranchName,
} from "./git-commands"

test("parseGitStatus: 解析分支、upstream 与短状态文件", () => {
  assert.deepEqual(
    parseGitStatus(
      "## dev...origin/dev [ahead 1]\n M src/a.ts\nA  docs/readme.md\n?? scratch.txt\n",
    ),
    {
      branch: "dev",
      upstream: "origin/dev [ahead 1]",
      files: [
        { status: "M", path: "src/a.ts" },
        { status: "A", path: "docs/readme.md" },
        { status: "??", path: "scratch.txt" },
      ],
    },
  )
  assert.deepEqual(parseGitStatus(" M loose.txt\n"), {
    branch: "HEAD",
    upstream: undefined,
    files: [{ status: "M", path: "loose.txt" }],
  })
})

test("validateGitBranchName: trim 合法名称并拒绝 shell/flag 风险输入", () => {
  assert.equal(validateGitBranchName(" feature/safe-1 "), "feature/safe-1")
  assert.throws(() => validateGitBranchName(""), /需要分支名/)
  assert.throws(() => validateGitBranchName("-bad"), /分支名只能/)
  assert.throws(() => validateGitBranchName("feat;rm -rf"), /分支名只能/)
  assert.throws(() => validateGitBranchName("feat space"), /分支名只能/)
})

test("buildGitCommand: 按平台安全引用路径与参数", () => {
  assert.equal(
    buildGitCommand("/tmp/my repo", ["commit", "-m", "fix user's file"], "posix"),
    "git '-C' '/tmp/my repo' 'commit' '-m' 'fix user'\\''s file'",
  )
  assert.equal(
    buildGitCommand("C:\\repo path", ["checkout", "-b", "feat/o'clock"], "windows"),
    "git '-C' 'C:\\repo path' 'checkout' '-b' 'feat/o''clock'",
  )
})

test("quoteGitArg / ensureGitRepoPath / gitShellPlatform: 基础边界", () => {
  assert.equal(quoteGitArg("a'b", "posix"), "'a'\\''b'")
  assert.equal(quoteGitArg("a'b", "windows"), "'a''b'")
  assert.equal(ensureGitRepoPath(" /repo "), "/repo")
  assert.throws(() => ensureGitRepoPath("  "), /需要仓库路径/)
  assert.equal(gitShellPlatform("Mozilla Windows NT"), "windows")
  assert.equal(gitShellPlatform("Mozilla X11 Linux"), "posix")
})
