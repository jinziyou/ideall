#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { gzipSync } from "node:zlib"

export const DEFAULT_BUNDLE_BUDGET = Object.freeze({
  totalBytes: 5_600_000,
  largestChunkBytes: 1_150_000,
  totalGzipBytes: 1_750_000,
  largestChunkGzipBytes: 390_000,
})

async function listJavaScriptFiles(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new Error(`Bundle directory does not exist: ${directory}`)
    }
    throw error
  }

  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listJavaScriptFiles(entryPath)))
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath)
    }
  }
  return files
}

export async function measureBundle(directory) {
  const files = await listJavaScriptFiles(directory)
  if (files.length === 0) {
    throw new Error(`No JavaScript chunks found in: ${directory}`)
  }

  const chunks = await Promise.all(
    files.map(async (file) => {
      const source = await readFile(file)
      return {
        file: path.relative(directory, file),
        bytes: source.byteLength,
        gzipBytes: gzipSync(source).byteLength,
      }
    }),
  )
  chunks.sort((left, right) => right.bytes - left.bytes || left.file.localeCompare(right.file))

  return {
    chunkCount: chunks.length,
    totalBytes: chunks.reduce((total, chunk) => total + chunk.bytes, 0),
    totalGzipBytes: chunks.reduce((total, chunk) => total + chunk.gzipBytes, 0),
    largestChunk: chunks[0],
    largestGzipChunk: [...chunks].sort(
      (left, right) => right.gzipBytes - left.gzipBytes || left.file.localeCompare(right.file),
    )[0],
  }
}

export function bundleBudgetViolations(stats, budget = DEFAULT_BUNDLE_BUDGET) {
  const checks = [
    ["total raw size", stats.totalBytes, budget.totalBytes],
    ["largest raw chunk", stats.largestChunk.bytes, budget.largestChunkBytes],
    ["total gzip size", stats.totalGzipBytes, budget.totalGzipBytes],
    ["largest gzip chunk", stats.largestGzipChunk.gzipBytes, budget.largestChunkGzipBytes],
  ]

  return checks
    .filter(([, actual, limit]) => actual > limit)
    .map(([label, actual, limit]) => `${label}: ${formatBytes(actual)} > ${formatBytes(limit)}`)
}

export function formatBytes(bytes) {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`
  return `${(bytes / 1_000_000).toFixed(2)} MB`
}

async function main() {
  const directory = path.resolve(process.argv[2] ?? "out/_next/static/chunks")
  const stats = await measureBundle(directory)
  const violations = bundleBudgetViolations(stats)

  console.log(
    [
      `Bundle budget: ${stats.chunkCount} chunks`,
      `raw ${formatBytes(stats.totalBytes)} total / ${formatBytes(stats.largestChunk.bytes)} largest (${stats.largestChunk.file})`,
      `gzip ${formatBytes(stats.totalGzipBytes)} total / ${formatBytes(stats.largestGzipChunk.gzipBytes)} largest (${stats.largestGzipChunk.file})`,
    ].join("\n"),
  )

  if (violations.length > 0) {
    throw new Error(`Bundle budget exceeded:\n- ${violations.join("\n- ")}`)
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
