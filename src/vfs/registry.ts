import type { ResourceRef, ResourceScheme } from "@protocol/resource"
import type {
  ResourceAction,
  ResourceActionId,
  ResourcePage,
  ResourceQuery,
  ResourceRecord,
  VfsAccessContext,
  VfsProvider,
  WatchHandle,
} from "./types"
import { VfsError } from "./types"

const providers = new Map<ResourceScheme, VfsProvider>()

export function registerVfsProvider(provider: VfsProvider): () => void {
  if (providers.has(provider.scheme)) {
    throw new VfsError("unsupported", `VFS provider already registered: ${provider.scheme}`)
  }
  providers.set(provider.scheme, provider)
  return () => {
    if (providers.get(provider.scheme) === provider) providers.delete(provider.scheme)
  }
}

export function getVfsProvider(scheme: ResourceScheme): VfsProvider | null {
  return providers.get(scheme) ?? null
}

export function listVfsProviderSchemes(): ResourceScheme[] {
  return [...providers.keys()]
}

function providerForScheme(scheme: ResourceScheme): VfsProvider {
  const provider = providers.get(scheme)
  if (!provider) throw new VfsError("unsupported", `No VFS provider registered: ${scheme}`)
  return provider
}

function providerForRef(ref: ResourceRef): VfsProvider {
  return providerForScheme(ref.scheme)
}

export async function listResources(
  query: ResourceQuery,
  ctx: VfsAccessContext,
): Promise<ResourcePage> {
  return providerForScheme(query.scheme).list(query, ctx)
}

export async function getResource(
  ref: ResourceRef,
  ctx: VfsAccessContext,
): Promise<ResourceRecord | null> {
  return providerForRef(ref).get(ref, ctx)
}

export async function createResource(
  scheme: ResourceScheme,
  input: unknown,
  ctx: VfsAccessContext,
): Promise<ResourceRecord> {
  const provider = providerForScheme(scheme)
  if (!provider.create) throw new VfsError("unsupported", `Provider cannot create: ${scheme}`)
  return provider.create(input, ctx)
}

export async function resourceActions(
  ref: ResourceRef,
  ctx: VfsAccessContext,
): Promise<ResourceAction[]> {
  return providerForRef(ref).actions(ref, ctx)
}

export async function invokeResourceAction(
  ref: ResourceRef,
  action: ResourceActionId,
  input: unknown,
  ctx: VfsAccessContext,
): Promise<unknown> {
  return providerForRef(ref).invoke(ref, action, input, ctx)
}

export function watchResources(
  query: ResourceQuery,
  ctx: VfsAccessContext,
  notify: () => void,
): WatchHandle | null {
  return providerForScheme(query.scheme).watch?.(query, ctx, notify) ?? null
}

export function clearVfsProvidersForTest(): void {
  providers.clear()
}
