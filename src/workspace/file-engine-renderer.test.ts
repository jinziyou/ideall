import assert from "node:assert/strict"
import { test } from "node:test"
import * as React from "react"
import type { EngineDescriptor } from "@protocol/engine"
import type { IdeallFile } from "@protocol/file-system"
import { BUILTIN_ENGINES } from "@/engines/builtin"
import { EngineRegistry } from "@/engines/registry"
import {
  INSTALLED_APPS_ROOT_MEDIA_TYPE,
  INSTALLED_APPS_ROOT_REF,
} from "@/filesystem/builtin-app-roots"
import { corePlaceRef } from "@/filesystem/resource-file-system"
import { TRASH_ROOT_MEDIA_TYPE, trashRootRef } from "@/filesystem/trash-file-system"
import {
  installedAppsEngineDescriptor,
  installedAppsEngineRenderer,
} from "@/modules/apps/installed-apps-engine"
import { FileEngineRendererRegistry, FileEngineRendererRegistryError } from "./file-engine-renderer"
import { registerBuiltInFileEngineRenderers } from "./registry"

const file: IdeallFile = {
  ref: { fileSystemId: "third-party.files", fileId: "fixture" },
  kind: "file",
  name: "fixture.demo",
  mediaType: "application/x-demo",
  capabilities: ["read", "write"],
  source: { kind: "third-party", id: "demo" },
  properties: {},
}

function descriptor(
  engineId: string,
  access: EngineDescriptor["access"] = "read-write",
): EngineDescriptor {
  return {
    engineId,
    label: engineId,
    match: { mediaTypes: [file.mediaType] },
    layout: "fill",
    access,
  }
}

test("file engine renderer registry: third-party engines contribute Display independently", () => {
  const engines = new EngineRegistry()
  const renderers = new FileEngineRendererRegistry()
  const thirdParty = descriptor("demo.timeline")
  engines.register(thirdParty)
  renderers.register(
    "demo.timeline",
    ({ file: target, descriptor: engine }) => `${engine.engineId}:${target.ref.fileId}`,
  )

  const resolved = engines.resolve(file)
  assert.equal(resolved?.descriptor.engineId, "demo.timeline")
  assert.equal(
    renderers.get(resolved!.descriptor.engineId)?.({
      file,
      descriptor: resolved!.descriptor,
    }),
    "demo.timeline:fixture",
  )
})

test("file engine renderer registry: registration notifies and disposer is exact and idempotent", () => {
  const registry = new FileEngineRendererRegistry()
  let changes = 0
  registry.subscribe(() => (changes += 1))
  const renderer = () => "display"
  const unregister = registry.register("demo.display", renderer)

  assert.equal(registry.get("demo.display"), renderer)
  assert.equal(registry.revision(), 1)
  unregister()
  unregister()
  assert.equal(registry.get("demo.display"), null)
  assert.equal(registry.revision(), 2)
  assert.equal(changes, 2)
})

test("file engine renderer registry: duplicate and malformed ids are rejected", () => {
  const registry = new FileEngineRendererRegistry()
  registry.register("demo.display", () => null)
  assert.throws(
    () => registry.register("demo.display", () => null),
    (error) =>
      error instanceof FileEngineRendererRegistryError && error.code === "duplicate-renderer",
  )
  assert.throws(
    () => registry.register(" demo.invalid", () => null),
    (error) =>
      error instanceof FileEngineRendererRegistryError && error.code === "invalid-renderer",
  )
})

test("file engine renderer registry: throwing observer cannot interrupt registration", () => {
  const registry = new FileEngineRendererRegistry()
  let healthyCalls = 0
  registry.subscribe(() => {
    throw new Error("observer boom")
  })
  registry.subscribe(() => {
    healthyCalls += 1
  })

  const dispose = registry.register("demo.safe", () => null)
  assert.ok(registry.get("demo.safe"))
  assert.equal(healthyCalls, 1)
  assert.doesNotThrow(dispose)
  assert.equal(healthyCalls, 2)
})

test("built-in Displays are idempotent and code rendering honors descriptor access", () => {
  const registry = new FileEngineRendererRegistry()
  registerBuiltInFileEngineRenderers(registry)
  registerBuiltInFileEngineRenderers(registry)

  assert.deepEqual(registry.list(), BUILTIN_ENGINES.map(({ engineId }) => engineId).sort())

  const codeDescriptor = BUILTIN_ENGINES.find(({ engineId }) => engineId === "ideall.code")!
  const codeRenderer = registry.get(codeDescriptor.engineId)!
  const readOnlyElement = codeRenderer({
    file: { ...file, mediaType: "text/plain" },
    descriptor: { ...codeDescriptor, access: "read-only" },
  })
  const readWriteElement = codeRenderer({
    file: { ...file, mediaType: "text/plain" },
    descriptor: codeDescriptor,
  })

  assert.ok(React.isValidElement(readOnlyElement))
  assert.ok(React.isValidElement(readWriteElement))
  assert.equal((readOnlyElement.props as { readOnly?: boolean }).readOnly, true)
  assert.equal((readWriteElement.props as { readOnly?: boolean }).readOnly, false)
})

test("ideall.preview renders SVG as an image preview instead of a code editor", () => {
  const registry = new FileEngineRendererRegistry()
  registerBuiltInFileEngineRenderers(registry)
  const previewDescriptor = BUILTIN_ENGINES.find(({ engineId }) => engineId === "ideall.preview")!
  const renderer = registry.get(previewDescriptor.engineId)!
  const svgElement = renderer({
    file: { ...file, name: "fixture.svg", mediaType: "image/svg+xml" },
    descriptor: previewDescriptor,
  })
  const binaryElement = renderer({
    file: { ...file, mediaType: "application/octet-stream" },
    descriptor: previewDescriptor,
  })
  const textElement = renderer({
    file: { ...file, mediaType: "text/plain" },
    descriptor: previewDescriptor,
  })

  assert.ok(React.isValidElement(svgElement))
  assert.ok(React.isValidElement(binaryElement))
  assert.ok(React.isValidElement(textElement))
  assert.equal(svgElement.type, binaryElement.type)
  assert.notEqual(svgElement.type, textElement.type)
  assert.equal((svgElement.props as { readOnly?: boolean }).readOnly, undefined)
  assert.equal((textElement.props as { readOnly?: boolean }).readOnly, true)
})

test("installed app files use the dedicated metadata and launch Display", () => {
  const registry = new FileEngineRendererRegistry()
  registerBuiltInFileEngineRenderers(registry)
  const appDescriptor = BUILTIN_ENGINES.find(({ engineId }) => engineId === "ideall.installed-app")!
  const appFile: IdeallFile = {
    ...file,
    ref: { fileSystemId: "third-party.installed-apps", fileId: "app:org.example.Editor" },
    name: "Editor",
    mediaType: "application/vnd.ideall.installed-app+json",
    capabilities: ["read", "actions", "apps:launch"],
    properties: {
      appId: "org.example.Editor",
      comment: "Example editor",
      categories: ["Development"],
      iconPath: null,
    },
  }
  const element = registry.get(appDescriptor.engineId)?.({
    file: appFile,
    descriptor: appDescriptor,
  })

  assert.ok(React.isValidElement(element))
  assert.equal((element.props as { file?: IdeallFile }).file, appFile)
})

function isUnsupportedSurface(node: React.ReactNode): boolean {
  if (!React.isValidElement(node)) return false
  const className = (node.props as { className?: unknown }).className
  return typeof className === "string" && className.includes("items-center")
}

test("directory Displays guard the exact semantic root, not only matching metadata", () => {
  const registry = new FileEngineRendererRegistry()
  registerBuiltInFileEngineRenderers(registry)
  const fixtures = [
    {
      engineId: "ideall.subscriptions",
      ref: corePlaceRef("subscriptions"),
      mediaType: "inode/directory",
      properties: { place: "subscriptions", rootChild: true },
    },
    {
      engineId: "ideall.bookmarks",
      ref: corePlaceRef("bookmarks"),
      mediaType: "inode/directory",
      properties: { place: "bookmarks", rootChild: true },
    },
    {
      engineId: "ideall.resources",
      ref: corePlaceRef("files"),
      mediaType: "inode/directory",
      properties: { place: "files", rootChild: true },
    },
    {
      engineId: "ideall.trash",
      ref: trashRootRef,
      mediaType: TRASH_ROOT_MEDIA_TYPE,
      properties: { trashRoot: true },
    },
  ] as const

  for (const fixture of fixtures) {
    const descriptor = BUILTIN_ENGINES.find(({ engineId }) => engineId === fixture.engineId)!
    const renderer = registry.get(fixture.engineId)!
    const exactRoot: IdeallFile = {
      ref: fixture.ref,
      kind: "directory",
      name: fixture.engineId,
      mediaType: fixture.mediaType,
      capabilities: ["read-directory"],
      source: { kind: "local", id: "fixture" },
      properties: fixture.properties,
    }
    const metadataLookalike: IdeallFile = {
      ...exactRoot,
      ref: { ...fixture.ref, fileId: `${fixture.ref.fileId}:lookalike` },
    }

    assert.equal(isUnsupportedSurface(renderer({ file: exactRoot, descriptor })), false)
    assert.equal(
      isUnsupportedSurface(renderer({ file: metadataLookalike, descriptor })),
      true,
      fixture.engineId,
    )
  }

  const installedRoot: IdeallFile = {
    ref: INSTALLED_APPS_ROOT_REF,
    kind: "directory",
    name: "本机应用",
    mediaType: INSTALLED_APPS_ROOT_MEDIA_TYPE,
    capabilities: ["read-directory"],
    source: { kind: "third-party", id: "installed-apps" },
    properties: { installedAppsRoot: true },
  }
  assert.equal(
    isUnsupportedSurface(
      installedAppsEngineRenderer({
        file: installedRoot,
        descriptor: installedAppsEngineDescriptor,
      }),
    ),
    false,
  )
  assert.equal(
    isUnsupportedSurface(
      installedAppsEngineRenderer({
        file: {
          ...installedRoot,
          ref: { ...INSTALLED_APPS_ROOT_REF, fileId: "root:lookalike" },
        },
        descriptor: installedAppsEngineDescriptor,
      }),
    ),
    true,
  )
})
