import assert from "node:assert/strict"
import { test } from "node:test"
import type { FileSystemProvider } from "@/filesystem/types"
import type {
  RuntimeExtensionConsentAuthority,
  RuntimeExtensionConsentReceipt,
  RuntimeExtensionContribution,
  RuntimeExtensionDescriptor,
  RuntimeExtensionFactory,
  RuntimeExtensionVerificationReceipt,
  RuntimeExtensionVerifier,
} from "./runtime-extensions"
import {
  RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY,
  RuntimeExtensionCatalog,
  RuntimeExtensionRegistry,
} from "./runtime-extensions"
import * as runtimeExtensionApi from "./runtime-extensions"

function extension(
  id = "example.connector",
  lifecycle: Partial<Pick<RuntimeExtensionContribution, "activate" | "dispose">> = {},
): RuntimeExtensionContribution {
  const provider = {
    descriptor: {
      fileSystemId: `${id}.fs`,
      name: id,
      root: { fileSystemId: `${id}.fs`, fileId: "root" },
      source: { kind: "third-party" as const, id },
    },
  } as FileSystemProvider
  return {
    id,
    label: id,
    fileSystems: [{ provider, mount: { entryId: `${id}.mount`, name: id } }],
    engines: [
      {
        descriptor: {
          engineId: `${id}.engine`,
          label: id,
          layout: "fill",
          access: "read-only",
        },
        renderer: () => null,
      },
    ],
    ...lifecycle,
  }
}

type FactoryOverrides = Partial<
  Pick<
    RuntimeExtensionFactory,
    "label" | "version" | "digest" | "permissionDigest" | "permissions" | "create"
  >
>

function builtinFactory(
  id = "example.connector",
  overrides: FactoryOverrides = {},
): RuntimeExtensionFactory {
  return {
    id,
    label: overrides.label ?? id,
    version: overrides.version ?? 1,
    source: { kind: "builtin", id: "ideall" },
    digest: overrides.digest ?? `${id}:content:v1`,
    permissionDigest: overrides.permissionDigest ?? `${id}:permissions:v1`,
    permissions: overrides.permissions ?? ["fs:read"],
    create: overrides.create ?? (() => extension(id)),
  }
}

function packageFactory(
  id = "package.connector",
  overrides: FactoryOverrides = {},
): RuntimeExtensionFactory {
  return {
    id,
    label: overrides.label ?? id,
    version: overrides.version ?? 1,
    source: { kind: "package", id: `package:${id}`, location: `/verified/${id}` },
    digest: overrides.digest ?? `${id}:content:v1`,
    permissionDigest: overrides.permissionDigest ?? `${id}:permissions:v1`,
    permissions: overrides.permissions ?? ["fs:read"],
    create: overrides.create ?? (() => extension(id)),
  }
}

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY, initial)
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    },
  }
}

function verificationFor(
  descriptor: RuntimeExtensionDescriptor,
): RuntimeExtensionVerificationReceipt {
  return {
    receiptId: `verification:${descriptor.id}:${descriptor.version}`,
    verifierId: "host-verifier",
    id: descriptor.id,
    version: descriptor.version,
    digest: descriptor.digest,
    permissionDigest: descriptor.permissionDigest,
    verifiedAt: 1,
  }
}

function consentFor(
  descriptor: RuntimeExtensionDescriptor,
  receiptId = `consent:${descriptor.id}:${descriptor.version}:${descriptor.permissionDigest}`,
): RuntimeExtensionConsentReceipt {
  return {
    receiptId,
    id: descriptor.id,
    version: descriptor.version,
    digest: descriptor.digest,
    permissionDigest: descriptor.permissionDigest,
    grantedAt: 2,
  }
}

function trustFakes(options: { restored?: Set<string>; revoked?: string[] } = {}): {
  verifier: RuntimeExtensionVerifier
  consent: RuntimeExtensionConsentAuthority
} {
  return {
    verifier: { verify: (descriptor) => verificationFor(descriptor) },
    consent: {
      request: (descriptor) => consentFor(descriptor),
      restore: (descriptor, _verification, receiptId) =>
        options.restored?.has(receiptId) ? consentFor(descriptor, receiptId) : null,
      revoke: (receipt) => void options.revoked?.push(receipt.receiptId),
    },
  }
}

function noOpRegistry(): RuntimeExtensionRegistry {
  return new RuntimeExtensionRegistry({
    mountFileSystem: () => () => undefined,
    registerEngine: () => () => undefined,
  })
}

test("runtime extension public barrel does not expose activation authority", () => {
  assert.equal("issueActivationPermit" in runtimeExtensionApi, false)
  assert.equal("consumeActivationPermit" in runtimeExtensionApi, false)
  assert.equal("installCatalogExtension" in runtimeExtensionApi, false)
})

test("registry: abort/dispose tears down external resources before unregistering contributions", async () => {
  const events: string[] = []
  let seenSignal: AbortSignal | undefined
  const registry = new RuntimeExtensionRegistry({
    mountFileSystem: ({ provider }) => {
      events.push(`mount:${provider.descriptor.fileSystemId}`)
      return () => events.push(`unmount:${provider.descriptor.fileSystemId}`)
    },
    registerEngine: ({ descriptor }) => {
      events.push(`engine:${descriptor.engineId}`)
      return () => events.push(`unengine:${descriptor.engineId}`)
    },
  })
  const catalog = new RuntimeExtensionCatalog(registry)
  catalog.discoverBuiltin(
    builtinFactory("ordered.connector", {
      create: () =>
        extension("ordered.connector", {
          activate(signal) {
            seenSignal = signal
            signal.addEventListener("abort", () => events.push("abort"), { once: true })
            events.push("activate")
          },
          async dispose({ signal, reason }) {
            assert.equal(signal, seenSignal)
            assert.equal(signal.aborted, true)
            assert.equal(reason, "uninstall")
            events.push("dispose")
          },
        }),
    }),
  )
  await catalog.activate("ordered.connector")

  assert.equal(await catalog.uninstall("ordered.connector"), true)
  assert.equal(await catalog.uninstall("ordered.connector"), false)
  assert.deepEqual(events, [
    "activate",
    "mount:ordered.connector.fs",
    "engine:ordered.connector.engine",
    "abort",
    "dispose",
    "unengine:ordered.connector.engine",
    "unmount:ordered.connector.fs",
  ])
  assert.equal(registry.health("ordered.connector"), "inactive")
})

test("registry: cleanup is best-effort, quarantined, diagnosable and retryable", async () => {
  const events: string[] = []
  let disposeAttempts = 0
  const registry = new RuntimeExtensionRegistry({
    mountFileSystem: () => () => events.push("filesystem-cleaned"),
    registerEngine: () => () => events.push("engine-cleaned"),
  })
  const catalog = new RuntimeExtensionCatalog(registry)
  catalog.discoverBuiltin(
    builtinFactory("retry.connector", {
      create: () =>
        extension("retry.connector", {
          dispose() {
            disposeAttempts += 1
            events.push(`dispose:${disposeAttempts}`)
            if (disposeAttempts === 1) throw new Error("socket still alive")
          },
        }),
    }),
  )
  await catalog.activate("retry.connector")

  await assert.rejects(
    catalog.uninstall("retry.connector"),
    (error) =>
      error instanceof AggregateError &&
      error.errors.some((failure) => String(failure).includes("socket still alive")),
  )
  assert.equal(registry.has("retry.connector"), false)
  assert.equal(registry.health("retry.connector"), "quarantined")
  assert.deepEqual(registry.pendingCleanup("retry.connector"), ["lifecycle"])
  const diagnostic = registry.failure("retry.connector")
  assert.ok(diagnostic instanceof AggregateError)
  assert.ok(diagnostic.errors.some((failure) => String(failure).includes("socket still alive")))
  assert.deepEqual(events, ["dispose:1", "engine-cleaned", "filesystem-cleaned"])

  assert.equal(await registry.retryCleanup("retry.connector"), true)
  assert.equal(registry.health("retry.connector"), "inactive")
  assert.deepEqual(events, ["dispose:1", "engine-cleaned", "filesystem-cleaned", "dispose:2"])
})

test("registry: partial registration rollback failures enter quarantine and can be retried", async () => {
  let allowUnmount = false
  let unmountAttempts = 0
  const registry = new RuntimeExtensionRegistry({
    mountFileSystem: () => () => {
      unmountAttempts += 1
      if (!allowUnmount) throw new Error("mount cleanup failed")
    },
    registerEngine: () => {
      throw new Error("renderer rejected")
    },
  })
  const catalog = new RuntimeExtensionCatalog(registry)
  catalog.discoverBuiltin(
    builtinFactory("rollback.connector", {
      create: () => extension("rollback.connector"),
    }),
  )

  await assert.rejects(catalog.activate("rollback.connector"), /rollback|renderer/i)
  assert.equal(registry.health("rollback.connector"), "quarantined")
  assert.deepEqual(registry.pendingCleanup("rollback.connector"), [
    "filesystem:rollback.connector.fs",
  ])
  assert.ok(unmountAttempts >= 1)

  allowUnmount = true
  await registry.retryCleanup("rollback.connector")
  assert.equal(registry.health("rollback.connector"), "inactive")
})

test("registry: arbitrary callers cannot install a structurally valid contribution", async () => {
  let mounted = false
  const registry = new RuntimeExtensionRegistry({
    mountFileSystem: () => {
      mounted = true
      return () => undefined
    },
    registerEngine: () => () => undefined,
  })

  await assert.rejects(registry.install(extension("unauthorized.connector"), {}), /not authorized/)
  assert.equal(mounted, false)
  assert.equal(registry.health("unauthorized.connector"), "inactive")
})

test("registry: invalid runtime engine descriptors fail before connector activation", async () => {
  let activated = false
  const registry = noOpRegistry()
  const catalog = new RuntimeExtensionCatalog(registry)
  catalog.discoverBuiltin(
    builtinFactory("invalid-engine.connector", {
      create: () => ({
        ...extension("invalid-engine.connector"),
        engines: [
          {
            descriptor: {
              engineId: "invalid-engine.connector.engine",
              label: "Invalid",
              layout: "overlay",
              access: "execute",
            } as never,
            renderer: () => null,
          },
        ],
        activate() {
          activated = true
        },
      }),
    }),
  )

  await assert.rejects(catalog.activate("invalid-engine.connector"), /layout/i)
  assert.equal(activated, false)
  assert.equal(registry.health("invalid-engine.connector"), "inactive")
})

test("catalog: factory disposer is identity-bound and old A disposer cannot uninstall replacement B", async () => {
  const mountedLabels: string[] = []
  const registry = new RuntimeExtensionRegistry({
    mountFileSystem: ({ provider }) => {
      mountedLabels.push(`mount:${provider.descriptor.name}`)
      return () => mountedLabels.push(`unmount:${provider.descriptor.name}`)
    },
    registerEngine: () => () => undefined,
  })
  const catalog = new RuntimeExtensionCatalog(registry)
  const disposeA = catalog.discoverBuiltin(
    builtinFactory("replace.connector", {
      label: "A",
      create: () => ({ ...extension("replace.connector"), label: "A" }),
    }),
  )
  await catalog.activate("replace.connector")
  await disposeA()

  catalog.discoverBuiltin(
    builtinFactory("replace.connector", {
      label: "B",
      version: 2,
      digest: "replace.connector:content:v2",
      permissionDigest: "replace.connector:permissions:v2",
      create: () => ({ ...extension("replace.connector"), label: "B" }),
    }),
  )
  await catalog.activate("replace.connector")
  await disposeA()

  assert.equal(registry.has("replace.connector"), true)
  assert.equal(catalog.state("replace.connector")?.label, "B")
  assert.deepEqual(mountedLabels, [
    "mount:replace.connector",
    "unmount:replace.connector",
    "mount:replace.connector",
  ])
})

test("catalog: replacement cannot adopt an old factory runtime while teardown is in flight", async () => {
  let releaseDispose!: () => void
  let enteredDispose!: () => void
  const disposing = new Promise<void>((resolve) => {
    enteredDispose = resolve
  })
  const release = new Promise<void>((resolve) => {
    releaseDispose = resolve
  })
  const registry = noOpRegistry()
  const catalog = new RuntimeExtensionCatalog(registry)
  const disposeA = catalog.discoverBuiltin(
    builtinFactory("racing.connector", {
      create: () =>
        extension("racing.connector", {
          async dispose({ reason }) {
            assert.equal(reason, "factory-removed")
            enteredDispose()
            await release
          },
        }),
    }),
  )
  await catalog.activate("racing.connector")

  const removingA = disposeA()
  await disposing
  catalog.discoverBuiltin(
    builtinFactory("racing.connector", {
      version: 2,
      digest: "racing.connector:content:v2",
      permissionDigest: "racing.connector:permissions:v2",
    }),
  )
  await assert.rejects(catalog.activate("racing.connector"), /owned by another factory/)

  releaseDispose()
  await removingA
  assert.equal(await catalog.retry("racing.connector"), true)
  await disposeA()
  assert.equal(registry.has("racing.connector"), true)
})

test("catalog: uninstall aborts an in-flight activation before any host contribution is exposed", async () => {
  const events: string[] = []
  let activationStarted!: () => void
  const started = new Promise<void>((resolve) => {
    activationStarted = resolve
  })
  const registry = new RuntimeExtensionRegistry({
    mountFileSystem: () => {
      events.push("mounted")
      return () => events.push("unmounted")
    },
    registerEngine: () => () => undefined,
  })
  const catalog = new RuntimeExtensionCatalog(registry)
  catalog.discoverBuiltin(
    builtinFactory("cancel.connector", {
      create: () =>
        extension("cancel.connector", {
          activate(signal) {
            activationStarted()
            return new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true })
            })
          },
          dispose({ signal, reason }) {
            assert.equal(signal.aborted, true)
            assert.equal(reason, "uninstall")
            events.push("disposed")
          },
        }),
    }),
  )

  const activating = catalog.activate("cancel.connector")
  const activationRejected = assert.rejects(activating, /activation aborted/)
  await started
  assert.equal(await catalog.uninstall("cancel.connector"), true)
  await activationRejected
  assert.deepEqual(events, ["disposed"])
  assert.equal(registry.health("cancel.connector"), "inactive")
})

test("catalog: external package follows discover -> verify -> consent -> activate", async () => {
  let creates = 0
  const { storage, values } = memoryStorage()
  const trust = trustFakes()
  const registry = noOpRegistry()
  const catalog = new RuntimeExtensionCatalog(registry, { storage, ...trust })
  catalog.discover(
    packageFactory("trusted.connector", {
      permissions: ["fs:read", "remote:connect"],
      create: () => {
        creates += 1
        return extension("trusted.connector")
      },
    }),
  )

  assert.equal(catalog.state("trusted.connector")?.health, "discovered")
  await assert.rejects(catalog.activate("trusted.connector"), /consent required/)
  assert.equal(creates, 0)
  const verification = await catalog.verify("trusted.connector")
  assert.equal(Object.isFrozen(verification), true)
  assert.equal(Reflect.set(verification, "digest", "mutated"), false)
  assert.equal(catalog.state("trusted.connector")?.health, "verified")
  await assert.rejects(catalog.activate("trusted.connector"), /consent required/)
  const consent = await catalog.consent("trusted.connector")
  assert.equal(Object.isFrozen(consent), true)
  assert.equal(Reflect.set(consent, "permissionDigest", "mutated"), false)
  assert.equal(catalog.state("trusted.connector")?.health, "ready")
  await catalog.activate("trusted.connector")

  assert.equal(creates, 1)
  const state = catalog.state("trusted.connector")
  assert.equal(state?.health, "active")
  assert.equal(state?.version, 1)
  assert.equal(state?.source?.kind, "package")
  assert.deepEqual(state?.permissions, ["fs:read", "remote:connect"])
  assert.equal(state?.failure, null)
  const persisted = JSON.parse(values.get(RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY)!) as {
    version: number
    records: unknown[]
  }
  assert.equal(persisted.version, 2)
  assert.deepEqual(Object.keys(persisted.records[0] as object).sort(), [
    "consentReceipt",
    "digest",
    "id",
    "permissionDigest",
    "version",
  ])
})

test("catalog: discovery snapshots executable identity and nested descriptor fields", async () => {
  let trustedCreates = 0
  let replacedCreates = 0
  const mutable = {
    ...packageFactory("mutation.connector"),
    source: {
      kind: "package" as const,
      id: "package:mutation.connector",
      location: "/verified/mutation.connector",
    },
    permissions: ["fs:read"],
    create: () => {
      trustedCreates += 1
      return extension("mutation.connector")
    },
  }
  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
    verifier: {
      verify(descriptor) {
        assert.equal(Object.isFrozen(descriptor), true)
        assert.equal(Object.isFrozen(descriptor.source), true)
        assert.equal(Object.isFrozen(descriptor.permissions), true)
        assert.equal(descriptor.digest, "mutation.connector:content:v1")
        assert.equal(descriptor.source.id, "package:mutation.connector")
        assert.deepEqual(descriptor.permissions, ["fs:read"])
        return verificationFor(descriptor)
      },
    },
    consent: trustFakes().consent,
  })
  catalog.discover(mutable)

  mutable.digest = "attacker-content"
  mutable.permissionDigest = "attacker-permissions"
  mutable.source.id = "package:attacker"
  mutable.permissions.push("fs:write")
  mutable.create = () => {
    replacedCreates += 1
    return extension("mutation.connector")
  }

  await catalog.consent("mutation.connector")
  await catalog.activate("mutation.connector")

  assert.equal(trustedCreates, 1)
  assert.equal(replacedCreates, 0)
  assert.equal(catalog.state("mutation.connector")?.digest, "mutation.connector:content:v1")
  assert.deepEqual(catalog.state("mutation.connector")?.permissions, ["fs:read"])
})

test("catalog: package verification is fail-closed and mismatched receipts never run factory code", async () => {
  let creates = 0
  const factory = packageFactory("rejected.connector", {
    create: () => {
      creates += 1
      return extension("rejected.connector")
    },
  })
  const withoutVerifier = new RuntimeExtensionCatalog(noOpRegistry())
  withoutVerifier.discover(factory)
  await assert.rejects(withoutVerifier.verify(factory.id), /No runtime extension verifier/)

  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
    verifier: {
      verify: (descriptor) => ({ ...verificationFor(descriptor), digest: "wrong-digest" }),
    },
    consent: trustFakes().consent,
  })
  catalog.discover(factory)
  await assert.rejects(catalog.verify(factory.id), /verification rejected/)
  await assert.rejects(catalog.activate(factory.id), /consent required/)
  assert.equal(creates, 0)
})

test("catalog: authorize persists one grant and projects verification audit metadata", async () => {
  const factory = packageFactory("authorize.connector")
  const storage = memoryStorage()
  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
    storage: storage.storage,
    ...trustFakes(),
  })
  catalog.discover(factory)

  assert.equal(await catalog.authorize(factory.id), true)
  assert.equal(await catalog.authorize(factory.id), false)
  assert.deepEqual(catalog.state(factory.id)?.verification, {
    verifierId: "host-verifier",
    verifiedAt: 1,
  })
  assert.equal(catalog.state(factory.id)?.grantedAt, 2)
  assert.match(storage.values.get(RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY)!, /consent:/)
})

test("catalog: concurrent authorization issues only one verifier and consent receipt", async () => {
  const factory = packageFactory("concurrent-authorize.connector")
  let verifies = 0
  let requests = 0
  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
    verifier: {
      verify(descriptor) {
        verifies += 1
        return verificationFor(descriptor)
      },
    },
    consent: {
      request(descriptor) {
        requests += 1
        return consentFor(descriptor)
      },
      restore: () => null,
      revoke: () => undefined,
    },
  })
  catalog.discover(factory)

  assert.deepEqual(
    await Promise.all([catalog.authorize(factory.id), catalog.authorize(factory.id)]),
    [true, true],
  )
  assert.equal(verifies, 1)
  assert.equal(requests, 1)
  assert.deepEqual(catalog.installedIds(), [factory.id])
})

test("catalog: uninstall during consent revokes the late receipt instead of resurrecting a grant", async () => {
  const factory = packageFactory("cancel-consent.connector")
  let release!: (receipt: RuntimeExtensionConsentReceipt) => void
  const request = new Promise<RuntimeExtensionConsentReceipt>((resolve) => {
    release = resolve
  })
  let markRequested!: () => void
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve
  })
  const revoked: string[] = []
  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
    verifier: trustFakes().verifier,
    consent: {
      request: () => {
        markRequested()
        return request
      },
      restore: () => null,
      revoke: (receipt) => void revoked.push(receipt.receiptId),
    },
  })
  catalog.discover(factory)
  const authorization = catalog.authorize(factory.id)
  await requested
  await catalog.uninstall(factory.id)
  const lateReceipt = consentFor(factory)
  release(lateReceipt)

  await assert.rejects(authorization, /authorization was cancelled/)
  assert.deepEqual(revoked, [lateReceipt.receiptId])
  assert.deepEqual(catalog.installedIds(), [])
  assert.equal(catalog.state(factory.id)?.health, "consent-required")
})

test("catalog: version or permission digest changes require fresh consent", async () => {
  const baseFactory = packageFactory("upgrade.connector")
  const firstStorage = memoryStorage()
  const first = new RuntimeExtensionCatalog(noOpRegistry(), {
    storage: firstStorage.storage,
    ...trustFakes(),
  })
  first.discover(baseFactory)
  await first.consent(baseFactory.id)
  const snapshot = firstStorage.values.get(RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY)!

  for (const changed of [
    packageFactory("upgrade.connector", {
      version: 2,
      digest: "upgrade.connector:content:v2",
    }),
    packageFactory("upgrade.connector", {
      permissions: ["fs:read", "fs:write"],
      permissionDigest: "upgrade.connector:permissions:expanded",
    }),
  ]) {
    let creates = 0
    const { storage } = memoryStorage(snapshot)
    const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
      storage,
      ...trustFakes({ restored: new Set([`consent:${changed.id}:1:${changed.permissionDigest}`]) }),
    })
    catalog.discover({
      ...changed,
      create: () => {
        creates += 1
        return extension(changed.id)
      },
    })
    catalog.hydrate()

    assert.equal(catalog.state(changed.id)?.health, "consent-required")
    assert.equal(await catalog.restoreConsent(changed.id), false)
    await assert.rejects(catalog.activate(changed.id), /consent required/)
    assert.equal(creates, 0)
    await catalog.consent(changed.id)
    await catalog.activate(changed.id)
    assert.equal(creates, 1)
  }
})

test("catalog: matching persisted receipt is restored only through injected authority", async () => {
  const factory = packageFactory("restore.connector")
  const seed = memoryStorage()
  const initial = new RuntimeExtensionCatalog(noOpRegistry(), {
    storage: seed.storage,
    ...trustFakes(),
  })
  initial.discover(factory)
  const granted = await initial.consent(factory.id)

  let creates = 0
  const restoredTrust = trustFakes({ restored: new Set([granted.receiptId]) })
  const next = new RuntimeExtensionCatalog(noOpRegistry(), {
    storage: seed.storage,
    ...restoredTrust,
  })
  next.discover({
    ...factory,
    create: () => {
      creates += 1
      return extension(factory.id)
    },
  })
  next.hydrate()
  assert.equal(creates, 0, "hydrate must never execute factory code")
  assert.equal(await next.restoreConsent(factory.id), true)
  await next.activate(factory.id)
  assert.equal(creates, 1)
})

test("catalog: consent authority restore failures are diagnosable and do not activate", async () => {
  const factory = packageFactory("restore-failure.connector")
  const raw = JSON.stringify({
    version: 2,
    records: [
      {
        id: factory.id,
        version: factory.version,
        digest: factory.digest,
        permissionDigest: factory.permissionDigest,
        consentReceipt: "persisted-receipt",
      },
    ],
  })
  const { storage } = memoryStorage(raw)
  let creates = 0
  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
    storage,
    verifier: trustFakes().verifier,
    consent: {
      request: (descriptor) => consentFor(descriptor),
      restore: () => {
        throw new Error("credential store unavailable")
      },
    },
  })
  catalog.discover({
    ...factory,
    create: () => {
      creates += 1
      return extension(factory.id)
    },
  })
  catalog.hydrate()

  await assert.rejects(catalog.resume(factory.id), /credential store unavailable/)
  assert.equal(creates, 0)
  assert.equal(catalog.state(factory.id)?.health, "degraded")
  assert.match(String(catalog.failure(factory.id)), /credential store unavailable/)
})

test("catalog: revoke restores a persisted receipt through the authority before invalidating it", async () => {
  const factory = packageFactory("persisted-revoke.connector")
  const receiptId = "persisted-consent-receipt"
  const snapshot = JSON.stringify({
    version: 2,
    records: [
      {
        id: factory.id,
        version: factory.version,
        digest: factory.digest,
        permissionDigest: factory.permissionDigest,
        consentReceipt: receiptId,
      },
    ],
  })
  const { storage, values } = memoryStorage(snapshot)
  let restored = 0
  let revoked = false
  let creates = 0
  const consent: RuntimeExtensionConsentAuthority = {
    request: (descriptor) => consentFor(descriptor),
    restore: (descriptor, _verification, persistedReceiptId) => {
      restored += 1
      if (revoked || persistedReceiptId !== receiptId) return null
      return consentFor(descriptor, persistedReceiptId)
    },
    revoke(receipt) {
      assert.equal(receipt.receiptId, receiptId)
      revoked = true
    },
  }
  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
    storage,
    verifier: trustFakes().verifier,
    consent,
  })
  catalog.discover({
    ...factory,
    create: () => {
      creates += 1
      return extension(factory.id)
    },
  })
  catalog.hydrate()

  await catalog.revoke(factory.id)
  assert.equal(restored, 1)
  assert.equal(revoked, true)
  assert.equal(creates, 0)
  assert.deepEqual(catalog.installedIds(), [])
  assert.deepEqual(
    (JSON.parse(values.get(RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY)!) as { records: unknown[] })
      .records,
    [],
  )

  const replay = new RuntimeExtensionCatalog(noOpRegistry(), {
    storage: memoryStorage(snapshot).storage,
    verifier: trustFakes().verifier,
    consent,
  })
  replay.discover(factory)
  replay.hydrate()
  assert.equal(await replay.restoreConsent(factory.id), false)
  await assert.rejects(replay.activate(factory.id), /consent required/)
})

test("catalog: revoke failure retains the receipt reference for a safe retry", async () => {
  const factory = packageFactory("unrestorable-revoke.connector")
  const { storage, values } = memoryStorage(
    JSON.stringify({
      version: 2,
      records: [
        {
          id: factory.id,
          version: factory.version,
          digest: factory.digest,
          permissionDigest: factory.permissionDigest,
          consentReceipt: "unrestorable-receipt",
        },
      ],
    }),
  )
  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
    storage,
    verifier: trustFakes().verifier,
  })
  catalog.discover(factory)
  catalog.hydrate()

  await assert.rejects(catalog.revoke(factory.id), /revoke failed/i)
  assert.deepEqual(catalog.installedIds(), [factory.id])
  assert.equal(catalog.state(factory.id)?.health, "revocation-failed")
  assert.ok(catalog.state(factory.id)?.failure instanceof AggregateError)
  assert.equal(
    (JSON.parse(values.get(RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY)!) as { records: unknown[] })
      .records.length,
    1,
  )
  await assert.rejects(catalog.retry(factory.id), /revocation must be retried/)
  await assert.rejects(catalog.uninstall(factory.id), /revocation must be retried/)
})

test("catalog: upgraded descriptor revokes the old persisted binding without restoring it", async () => {
  const factory = packageFactory("upgraded-revoke.connector", {
    version: 2,
    digest: "upgraded-revoke.connector:content:v2",
  })
  const oldRecord = {
    id: factory.id,
    version: 1,
    digest: "upgraded-revoke.connector:content:v1",
    permissionDigest: factory.permissionDigest,
    consentReceipt: "old-persisted-consent",
  }
  const { storage } = memoryStorage(JSON.stringify({ version: 2, records: [oldRecord] }))
  let restored = 0
  let revokedReference: unknown
  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
    storage,
    verifier: trustFakes().verifier,
    consent: {
      request: (descriptor) => consentFor(descriptor),
      restore: () => {
        restored += 1
        return null
      },
      revokePersisted(reference) {
        revokedReference = reference
      },
    },
  })
  catalog.discover(factory)
  catalog.hydrate()

  assert.equal(await catalog.revoke(factory.id), true)
  assert.equal(restored, 0)
  assert.deepEqual(revokedReference, {
    receiptId: oldRecord.consentReceipt,
    id: oldRecord.id,
    version: oldRecord.version,
    digest: oldRecord.digest,
    permissionDigest: oldRecord.permissionDigest,
  })
  assert.equal(catalog.state(factory.id)?.health, "revoked")
  assert.deepEqual(catalog.installedIds(), [])
})

test("catalog: failed credential revocation stops runtime and can be completed later", async () => {
  const events: string[] = []
  let credentialStoreAvailable = false
  const factory = packageFactory("retry-revoke.connector", {
    create: () =>
      extension("retry-revoke.connector", {
        dispose() {
          events.push("stopped")
        },
      }),
  })
  const trust = trustFakes()
  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
    verifier: trust.verifier,
    consent: {
      ...trust.consent,
      revoke() {
        if (!credentialStoreAvailable) throw new Error("credential store unavailable")
      },
    },
  })
  catalog.discover(factory)
  await catalog.authorize(factory.id)
  await catalog.activate(factory.id)

  await assert.rejects(catalog.revoke(factory.id), /revoke failed/)
  assert.deepEqual(events, ["stopped"])
  assert.equal(catalog.state(factory.id)?.health, "revocation-failed")
  assert.deepEqual(catalog.installedIds(), [factory.id])

  credentialStoreAvailable = true
  assert.equal(await catalog.revoke(factory.id), true)
  assert.equal(catalog.state(factory.id)?.health, "revoked")
  assert.deepEqual(catalog.installedIds(), [])
})

test("catalog: revoke clears grant, aborts/tears down runtime and records diagnostics", async () => {
  const revoked: string[] = []
  const events: string[] = []
  const { storage, values } = memoryStorage()
  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
    storage,
    ...trustFakes({ revoked }),
  })
  const factory = packageFactory("revoke.connector", {
    create: () =>
      extension("revoke.connector", {
        activate(signal) {
          signal.addEventListener("abort", () => events.push("abort"), { once: true })
        },
        dispose({ signal, reason }) {
          assert.equal(signal.aborted, true)
          assert.equal(reason, "revoke")
          events.push("dispose")
        },
      }),
  })
  catalog.discover(factory)
  const receipt = await catalog.consent(factory.id)
  await catalog.activate(factory.id)

  await catalog.revoke(factory.id)
  assert.deepEqual(events, ["abort", "dispose"])
  assert.deepEqual(revoked, [receipt.receiptId])
  assert.deepEqual(catalog.installedIds(), [])
  assert.equal(catalog.state(factory.id)?.health, "revoked")
  const persisted = JSON.parse(values.get(RUNTIME_EXTENSION_INSTALLS_STORAGE_KEY)!) as {
    records: unknown[]
  }
  assert.deepEqual(persisted.records, [])
})

test("catalog: revoke clears persisted grant even when lifecycle teardown is quarantined", async () => {
  const revoked: string[] = []
  const { storage } = memoryStorage()
  const registry = noOpRegistry()
  const catalog = new RuntimeExtensionCatalog(registry, {
    storage,
    ...trustFakes({ revoked }),
  })
  const factory = packageFactory("revoke-failure.connector", {
    create: () =>
      extension("revoke-failure.connector", {
        dispose() {
          throw new Error("process did not exit")
        },
      }),
  })
  catalog.discover(factory)
  const receipt = await catalog.consent(factory.id)
  await catalog.activate(factory.id)

  await assert.rejects(catalog.revoke(factory.id), /revoke failed/)
  assert.deepEqual(catalog.installedIds(), [])
  assert.deepEqual(revoked, [receipt.receiptId])
  assert.equal(registry.health(factory.id), "quarantined")
  assert.equal(catalog.state(factory.id)?.health, "quarantined")
  assert.deepEqual(catalog.state(factory.id)?.pendingCleanup, ["lifecycle"])
})

test("catalog: malicious or oversized persistence is rejected without executing code", () => {
  const malicious = [
    JSON.stringify({ version: 1, installed: ["package.connector"] }),
    JSON.stringify({
      version: 2,
      records: [
        {
          id: "../escape",
          version: 1,
          digest: "d",
          permissionDigest: "p",
          consentReceipt: "r",
        },
      ],
    }),
    JSON.stringify({
      version: 2,
      records: Array.from({ length: 65 }, (_, index) => ({
        id: `connector-${index}`,
        version: 1,
        digest: "d",
        permissionDigest: "p",
        consentReceipt: "r",
      })),
    }),
    JSON.stringify({
      version: 2,
      records: [
        {
          id: "duplicate.connector",
          version: 1,
          digest: "d",
          permissionDigest: "p",
          consentReceipt: "r",
        },
        {
          id: "duplicate.connector",
          version: 1,
          digest: "d",
          permissionDigest: "p",
          consentReceipt: "r",
        },
      ],
    }),
    JSON.stringify({
      version: 2,
      records: [],
      executable: "alert(1)",
    }),
    "x".repeat(70 * 1024),
  ]

  for (const raw of malicious) {
    let creates = 0
    const { storage } = memoryStorage(raw)
    const catalog = new RuntimeExtensionCatalog(noOpRegistry(), {
      storage,
      ...trustFakes(),
    })
    catalog.discover(
      packageFactory("package.connector", {
        create: () => {
          creates += 1
          return extension("package.connector")
        },
      }),
    )
    catalog.hydrate()
    assert.deepEqual(catalog.installedIds(), [])
    assert.match(String(catalog.failure("$snapshot")), /Invalid runtime extension snapshot/)
    assert.equal(creates, 0)
  }
})

test("catalog: unknown valid persisted records stay unavailable and never become executable", async () => {
  const raw = JSON.stringify({
    version: 2,
    records: [
      {
        id: "unknown.connector",
        version: 7,
        digest: "verified-digest",
        permissionDigest: "verified-permissions",
        consentReceipt: "opaque-receipt",
      },
    ],
  })
  const { storage } = memoryStorage(raw)
  const catalog = new RuntimeExtensionCatalog(noOpRegistry(), { storage, ...trustFakes() })
  catalog.hydrate()

  assert.deepEqual(catalog.installedIds(), ["unknown.connector"])
  assert.equal(catalog.state("unknown.connector")?.health, "unavailable")
  assert.equal(catalog.hasDiscovered("unknown.connector"), false)
  await assert.rejects(catalog.activate("unknown.connector"), /Unknown runtime extension/)

  catalog.discover(packageFactory("unknown.connector", { version: 7 }))
  assert.equal(catalog.hasDiscovered("unknown.connector"), true)
  assert.equal(catalog.state("unknown.connector")?.health, "consent-required")
})
