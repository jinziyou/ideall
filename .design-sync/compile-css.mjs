// design-sync CSS build step (cfg.buildCmd). This repo is a Next.js app, not a
// published library: component styling is Tailwind v4 utility classes resolved
// at build time, so there is no static stylesheet to scrape. We compile one
// deterministically with the installed @tailwindcss/postcss plugin, scanning
// ONLY the component sources + authored previews (source(none) disables
// Tailwind's ambient auto-detection), and write it to cfg.cssEntry.
//
// Run from the repo root before package-build.mjs / resync.mjs:
//   node .design-sync/compile-css.mjs
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"

const root = process.cwd()
const GLOBALS = resolve(root, "src/app/globals.css")
const OUT = resolve(root, ".design-sync/.cache/tailwind.css")
// Scan all of src (a broad utility superset so the shipped CSS covers any
// standard Tailwind class an authored preview's layout glue uses — fan-out
// subagents run preview-rebuild, which does NOT recompile CSS) + the authored
// previews (for any preview-only arbitrary values the orchestrator builds).
const SOURCES = [resolve(root, "src"), resolve(root, ".design-sync/previews")]

let css = readFileSync(GLOBALS, "utf8")
if (!css.includes('@import "tailwindcss"')) {
  console.error("compile-css: src/app/globals.css no longer imports tailwindcss — adapt this script.")
  process.exit(1)
}
// Replace the ambient tailwind import with a deterministic, scoped one.
const sources = SOURCES.map((s) => `@source "${s}";`).join("\n")
css = css.replace(/@import\s+"tailwindcss"\s*;/, `@import "tailwindcss" source(none);\n${sources}`)

const result = await postcss([tailwind()]).process(css, { from: GLOBALS, to: OUT })
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, result.css)
console.error(`compile-css: wrote ${OUT} (${result.css.length} bytes)`)
