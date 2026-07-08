import { test } from "node:test"
import assert from "node:assert/strict"
import type { StoredFile } from "@protocol/files"
import {
  createFileActionHandlers,
  fileMetaActionInput,
  fileReference,
  fileResourceRef,
  parseFileTags,
  type FileActionDeps,
} from "./use-file-actions"

type ToastMessage = { message: string; description?: string }

function storedFile(id = "f1", name = "demo.txt"): StoredFile {
  return {
    id,
    name,
    type: "text/plain",
    size: 4,
    blob: new Blob(["demo"], { type: "text/plain" }),
    createdAt: 1000,
    tags: ["old"],
  }
}

function makeDeps(initialFiles: StoredFile[] = []) {
  const files = new Map(initialFiles.map((file) => [file.id, file]))
  const patches: Array<{ id: string; patch: Partial<Pick<StoredFile, "name" | "tags">> }> = []
  const renamedTabs: Array<{ id: string; name: string }> = []
  const closedTabs: Array<{ id: string; label: string }> = []
  const deleted: string[] = []
  const restored: StoredFile[] = []
  const clearedDrafts: string[] = []
  const downloads: StoredFile[] = []
  const clipboard: string[] = []
  const successes: string[] = []
  const errors: ToastMessage[] = []
  const undoDeletes: Array<{ label: string; restore: () => void | Promise<void> }> = []
  let refreshes = 0

  const deps: FileActionDeps = {
    updateFileMeta: async (id, patch) => {
      patches.push({ id, patch })
    },
    getFile: async (id) => files.get(id),
    deleteFile: async (id) => {
      deleted.push(id)
    },
    restoreFile: async (file) => {
      restored.push(file)
    },
    renameFileTab: (id, name) => {
      renamedTabs.push({ id, name })
    },
    closeFileTab: (id, label) => {
      closedTabs.push({ id, label })
    },
    refreshTree: () => {
      refreshes++
    },
    clearFileDraft: (id) => {
      clearedDrafts.push(id)
    },
    downloadFile: (file) => {
      downloads.push(file)
    },
    writeClipboard: async (text) => {
      clipboard.push(text)
    },
    showSuccess: (message) => {
      successes.push(message)
    },
    showError: (message, description) => {
      errors.push({ message, description })
    },
    showUndoDelete: (label, restore) => {
      undoDeletes.push({ label, restore })
    },
  }

  return {
    deps,
    patches,
    renamedTabs,
    closedTabs,
    deleted,
    restored,
    clearedDrafts,
    downloads,
    clipboard,
    successes,
    errors,
    undoDeletes,
    get refreshes() {
      return refreshes
    },
  }
}

test("parseFileTags: 支持中英文逗号/换行并去重", () => {
  assert.deepEqual(parseFileTags(" alpha, beta，alpha\n gamma ,, "), ["alpha", "beta", "gamma"])
  assert.deepEqual(parseFileTags(""), [])
})

test("fileReference: 生成 fs 文件引用", () => {
  assert.equal(fileReference("abc"), "fs://file/abc")
})

test("file resource helpers: 生成 VFS ref 并映射文件元数据补丁", () => {
  assert.deepEqual(fileResourceRef("abc"), { scheme: "node", kind: "file", id: "abc" })
  assert.deepEqual(fileMetaActionInput({ name: "next.md", tags: ["doc"] }), {
    title: "next.md",
    tags: ["doc"],
  })
})

test("rename: trim 名称后更新元数据、标签标题、刷新树并回调", async () => {
  const seen: string[] = []
  const fakes = makeDeps()
  const actions = createFileActionHandlers(fakes.deps, { onRenamed: (name) => seen.push(name) })

  assert.equal(await actions.rename("f1", "  next.md  "), true)
  assert.deepEqual(fakes.patches, [{ id: "f1", patch: { name: "next.md" } }])
  assert.deepEqual(fakes.renamedTabs, [{ id: "f1", name: "next.md" }])
  assert.equal(fakes.refreshes, 1)
  assert.deepEqual(seen, ["next.md"])
  assert.deepEqual(fakes.successes, ["已重命名"])
})

test("rename: 空名称不写入", async () => {
  const fakes = makeDeps()
  const actions = createFileActionHandlers(fakes.deps)

  assert.equal(await actions.rename("f1", "   "), false)
  assert.deepEqual(fakes.patches, [])
  assert.deepEqual(fakes.successes, [])
  assert.deepEqual(fakes.errors, [])
})

test("updateTags: 解析去重标签并支持关闭树刷新", async () => {
  const seen: string[][] = []
  const fakes = makeDeps()
  const actions = createFileActionHandlers(fakes.deps, {
    refreshTree: false,
    onTagsChanged: (tags) => seen.push(tags),
  })

  assert.equal(await actions.updateTags("f1", "code, draft，code\nreview"), true)
  assert.deepEqual(fakes.patches, [{ id: "f1", patch: { tags: ["code", "draft", "review"] } }])
  assert.equal(fakes.refreshes, 0)
  assert.deepEqual(seen, [["code", "draft", "review"]])
  assert.deepEqual(fakes.successes, ["已更新标签"])
})

test("download: 可按 id 取文件并下载", async () => {
  const file = storedFile()
  const fakes = makeDeps([file])
  const actions = createFileActionHandlers(fakes.deps)

  assert.equal(await actions.download(file.id), true)
  assert.deepEqual(fakes.downloads, [file])
  assert.deepEqual(fakes.errors, [])
})

test("copyName / copyRef: 写入剪贴板并提示", async () => {
  const fakes = makeDeps()
  const actions = createFileActionHandlers(fakes.deps)

  assert.equal(await actions.copyName(""), true)
  assert.equal(await actions.copyRef("f1"), true)
  assert.deepEqual(fakes.clipboard, ["无标题", "fs://file/f1"])
  assert.deepEqual(fakes.successes, ["已复制文件名", "已复制文件引用"])
})

test("remove: 删除文件、清草稿、关闭标签并支持撤销恢复", async () => {
  const file = storedFile("f1", "disk.txt")
  const deletedFiles: StoredFile[] = []
  const fakes = makeDeps([file])
  const actions = createFileActionHandlers(fakes.deps, {
    onDeleted: (deleted) => deletedFiles.push(deleted),
  })

  assert.equal(await actions.remove({ id: file.id, name: "display.txt" }), true)
  assert.deepEqual(fakes.deleted, [file.id])
  assert.deepEqual(fakes.clearedDrafts, [file.id])
  assert.deepEqual(fakes.closedTabs, [{ id: file.id, label: "display.txt" }])
  assert.equal(fakes.refreshes, 1)
  assert.equal(fakes.undoDeletes.length, 1)
  assert.equal(fakes.undoDeletes[0].label, "display.txt")
  assert.deepEqual(deletedFiles, [file])

  await fakes.undoDeletes[0].restore()
  assert.deepEqual(fakes.restored, [file])
  assert.equal(fakes.refreshes, 2)
})

test("remove: 可用传入的文件快照恢复且不关闭标签", async () => {
  const displayed = { ...storedFile("f1", "disk.txt"), name: "display.txt", tags: ["ui"] }
  const fakes = makeDeps()
  const actions = createFileActionHandlers(fakes.deps)

  assert.equal(await actions.remove({ id: displayed.id, file: displayed, closeTab: false }), true)
  assert.deepEqual(fakes.closedTabs, [])
  assert.equal(fakes.undoDeletes[0].label, "display.txt")

  await fakes.undoDeletes[0].restore()
  assert.deepEqual(fakes.restored, [displayed])
})

test("remove: 文件不存在时不删除", async () => {
  const fakes = makeDeps()
  const actions = createFileActionHandlers(fakes.deps)

  assert.equal(await actions.remove({ id: "missing" }), false)
  assert.deepEqual(fakes.deleted, [])
  assert.deepEqual(fakes.clearedDrafts, [])
  assert.deepEqual(fakes.closedTabs, [])
  assert.deepEqual(fakes.errors, [{ message: "文件不存在或已删除", description: undefined }])
})
