import type { ResourceRef, ResourceScheme } from "@protocol/resource"
import type {
  ResourceAction,
  ResourceActionId,
  ResourcePage,
  ResourceQuery,
  ResourceRecord,
  ResourceSourceAccessContext,
  ResourceSourceProvider,
  WatchHandle,
} from "./types"
import { ResourceSourceError } from "./types"

const providers = new Map<ResourceScheme, ResourceSourceProvider>()
const DEFAULT_GET_CONCURRENCY = 4
const MAX_GET_CONCURRENCY = 32

function getConcurrency(value: number | undefined): number {
  const concurrency = value ?? DEFAULT_GET_CONCURRENCY
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_GET_CONCURRENCY) {
    throw new ResourceSourceError(
      "unsupported",
      `Resource source get concurrency must be an integer between 1 and ${MAX_GET_CONCURRENCY}`,
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

export function registerResourceSource(provider: ResourceSourceProvider): () => void {
  if (providers.has(provider.scheme)) {
    throw new ResourceSourceError(
      "unsupported",
      `Resource source already registered: ${provider.scheme}`,
    )
  }
  providers.set(provider.scheme, provider)
  return () => {
    if (providers.get(provider.scheme) === provider) providers.delete(provider.scheme)
  }
}

export function getResourceSource(scheme: ResourceScheme): ResourceSourceProvider | null {
  return providers.get(scheme) ?? null
}

export function listResourceSourceSchemes(): ResourceScheme[] {
  return [...providers.keys()]
}

function providerForScheme(scheme: ResourceScheme): ResourceSourceProvider {
  const provider = providers.get(scheme)
  if (!provider) {
    throw new ResourceSourceError("unsupported", `No resource source registered: ${scheme}`)
  }
  return provider
}

function providerForRef(ref: ResourceRef): ResourceSourceProvider {
  return providerForScheme(ref.scheme)
}

export async function listResources(
  query: ResourceQuery,
  ctx: ResourceSourceAccessContext,
): Promise<ResourcePage> {
  return providerForScheme(query.scheme).list(query, ctx)
}

export async function getResource(
  ref: ResourceRef,
  ctx: ResourceSourceAccessContext,
): Promise<ResourceRecord | null> {
  return providerForRef(ref).get(ref, ctx)
}

export async function getResources(
  refs: readonly ResourceRef[],
  ctx: ResourceSourceAccessContext,
  concurrency?: number,
): Promise<Array<ResourceRecord | null>> {
  if (refs.length === 0) return []
  const limit = getConcurrency(concurrency)
  const groups = new Map<
    ResourceScheme,
    { provider: ResourceSourceProvider; items: Array<{ ref: ResourceRef; index: number }> }
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
        throw new ResourceSourceError(
          "unsupported",
          `Resource source ${provider.scheme} returned ${Array.isArray(values) ? values.length : "a non-array batch"} for ${providerRefs.length} refs`,
        )
      }
      for (let index = 0; index < values.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(values, index) || values[index] === undefined) {
          throw new ResourceSourceError(
            "unsupported",
            `Resource source ${provider.scheme} returned an undefined batch result at index ${index}`,
          )
        }
      }
    } else {
      values = await mapConcurrentOrdered(providerRefs, limit, async (ref) => {
        try {
          return await provider.get(ref, ctx)
        } catch (error) {
          if (error instanceof ResourceSourceError && error.code === "not-found") return null
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
  ctx: ResourceSourceAccessContext,
): Promise<ResourceRecord> {
  const provider = providerForScheme(scheme)
  if (!provider.create) {
    throw new ResourceSourceError("unsupported", `Resource source cannot create: ${scheme}`)
  }
  return provider.create(input, ctx)
}

export async function resourceActions(
  ref: ResourceRef,
  ctx: ResourceSourceAccessContext,
): Promise<ResourceAction[]> {
  return providerForRef(ref).actions(ref, ctx)
}

export async function invokeResourceAction(
  ref: ResourceRef,
  action: ResourceActionId,
  input: unknown,
  ctx: ResourceSourceAccessContext,
): Promise<unknown> {
  return providerForRef(ref).invoke(ref, action, input, ctx)
}

export function watchResources(
  query: ResourceQuery,
  ctx: ResourceSourceAccessContext,
  notify: () => void,
): WatchHandle | null {
  return providerForScheme(query.scheme).watch?.(query, ctx, notify) ?? null
}

export function clearResourceSourcesForTest(): void {
  providers.clear()
}
