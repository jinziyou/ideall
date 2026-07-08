#!/usr/bin/env node
/**
 * 安全 pull: 确保已配置移动标签 fetch refspec, 再 fast-forward pull。
 */
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { ensureMovingTagFetchRefspecs } from "./git-fetch-config.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: "inherit" })
}

ensureMovingTagFetchRefspecs(root)
run("git", ["pull", "--ff-only"])
