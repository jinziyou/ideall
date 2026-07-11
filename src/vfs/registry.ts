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
const DEFAULT_GET_CONCURRENCY = 4
const MAX_GET_CONCURRENCY = 32

function getConcurrency(value: number | undefined): number {
  const concurrency = value ?? DEFAULT_GET_CONCURRENCY
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_GET_CONCURRENCY) {
    throw new VfsError(
      "unsupported",
      `VFS get concurrency must be an integer between 1 and ${MAX_GET_CONCURRENCY}`,
    )
  }
  return concurrency
}

async function mapConcurrentOrdered<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  const failures: Array<{ index: number; error: unknown }> = []
  let nextIndex = 0
  let stopped = false
  const worker = async () => {
    while (!stopped) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      try {
        results[index] = await task(items[index] as T)
      } catch (error) {
        failures.push({ index, error })
        stopped = true
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  if (failures.length > 0) {
    failures.sort((left, right) => left.index - right.index)
    throw failures[0]?.error
  }
  return results
}

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

export async function getResources(
  refs: readonly ResourceRef[],
  ctx: VfsAccessContext,
  concurrency?: number,
): Promise<Array<ResourceRecord | null>> {
  if (refs.length === 0) return []
  const limit = getConcurrency(concurrency)
  const groups = new Map<
    ResourceScheme,
    { provider: VfsProvider; items: Array<{ ref: ResourceRef; index: number }> }
  >()
  refs.forEach((ref, index) => {
    const provider = providerForRef(ref)
    const current = groups.get(ref.scheme)
    if (current) current.items.push({ ref, index })
    else groups.set(ref.scheme, { provider, items: [{ ref, index }] })
  })

  const results = new Array<ResourceRecord | null>(refs.length)
  for (const { provider, items } of groups.values()) {
    const providerRefs = items.map((item) => item.ref)
    let values: Array<ResourceRecord | null>
    if (provider.getMany) {
      values = await provider.getMany(providerRefs, ctx)
      if (!Array.isArray(values) || values.length !== providerRefs.length) {
        throw new VfsError(
          "unsupported",
          `VFS provider ${provider.scheme} returned ${Array.isArray(values) ? values.length : "a non-array batch"} for ${providerRefs.length} refs`,
        )
      }
      for (let index = 0; index < values.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(values, index) || values[index] === undefined) {
          throw new VfsError(
            "unsupported",
            `VFS provider ${provider.scheme} returned an undefined batch result at index ${index}`,
          )
        }
      }
    } else {
      values = await mapConcurrentOrdered(providerRefs, limit, async (ref) => {
        try {
          return await provider.get(ref, ctx)
        } catch (error) {
          if (error instanceof VfsError && error.code === "not-found") return null
          throw error
        }
      })
    }
    items.forEach((item, index) => {
      results[item.index] = values[index] as ResourceRecord | null
    })
  }
  return results
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
