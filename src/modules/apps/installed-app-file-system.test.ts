import assert from "node:assert/strict"
import { test } from "node:test"
import { FileSystemError } from "@/filesystem/types"
import type { InstalledApp } from "@/lib/installed-apps"
import {
  createInstalledAppsFileSystem,
  installedAppFileRef,
  installedAppFromFile,
} from "./installed-app-file-system"

function app(id: string, name = id): InstalledApp {
  return {
    id,
    name,
    comment: `${name} comment`,
    categories: ["工具"],
    iconPath: `/icons/${id}.png`,
  }
}

test("installed apps filesystem: every app is a stable third-party file with readable metadata", async () => {
  let apps = [app("alpha", "Alpha"), app("beta", "Beta")]
  const fs = createInstalledAppsFileSystem({
    async listInstalledApps() {
      return apps
    },
    async launchInstalledApp() {},
  })
  const directoryContext = { actor: "ui", permissions: [], intent: "directory" } as const
  const first = await fs.readDirectory(fs.descriptor.root, directoryContext)
  apps = [...apps].reverse()
  const second = await fs.readDirectory(fs.descriptor.root, directoryContext)

  const entryIds = (page: typeof first) =>
    Object.fromEntries(page.entries.map((entry) => [entry.target.fileId, entry.entryId]))
  assert.deepEqual(entryIds(second), entryIds(first))

  const ref = installedAppFileRef("alpha")
  const file = await fs.stat(ref, { actor: "ui", permissions: [], intent: "metadata" })
  assert.ok(file)
  assert.equal(file.source.kind, "third-party")
  assert.deepEqual(installedAppFromFile(file), app("alpha", "Alpha"))

  const json = await fs.read(
    ref,
    { actor: "engine", permissions: [], activeFile: ref, intent: "content" },
    { encoding: "json" },
  )
  assert.deepEqual(json.data, app("alpha", "Alpha"))
  assert.equal(json.mediaType, file.mediaType)

  const serialized = JSON.stringify(app("alpha", "Alpha"))
  const text = await fs.read(
    ref,
    { actor: "ui", permissions: [], intent: "content" },
    { encoding: "text", range: { start: 1, end: 9 } },
  )
  assert.equal(text.data, serialized.slice(1, 9))
  assert.equal(text.size, 8)
})

test("installed apps filesystem: directory pagination reuses one scan and refreshes from root", async () => {
  let scans = 0
  const fs = createInstalledAppsFileSystem({
    async listInstalledApps() {
      scans += 1
      return [app("a"), app("b"), app("c")]
    },
    async launchInstalledApp() {},
  })
  const ctx = { actor: "ui", permissions: [], intent: "directory" } as const
  const first = await fs.readDirectory(fs.descriptor.root, ctx, { limit: 2 })
  const second = await fs.readDirectory(fs.descriptor.root, ctx, {
    cursor: first.nextCursor,
    limit: 2,
  })

  assert.equal(first.entries.length, 2)
  assert.equal(second.entries.length, 1)
  assert.equal(scans, 1)
  await fs.readDirectory(fs.descriptor.root, ctx)
  assert.equal(scans, 2)
})

test("installed apps filesystem: open action launches through the provider permission boundary", async () => {
  const launched: string[] = []
  const fs = createInstalledAppsFileSystem({
    async listInstalledApps() {
      return [app("alpha", "Alpha")]
    },
    async launchInstalledApp(id) {
      launched.push(id)
    },
  })
  const ref = installedAppFileRef("alpha")
  const actions = await fs.actions(ref, { actor: "ui", permissions: [], intent: "action" })
  assert.deepEqual(actions, [{ id: "open", label: "启动", requires: ["apps:launch"] }])

  await assert.rejects(
    fs.invoke(ref, "open", undefined, {
      actor: "engine",
      permissions: [],
      activeFile: ref,
      intent: "action",
    }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  assert.deepEqual(launched, [])

  assert.deepEqual(
    await fs.invoke(ref, "open", undefined, {
      actor: "system",
      permissions: ["apps:launch"],
      intent: "action",
    }),
    { ref, appId: "alpha", launched: true },
  )
  assert.deepEqual(launched, ["alpha"])
})

test("installed apps filesystem: metadata requires read scope and mutation stays unsupported", async () => {
  const fs = createInstalledAppsFileSystem({
    async listInstalledApps() {
      return [app("alpha", "Alpha")]
    },
    async launchInstalledApp() {},
  })
  const ref = installedAppFileRef("alpha")

  await assert.rejects(
    fs.read(ref, { actor: "system", permissions: [], intent: "content" }),
    (error) => error instanceof FileSystemError && error.code === "permission-denied",
  )
  assert.deepEqual(
    (
      await fs.read(ref, {
        actor: "system",
        permissions: ["fs:read"],
        intent: "content",
      })
    ).data,
    app("alpha", "Alpha"),
  )
  await assert.rejects(
    fs.write(ref, { data: {} }, { actor: "ui", permissions: [], intent: "write" }),
    (error) => error instanceof FileSystemError && error.code === "unsupported",
  )
  assert.equal(
    await fs.stat(installedAppFileRef("missing"), {
      actor: "ui",
      permissions: [],
      intent: "metadata",
    }),
    null,
  )
})
