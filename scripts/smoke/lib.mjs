import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

export const BASE = process.env.BASE || "http://localhost:5020"
export const SMOKE_LEVEL =
  (process.env.SMOKE_LEVEL || "full").toLowerCase() === "core" ? "core" : "full"

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function createSilentWavBuffer() {
  const sampleRate = 8000
  const sampleCount = 800
  const bytesPerSample = 2
  const dataSize = sampleCount * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28)
  buffer.writeUInt16LE(bytesPerSample, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

export async function readLiveFileByName(page, name) {
  return page.evaluate(async (targetName) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("wonita-home")
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction("nodes", "readonly")
        const req = tx.objectStore("nodes").getAll()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
      return (
        all
          .filter((n) => n?.kind === "file" && n.title === targetName && n.deletedAt == null)
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0] ?? null
      )
    } finally {
      db.close()
    }
  }, name)
}

export async function readLiveFileById(page, id) {
  return page.evaluate(async (targetId) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("wonita-home")
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("nodes", "readonly")
        const req = tx.objectStore("nodes").get(targetId)
        req.onsuccess = () => {
          const n = req.result
          resolve(n?.kind === "file" && n.deletedAt == null ? n : null)
        }
        req.onerror = () => reject(req.error)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  }, id)
}

export async function waitForLiveFileByName(page, name, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const file = await readLiveFileByName(page, name)
    if (file) return file
    await sleep(250)
  }
  throw new Error(`file not found in IndexedDB: ${name}`)
}

export async function waitForLiveFileById(page, id, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const file = await readLiveFileById(page, id)
    if (file) return file
    await sleep(250)
  }
  throw new Error(`file not restored in IndexedDB: ${id}`)
}

export async function waitForNoLiveFileByName(page, name, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const file = await readLiveFileByName(page, name)
    if (!file) return true
    await sleep(250)
  }
  return false
}

export async function cleanupTestFiles(page, id, names) {
  await page.evaluate(
    async ({ targetId, targetNames }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("wonita-home")
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(["nodes", "blobs"], "readwrite")
          const nodes = tx.objectStore("nodes")
          const blobs = tx.objectStore("blobs")
          const allReq = nodes.getAll()
          allReq.onsuccess = () => {
            const now = Date.now()
            for (const n of allReq.result) {
              const byId = targetId && n?.id === targetId
              const byName = targetNames.includes(n?.title)
              if (n?.kind !== "file" || n.deletedAt != null || (!byId && !byName)) continue
              nodes.put({ ...n, deletedAt: now, updatedAt: now })
              if (n.blobRef?.key) blobs.delete(n.blobRef.key)
            }
          }
          allReq.onerror = () => reject(allReq.error)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    },
    { targetId: id, targetNames: names },
  )
}

export function significantSmokeErrors(
  pageErrors,
  { ignoreFetchAfterConnectionClosed = false, ignoreConsoleFetchFailures = false } = {},
) {
  const connectionClosed = pageErrors.some((error) => error.includes("net::ERR_CONNECTION_CLOSED"))
  return pageErrors.filter(
    (error) =>
      !error.includes("net::ERR_CONNECTION_CLOSED") &&
      !(ignoreConsoleFetchFailures && error.includes("console: TypeError: Failed to fetch")) &&
      !(
        ignoreFetchAfterConnectionClosed &&
        connectionClosed &&
        error.includes("TypeError: Failed to fetch")
      ),
  )
}

export function recordNoPageErrors(pageErrors, record, options) {
  const significantErrors = significantSmokeErrors(pageErrors, options)
  pageErrors.splice(0, pageErrors.length, ...significantErrors)
  record(
    "运行期间无 page/console 错误",
    significantErrors.length === 0,
    significantErrors.slice(0, 4).join(" | "),
  )
}

export async function createSmokeRun({ shotDir, viewport = { width: 1280, height: 900 } }) {
  const checks = []
  const pageErrors = []
  let stage = "init"

  const record = (name, ok, extra = "") => {
    checks.push({ name, ok, extra })
    console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`)
  }

  const markStage = (name) => {
    stage = name
  }

  await mkdir(shotDir, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport })

  page.on("pageerror", (error) => {
    pageErrors.push(`[${stage}] ${error.stack || error.message}`)
  })
  page.on("console", (message) => {
    if (message.type() !== "error") return
    const fallback = `[${stage}] console: ${message.text().split("\n")[0]}`
    pageErrors.push(fallback)
    void Promise.all(
      message.args().map((argument) =>
        argument
          .evaluate((value) => {
            if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`
            if (typeof value === "string") return value
            try {
              return JSON.stringify(value)
            } catch {
              return String(value)
            }
          })
          .catch(() => ""),
      ),
    ).then((details) => {
      const detail = details.filter(Boolean).join(" ").trim()
      const index = pageErrors.indexOf(fallback)
      if (index >= 0 && detail) pageErrors[index] = `[${stage}] console: ${detail}`
    })
  })

  return {
    browser,
    page,
    checks,
    pageErrors,
    record,
    markStage,
    async close() {
      await browser.close()
    },
    finish(screenshotPattern) {
      const passed = checks.filter((c) => c.ok).length
      console.log(`\n=== 结果: ${passed}/${checks.length} 通过 ===`)
      console.log(`截图: ${shotDir}/${screenshotPattern}`)
      if (pageErrors.length) {
        console.log(
          "page errors:\n" +
            pageErrors
              .slice(0, 8)
              .map((e) => "  - " + e)
              .join("\n"),
        )
      }
      process.exit(checks.every((c) => c.ok) ? 0 : 1)
    },
  }
}
