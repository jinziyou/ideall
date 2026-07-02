// 发版版本号一键同步: package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml
// (+ Cargo.lock 的 ideall 条目, 免得下次 cargo 构建产生噪音 diff)。
// 用法: pnpm bump <x.y.z> → 检查 diff、提交, 再打 tag: git tag app-v<x.y.z>
// (app-build 的 gate 会校验 tag 与三处版本一致, 不一致直接失败 —— 见 docs/app.md 发版流程)。
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const v = process.argv[2]
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v ?? "")) {
  console.error("用法: pnpm bump <x.y.z>   (如 pnpm bump 0.2.0)")
  process.exit(1)
}

/** 只替换首个匹配; 零命中即报错退出 (防文件结构变化后静默漏改某处)。 */
function patch(file, pattern) {
  const p = path.join(root, file)
  let done = false
  const next = readFileSync(p, "utf8").replace(pattern, (_, pre, post) => {
    done = true
    return `${pre}${v}${post}`
  })
  if (!done) {
    console.error(`✗ ${file}: 未找到版本字段, 请人工检查`)
    process.exit(1)
  }
  writeFileSync(p, next)
  console.log(`✓ ${file}`)
}

patch("package.json", /("version":\s*")[^"]+(")/)
patch("src-tauri/tauri.conf.json", /("version":\s*")[^"]+(")/)
patch("src-tauri/Cargo.toml", /(^version\s*=\s*")[^"]+(")/m)
patch("src-tauri/Cargo.lock", /(name = "ideall"\nversion = ")[^"]+(")/)
console.log(`\n版本已统一为 ${v} —— 检查 diff 后提交, 再打 tag: git tag app-v${v}`)
