#!/usr/bin/env node
/** 一次性配置本仓库 fetch refspec, 永久避免 app-edge 等移动标签冲突。 */
import { fileURLToPath } from "node:url"
import path from "node:path"
import { ensureMovingTagFetchRefspecs } from "./git-fetch-config.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const added = ensureMovingTagFetchRefspecs(root)
if (added > 0) {
  console.log(`[git:setup] 已添加 ${added} 条 remote.origin.fetch refspec (移动标签强制更新)。`)
} else {
  console.log("[git:setup] fetch refspec 已就绪, 无需变更。")
}
console.log("此后直接 git pull / Cursor 同步即可, 不应再出现 app-edge 标签冲突弹窗。")
