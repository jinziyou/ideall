import { test } from "node:test"
import assert from "node:assert/strict"
import { fileUploadFeedback, saveUploadedFiles } from "./file-upload"

function file(name: string): File {
  return new File(["demo"], name, { type: "text/plain" })
}

test("saveUploadedFiles: 单个失败不阻断后续文件保存", async () => {
  const seen: string[] = []
  const summary = await saveUploadedFiles(
    [file("ok-1.txt"), file("quota.txt"), file("ok-2.txt")],
    async (f) => {
      seen.push(f.name)
      if (f.name === "quota.txt") throw new Error("QuotaExceededError")
    },
  )

  assert.deepEqual(seen, ["ok-1.txt", "quota.txt", "ok-2.txt"])
  assert.deepEqual(summary, { ok: 2, failed: 1, lastError: "QuotaExceededError" })
  assert.deepEqual(fileUploadFeedback(summary), {
    kind: "warning",
    message: "已添加 2 个，1 个失败（可能是本机存储已满）",
    description: "QuotaExceededError",
  })
})

test("saveUploadedFiles: 全部失败时返回错误回执并保留最后一个错误", async () => {
  const summary = await saveUploadedFiles([file("a.txt"), file("b.txt")], async (f) => {
    throw new Error(`${f.name} no space`)
  })

  assert.deepEqual(summary, { ok: 0, failed: 2, lastError: "b.txt no space" })
  assert.deepEqual(fileUploadFeedback(summary), {
    kind: "error",
    message: "保存文件失败",
    description: "b.txt no space",
  })
})

test("fileUploadFeedback: 成功与空选择分支稳定", () => {
  assert.deepEqual(fileUploadFeedback({ ok: 2, failed: 0, lastError: "" }), {
    kind: "success",
    message: "已添加 2 个文件",
  })
  assert.deepEqual(fileUploadFeedback({ ok: 0, failed: 0, lastError: "" }), { kind: "none" })
})
