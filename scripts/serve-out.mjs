// 静态导出预览服 (out/): 以生产形态 (无 Node 运行时) 本地预览 / CI 冒烟。
// 路由解析与 Next output:export 产物布局一致 (亦与 Tauri asset 协议的宽松匹配同构):
//   /x → out/x (精确文件) → out/x.html → out/x/index.html → 404.html
// 用法: pnpm build && pnpm serve:out   (默认端口 5030, 环境变量 PORT 覆盖)
import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = path.join(path.dirname(SCRIPT_PATH), "..", "out")
const PORT = Number(process.env.PORT || 5030)
const HELP = `用法:
  pnpm serve:out
  PORT=5031 node scripts/serve-out.mjs

说明:
  从 out/ 启动静态导出预览服，路由解析顺序为:
  /x -> out/x -> out/x.html -> out/x/index.html -> 404.html
`

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
}

/** URL 路径 → 磁盘文件 (查不到返回 null)。含路径穿越防护。 */
export function resolveFile(urlPath, root = ROOT) {
  let clean
  try {
    clean = decodeURIComponent(urlPath.split("?")[0]).replace(/\/+$/, "") || "/"
  } catch {
    return null
  }
  const rel = clean === "/" ? "index.html" : clean.slice(1)
  const normalizedRoot = path.resolve(root)
  const abs = path.resolve(normalizedRoot, rel)
  if (!abs.startsWith(normalizedRoot + path.sep) && abs !== normalizedRoot) return null
  for (const candidate of [abs, `${abs}.html`, path.join(abs, "index.html")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP.trimEnd())
    return
  }

  if (!existsSync(path.join(ROOT, "index.html"))) {
    console.error("out/ 不存在或为空 —— 先 pnpm build 生成静态导出")
    process.exitCode = 1
    return
  }

  createServer((req, res) => {
    const hit = resolveFile(req.url || "/")
    const file = hit ?? path.join(ROOT, "404.html")
    res.writeHead(hit ? 200 : 404, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    })
    createReadStream(file).pipe(res)
  }).listen(PORT, () => {
    console.log(`▶ 静态导出预览: http://localhost:${PORT}  (根 = out/, Ctrl+C 退出)`)
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) main()
