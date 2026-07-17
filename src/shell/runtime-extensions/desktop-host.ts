import { configureRuntimeExtensionTrustHost, runtimeExtensionCatalog } from "../runtime-extensions"
import {
  discoverNativeRuntimeExtensions,
  applyNativeRuntimeExtensionPublisherRotation,
  applyNativeRuntimeExtensionUpdate,
  discardNativeRuntimeExtensionUpdate,
  getNativeRuntimeExtensionRegistrySnapshot,
  importNativeRuntimeExtensionRevocations,
  installNativeRuntimeExtension,
  inspectNativeRuntimeExtensionPublisher,
  inspectNativeRuntimeExtensionPublisherRotation,
  listNativeRuntimeExtensionPublishers,
  nativeRuntimeExtensionManagementAvailable,
  prepareNativeRuntimeExtensionUpdate,
  revokeNativeRuntimeExtensionPublisher,
  rollbackNativeRuntimeExtension,
  refreshNativeRuntimeExtensionRegistry,
  trustNativeRuntimeExtensionPublisher,
  uninstallNativeRuntimeExtension,
  verifyNativeRuntimeExtension,
  type NativeRuntimeExtensionPackage,
  type NativeRuntimeExtensionPackageMutation,
  type NativeRuntimeExtensionPublisher,
  type NativeRuntimeExtensionPublisherCandidate,
  type NativeRuntimeExtensionPublisherRotationCandidate,
  type NativeRuntimeExtensionPublisherRotationResult,
  type NativeRuntimeExtensionRevocationImport,
  type NativeRuntimeExtensionRegistrySnapshot,
  type NativeRuntimeExtensionUpdateCandidate,
} from "./native-host"
import { replaceRuntimeExtensionPackageRejections } from "./discovery-diagnostics"
import { signedMcpRuntimeExtensionFactory } from "./signed-mcp-factory"

let hostConfigured = false
let installation: Promise<void> | undefined
let refreshTail: Promise<void> = Promise.resolve()
let packages: readonly NativeRuntimeExtensionPackage[] = []
const packageDisposers = new Map<string, () => Promise<void>>()

function configureHost(): void {
  if (hostConfigured) return
  configureRuntimeExtensionTrustHost({
    verifier: {
      verify: (descriptor) =>
        verifyNativeRuntimeExtension(
          descriptor.id,
          descriptor.version,
          descriptor.digest,
          descriptor.permissionDigest,
        ),
    },
  })
  hostConfigured = true
}

function discoveryFailureCode(error: unknown): string {
  const candidate =
    typeof error === "string" ? error : error instanceof Error ? error.message : "discovery-failed"
  return /^[a-z0-9-]{1,128}$/.test(candidate) ? candidate : "discovery-failed"
}

function matchesDiscoveredPackage(packageValue: NativeRuntimeExtensionPackage): boolean {
  const state = runtimeExtensionCatalog.state(packageValue.id)
  return Boolean(
    state &&
    state.source?.kind === "package" &&
    state.source.id === packageValue.publisher &&
    state.version === packageValue.version &&
    state.digest === packageValue.digest &&
    state.permissionDigest === packageValue.permissionDigest,
  )
}

async function retirePackage(id: string): Promise<void> {
  const dispose = packageDisposers.get(id)
  packageDisposers.delete(id)
  let failure: unknown
  const state = runtimeExtensionCatalog.state(id)
  try {
    if (state?.source?.kind === "package") {
      if (state.desired) await runtimeExtensionCatalog.revoke(id)
      else await runtimeExtensionCatalog.uninstall(id)
    }
  } catch (error) {
    failure = error
  }
  try {
    await dispose?.()
  } catch (error) {
    failure = failure
      ? new AggregateError([failure, error], `Extension teardown failed: ${id}`)
      : error
  }
  if (failure) throw failure
}

async function reconcileDesktopRuntimeExtensions(): Promise<void> {
  configureHost()
  let report
  try {
    report = await discoverNativeRuntimeExtensions()
  } catch (error) {
    replaceRuntimeExtensionPackageRejections([
      { directory: "extensions", code: discoveryFailureCode(error) },
    ])
    throw error
  }

  const nextById = new Map(report.packages.map((item) => [item.id, item]))
  const rejected = [...report.rejected]
  const failures: unknown[] = []
  for (const id of [...packageDisposers.keys()]) {
    const next = nextById.get(id)
    if (next && matchesDiscoveredPackage(next)) continue
    try {
      await retirePackage(id)
    } catch (error) {
      failures.push(error)
      rejected.push({ directory: id, code: "catalog-teardown-failed" })
    }
  }

  for (const packageValue of report.packages) {
    if (packageDisposers.has(packageValue.id) && matchesDiscoveredPackage(packageValue)) continue
    if (runtimeExtensionCatalog.hasDiscovered(packageValue.id)) {
      rejected.push({
        directory: packageValue.id,
        code: "factory-id-already-discovered",
      })
      continue
    }
    try {
      packageDisposers.set(
        packageValue.id,
        runtimeExtensionCatalog.discover(signedMcpRuntimeExtensionFactory(packageValue)),
      )
    } catch (error) {
      failures.push(error)
      rejected.push({ directory: packageValue.id, code: "catalog-rejected" })
      continue
    }
    if (runtimeExtensionCatalog.state(packageValue.id)?.desired) {
      try {
        await runtimeExtensionCatalog.resume(packageValue.id)
      } catch {
        // Catalog 保存逐扩展失败；一个 connector 不能阻断其余已验证包的发现。
      }
    }
  }
  packages = report.packages
  replaceRuntimeExtensionPackageRejections(rejected)
  if (failures.length) {
    throw new AggregateError(failures, "Runtime extension catalog reconciliation failed")
  }
}

export function refreshDesktopRuntimeExtensions(): Promise<void> {
  const operation = refreshTail.then(reconcileDesktopRuntimeExtensions)
  refreshTail = operation.catch(() => {})
  return operation
}

export function installDesktopRuntimeExtensions(): Promise<void> {
  if (installation) return installation
  installation = refreshDesktopRuntimeExtensions().catch((error) => {
    installation = undefined
    throw error
  })
  return installation
}

export function desktopRuntimeExtensionPackages(): readonly NativeRuntimeExtensionPackage[] {
  return packages
}

export function desktopRuntimeExtensionManagementAvailable(): boolean {
  return nativeRuntimeExtensionManagementAvailable()
}

export function getDesktopRuntimeExtensionRegistrySnapshot(): Promise<NativeRuntimeExtensionRegistrySnapshot | null> {
  return getNativeRuntimeExtensionRegistrySnapshot()
}

export function refreshDesktopRuntimeExtensionRegistry(): Promise<NativeRuntimeExtensionRegistrySnapshot> {
  return refreshNativeRuntimeExtensionRegistry()
}

export function prepareDesktopRuntimeExtensionUpdate(
  id: string,
): Promise<NativeRuntimeExtensionUpdateCandidate> {
  return prepareNativeRuntimeExtensionUpdate(id)
}

export async function applyDesktopRuntimeExtensionUpdate(
  candidate: NativeRuntimeExtensionUpdateCandidate,
): Promise<NativeRuntimeExtensionPackageMutation> {
  if (runtimeExtensionCatalog.state(candidate.id)?.source?.kind === "package") {
    await retirePackage(candidate.id)
  }
  try {
    const result = await applyNativeRuntimeExtensionUpdate(candidate)
    await refreshDesktopRuntimeExtensions()
    return result
  } catch (error) {
    await refreshDesktopRuntimeExtensions().catch(() => {})
    throw error
  }
}

export function discardDesktopRuntimeExtensionUpdate(token: string): Promise<boolean> {
  return discardNativeRuntimeExtensionUpdate(token)
}

export function listDesktopRuntimeExtensionPublishers(): Promise<
  readonly NativeRuntimeExtensionPublisher[]
> {
  return listNativeRuntimeExtensionPublishers()
}

export function inspectDesktopRuntimeExtensionPublisher(): Promise<NativeRuntimeExtensionPublisherCandidate | null> {
  return inspectNativeRuntimeExtensionPublisher()
}

export function inspectDesktopRuntimeExtensionPublisherRotation(): Promise<NativeRuntimeExtensionPublisherRotationCandidate | null> {
  return inspectNativeRuntimeExtensionPublisherRotation()
}

export async function applyDesktopRuntimeExtensionPublisherRotation(
  candidate: NativeRuntimeExtensionPublisherRotationCandidate,
): Promise<NativeRuntimeExtensionPublisherRotationResult> {
  const affected = packages.filter((packageValue) => packageValue.publisher === candidate.publisher)
  for (const packageValue of affected) {
    if (packageDisposers.has(packageValue.id)) await retirePackage(packageValue.id)
  }
  try {
    const result = await applyNativeRuntimeExtensionPublisherRotation(candidate)
    await refreshDesktopRuntimeExtensions()
    return result
  } catch (error) {
    await refreshDesktopRuntimeExtensions().catch(() => {})
    throw error
  }
}

export async function trustDesktopRuntimeExtensionPublisher(
  candidate: NativeRuntimeExtensionPublisherCandidate,
): Promise<boolean> {
  const changed = await trustNativeRuntimeExtensionPublisher(candidate)
  if (changed) await refreshDesktopRuntimeExtensions()
  return changed
}

export async function revokeDesktopRuntimeExtensionPublisher(
  publisher: string,
  fingerprint: string,
): Promise<boolean> {
  const changed = await revokeNativeRuntimeExtensionPublisher(publisher, fingerprint)
  if (changed) await refreshDesktopRuntimeExtensions()
  return changed
}

export async function importDesktopRuntimeExtensionRevocations(): Promise<NativeRuntimeExtensionRevocationImport> {
  const result = await importNativeRuntimeExtensionRevocations()
  if (result.changed) await refreshDesktopRuntimeExtensions()
  return result
}

export async function installDesktopRuntimeExtensionPackage(): Promise<NativeRuntimeExtensionPackageMutation> {
  const result = await installNativeRuntimeExtension()
  if (result.changed) await refreshDesktopRuntimeExtensions()
  return result
}

export async function rollbackDesktopRuntimeExtensionPackage(
  id: string,
): Promise<NativeRuntimeExtensionPackageMutation> {
  if (packageDisposers.has(id)) await retirePackage(id)
  const result = await rollbackNativeRuntimeExtension(id)
  await refreshDesktopRuntimeExtensions()
  return result
}

export async function uninstallDesktopRuntimeExtensionPackage(id: string): Promise<boolean> {
  if (packageDisposers.has(id)) await retirePackage(id)
  const changed = await uninstallNativeRuntimeExtension(id)
  await refreshDesktopRuntimeExtensions()
  return changed
}
