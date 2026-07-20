import type { EngineDescriptor } from "@protocol/engine"
import { engineRegistry } from "@/engines/builtin"
import { EngineRegistry } from "@/engines/registry"
import {
  fileEngineRendererRegistry,
  FileEngineRendererRegistry,
  type FileEngineRenderer,
} from "./file-engine-renderer"

/** A complete runtime contribution: matching metadata and its Display implementation. */
export type FileEngineContribution = Readonly<{
  descriptor: EngineDescriptor
  renderer: FileEngineRenderer
}>

export type FileEngineRegistrationTargets = Readonly<{
  engines: EngineRegistry
  renderers: FileEngineRendererRegistry
}>

export class FileEngineRegistrationError extends Error {
  constructor(
    readonly code: "duplicate-contribution",
    message: string,
  ) {
    super(message)
    this.name = "FileEngineRegistrationError"
  }
}

const defaultTargets: FileEngineRegistrationTargets = {
  engines: engineRegistry,
  renderers: fileEngineRendererRegistry,
}

function validateContribution({ descriptor, renderer }: FileEngineContribution): void {
  // Reuse the registries' canonical validation without exposing mutable internals.
  new EngineRegistry().register(descriptor)
  new FileEngineRendererRegistry().register(descriptor.engineId, renderer)
}

/**
 * Atomically registers an Engine descriptor and renderer for runtime extension manifests.
 *
 * Preflight rejects an existing half-registration without altering it. Mutations and rollback run
 * inside both notification batches, so subscribers can only observe both halves present or absent.
 * The returned disposer is exact and idempotent.
 */
export function registerFileEngineContribution(
  contribution: FileEngineContribution,
  targets: FileEngineRegistrationTargets = defaultTargets,
): () => void {
  validateContribution(contribution)
  const { descriptor, renderer } = contribution
  const engineId = descriptor.engineId
  if (targets.engines.get(engineId) || targets.renderers.get(engineId)) {
    throw new FileEngineRegistrationError(
      "duplicate-contribution",
      `File engine contribution already registered: ${engineId}`,
    )
  }

  let unregisterEngine: (() => void) | undefined
  let unregisterRenderer: (() => void) | undefined
  try {
    targets.engines.batch(() =>
      targets.renderers.batch(() => {
        try {
          unregisterEngine = targets.engines.register(descriptor)
          unregisterRenderer = targets.renderers.register(engineId, renderer)
        } catch (reason) {
          // Roll back before either notification batch commits, preventing an observable half.
          unregisterRenderer?.()
          unregisterEngine?.()
          throw reason
        }
      }),
    )
  } catch (reason) {
    targets.engines.batch(() =>
      targets.renderers.batch(() => {
        unregisterRenderer?.()
        unregisterEngine?.()
      }),
    )
    throw reason
  }

  let active = true
  return () => {
    if (!active) return
    active = false
    targets.engines.batch(() =>
      targets.renderers.batch(() => {
        unregisterRenderer?.()
        unregisterEngine?.()
      }),
    )
  }
}
