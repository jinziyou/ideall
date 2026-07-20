import assert from "node:assert/strict"
import { test } from "node:test"
import { isValidElement, type ReactElement } from "react"
import type { FileRef } from "@protocol/file-system"
import {
  INSTALLED_APPS_FILE_SYSTEM_ID,
  INSTALLED_APPS_ROOT_MEDIA_TYPE,
  INSTALLED_APPS_ROOT_REF,
} from "@/filesystem/builtin-app-roots"
import { appsManifest } from "./manifest"

test("apps manifest v2 contributes the installed-apps filesystem and its paired Engine/Display", async () => {
  const factory = appsManifest.runtimeExtensionFactory
  assert.equal(factory.version, 2)
  assert.equal(factory.digest, "builtin/ideall.installed-apps/v2")

  const contribution = factory.create()
  assert.equal(contribution.id, "ideall.installed-apps")
  assert.equal(contribution.fileSystems?.length, 1)
  assert.equal(contribution.engines?.length, 1)

  const fileSystem = contribution.fileSystems?.[0]
  assert.ok(fileSystem)
  assert.equal(fileSystem.provider.descriptor.fileSystemId, INSTALLED_APPS_FILE_SYSTEM_ID)
  assert.deepEqual(fileSystem.provider.descriptor.root, INSTALLED_APPS_ROOT_REF)
  assert.equal(fileSystem.mount.entryId, "third-party.installed-apps")

  const root = await fileSystem.provider.stat(INSTALLED_APPS_ROOT_REF, {
    actor: "ui",
    permissions: [],
    intent: "metadata",
  })
  assert.ok(root)
  assert.equal(root.mediaType, INSTALLED_APPS_ROOT_MEDIA_TYPE)
  assert.equal(root.properties?.installedAppsRoot, true)

  const engine = contribution.engines?.[0]
  assert.ok(engine)
  assert.equal(engine.descriptor.engineId, "ideall.installed-apps")
  assert.deepEqual(engine.descriptor.match?.kinds, ["directory"])
  assert.deepEqual(engine.descriptor.match?.mediaTypes, [INSTALLED_APPS_ROOT_MEDIA_TYPE])
  assert.equal(typeof engine.renderer, "function")

  const display = engine.renderer({ file: root, descriptor: engine.descriptor })
  assert.ok(isValidElement(display))
  assert.deepEqual(
    (display as ReactElement<{ rootRef: FileRef }>).props.rootRef,
    INSTALLED_APPS_ROOT_REF,
  )
})

test("installed-apps Display guards the exact canonical root identity", async () => {
  const contribution = appsManifest.runtimeExtensionFactory.create()
  const fileSystem = contribution.fileSystems?.[0]
  const engine = contribution.engines?.[0]
  assert.ok(fileSystem)
  assert.ok(engine)

  const root = await fileSystem.provider.stat(INSTALLED_APPS_ROOT_REF, {
    actor: "ui",
    permissions: [],
    intent: "metadata",
  })
  assert.ok(root)

  const lookalike = {
    ...root,
    ref: { ...root.ref, fileId: "lookalike-root" },
  }
  const display = engine.renderer({ file: lookalike, descriptor: engine.descriptor })
  assert.ok(isValidElement(display))
  assert.equal((display as ReactElement).type, "div")
})
