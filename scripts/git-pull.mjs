#!/usr/bin/env node
/**
 * 安全 pull：CI 会移动 app-edge 等标签，普通 pull 常因「本地标签冲突」失败。
 * 先用 --force 同步远程标签，再 pull 当前分支。
 */
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: "inherit" })
}

// CI 发布标签；远程会覆盖同名旧标签。
const MOVING_TAGS = ["app-edge"]

for (const tag of MOVING_TAGS) {
  try {
    run("git", ["fetch", "origin", "tag", tag, "--force"])
  } catch {
    // 远程尚无该标签时忽略
  }
}

run("git", ["fetch", "origin", "--tags", "--force"])
run("git", ["pull", "--ff-only"])
