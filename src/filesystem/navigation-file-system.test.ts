import assert from "node:assert/strict"
import { test } from "node:test"
import { sameFileRef, type FileRef } from "@protocol/file-system"
import {
  AGENT_AUDIT_FILE_REF,
  AGENT_SETTINGS_FILE_REF,
  AGENT_TASKS_FILE_REF,
  AGENT_WORKSPACES_FILE_REF,
  INSTALLED_APPS_ROOT_REF,
  SETTINGS_ROOT_REF,
} from "./builtin-app-roots"
import { corePlaceRef, panelFileRef, resourceFileRef } from "./resource-file-system"
import {
  NAVIGATION_FILE_SYSTEM_ID,
  NAVIGATION_SECTIONS,
  navigationDirectoryRef,
  navigationFileSystem,
  navigationRootRef,
} from "./navigation-file-system"
import { trashRootRef } from "./trash-file-system"
import { FileSystemError, type FileSystemAccessContext } from "./types"

const ctx: FileSystemAccessContext = { actor: "ui", permissions: [] }

const expectedTargets: Readonly<Record<string, FileRef>> = {
  audit: AGENT_AUDIT_FILE_REF,
  inbox: panelFileRef("inbox"),
  following: corePlaceRef("subscriptions"),
  bookmarks: corePlaceRef("bookmarks"),
  resources: corePlaceRef("files"),
  files: corePlaceRef("notes"),
  spaces: AGENT_WORKSPACES_FILE_REF,
  tasks: AGENT_TASKS_FILE_REF,
  deleted: trashRootRef,
  news: resourceFileRef({ scheme: "info", kind: "home", id: "default" }),
  community: resourceFileRef({ scheme: "community", kind: "home", id: "default" }),
  browser: resourceFileRef({ scheme: "browser", kind: "page", id: "default" }),
  search: resourceFileRef({ scheme: "tool", kind: "search", id: "default" }),
  "local-apps": INSTALLED_APPS_ROOT_REF,
  basic: SETTINGS_ROOT_REF,
  ai: AGENT_SETTINGS_FILE_REF,
}

test("navigation filesystem: exposes stable section directories and readonly metadata", async () => {
  assert.equal(navigationFileSystem.descriptor.fileSystemId, NAVIGATION_FILE_SYSTEM_ID)
  assert.deepEqual(navigationFileSystem.descriptor.root, navigationRootRef)
  assert.deepEqual(navigationFileSystem.descriptor.capabilities, ["read-directory"])
  assert.equal(navigationFileSystem.descriptor.source.readOnly, true)

  const root = await navigationFileSystem.stat(navigationRootRef, ctx)
  assert.equal(root?.kind, "directory")
  assert.equal(root?.properties?.canonicalPath, "/")
  assert.equal(root?.properties?.hidden, true)

  assert.deepEqual(
    NAVIGATION_SECTIONS.map((section) => navigationDirectoryRef(section.id).fileId),
    ["/home", "/activity", "/browse", "/apps", "/settings"],
  )
  for (const section of NAVIGATION_SECTIONS) {
    const file = await navigationFileSystem.stat(navigationDirectoryRef(section.id), ctx)
    assert.equal(file?.kind, "directory")
    assert.equal(file?.name, section.name)
    assert.equal(file?.source.readOnly, true)
    assert.equal(file?.properties?.canonicalPath, `/${section.id}`)
    assert.equal(file?.properties?.navigationSection, section.id)
  }
})

test("navigation filesystem: section directories project the existing UX targets as links", async () => {
  const seenEntryIds = new Set<string>()
  for (const section of NAVIGATION_SECTIONS) {
    const page = await navigationFileSystem.readDirectory(navigationDirectoryRef(section.id), ctx)
    assert.deepEqual(
      page.entries.map((entry) => entry.name),
      section.items.map((item) => item.name),
    )
    for (const entry of page.entries) {
      assert.equal(entry.kind, "link")
      assert.equal(entry.pathName, entry.entryId)
      assert.ok(sameFileRef(entry.parent, navigationDirectoryRef(section.id)))
      assert.ok(sameFileRef(entry.target, expectedTargets[entry.entryId]!))
      assert.equal(entry.properties?.navigationSection, section.id)
      assert.equal(entry.properties?.navigationItem, entry.entryId)
      assert.equal(typeof entry.properties?.preferredEngine, "string")
      assert.equal(typeof entry.properties?.targetKind, "string")
      assert.equal(typeof entry.properties?.iconHint, "string")
      assert.equal(seenEntryIds.has(entry.entryId), false)
      seenEntryIds.add(entry.entryId)
    }
  }

  const files = (
    await navigationFileSystem.readDirectory(navigationDirectoryRef("home"), ctx)
  ).entries.find((entry) => entry.entryId === "files")
  assert.equal(files?.properties?.preferredEngine, "ideall.directory")
  assert.equal(files?.properties?.targetKind, "directory")
  const home = await navigationFileSystem.readDirectory(navigationDirectoryRef("home"), ctx)
  assert.deepEqual(
    home.entries.map((entry) => [entry.entryId, entry.properties?.preferredEngine]),
    [
      ["inbox", "ideall.panel"],
      ["following", "ideall.subscriptions"],
      ["bookmarks", "ideall.bookmarks"],
      ["resources", "ideall.resources"],
      ["files", "ideall.directory"],
    ],
  )
  const deleted = (
    await navigationFileSystem.readDirectory(navigationDirectoryRef("activity"), ctx)
  ).entries.find((entry) => entry.entryId === "deleted")
  assert.equal(deleted?.properties?.preferredEngine, "ideall.trash")
  assert.equal(deleted?.properties?.targetKind, "directory")
  const activity = await navigationFileSystem.readDirectory(navigationDirectoryRef("activity"), ctx)
  assert.deepEqual(
    activity.entries.map((entry) => [
      entry.entryId,
      entry.properties?.preferredEngine,
      entry.properties?.targetKind,
    ]),
    [
      ["audit", "ideall.agent-write-audit", "file"],
      ["spaces", "ideall.agent-spaces", "file"],
      ["tasks", "ideall.agent-tasks", "file"],
      ["deleted", "ideall.trash", "directory"],
    ],
  )
  const localApps = (
    await navigationFileSystem.readDirectory(navigationDirectoryRef("apps"), ctx)
  ).entries.find((entry) => entry.entryId === "local-apps")
  assert.equal(localApps?.properties?.preferredEngine, "ideall.installed-apps")
  assert.equal(localApps?.properties?.targetKind, "directory")
  const browser = (
    await navigationFileSystem.readDirectory(navigationDirectoryRef("browse"), ctx)
  ).entries.find((entry) => entry.entryId === "browser")
  assert.equal(browser?.properties?.preferredEngine, "ideall.browser")
  const settings = await navigationFileSystem.readDirectory(navigationDirectoryRef("settings"), ctx)
  assert.deepEqual(
    settings.entries.map((entry) => [
      entry.entryId,
      entry.properties?.preferredEngine,
      entry.properties?.targetKind,
    ]),
    [
      ["basic", "ideall.settings", "directory"],
      ["ai", "ideall.agent-settings", "file"],
    ],
  )
})

test("navigation filesystem: root and section reads paginate with stable path components", async () => {
  const root = await navigationFileSystem.readDirectory(navigationRootRef, ctx, { limit: 2 })
  assert.deepEqual(
    root.entries.map((entry) => [entry.entryId, entry.pathName, entry.target.fileId, entry.kind]),
    [
      ["home", "home", "/home", "link"],
      ["activity", "activity", "/activity", "link"],
    ],
  )
  assert.equal(root.nextCursor, "2")

  const next = await navigationFileSystem.readDirectory(navigationRootRef, ctx, {
    cursor: root.nextCursor,
    limit: 2,
  })
  assert.deepEqual(
    next.entries.map((entry) => entry.pathName),
    ["browse", "apps"],
  )
})

test("navigation filesystem: mutations and content reads fail closed", async () => {
  const home = navigationDirectoryRef("home")
  const unsupported = (error: unknown) =>
    error instanceof FileSystemError && error.code === "unsupported" && error.ref === home

  await assert.rejects(() => navigationFileSystem.read(home, ctx), unsupported)
  await assert.rejects(() => navigationFileSystem.write(home, { data: null }, ctx), unsupported)
  assert.deepEqual(await navigationFileSystem.actions(home, ctx), [])
  await assert.rejects(() => navigationFileSystem.invoke(home, "delete", null, ctx), unsupported)

  const missing = { fileSystemId: NAVIGATION_FILE_SYSTEM_ID, fileId: "/missing" }
  assert.equal(await navigationFileSystem.stat(missing, ctx), null)
  await assert.rejects(
    () => navigationFileSystem.readDirectory(missing, ctx),
    (error) =>
      error instanceof FileSystemError && error.code === "not-found" && error.ref === missing,
  )
})
