import type { ReactNode } from "react"
import type { EngineDescriptor } from "@protocol/engine"
import type { IdeallFile } from "@protocol/file-system"

export type FileEngineRenderContext = Readonly<{
  file: IdeallFile
  descriptor: EngineDescriptor
}>

/**
 * Display implementation contributed by the workspace composition root or a third-party UI
 * manifest. Engine matching remains pure in @/engines; this callback is the UI-side half of an
 * engine registration.
 */
export type FileEngineRenderer = (context: FileEngineRenderContext) => ReactNode

export class FileEngineRendererRegistryError extends Error {
  constructor(
    readonly code: "duplicate-renderer" | "invalid-renderer",
    message: string,
  ) {
    super(message)
    this.name = "FileEngineRendererRegistryError"
  }
}

export class FileEngineRendererRegistry {
  readonly #renderers = new Map<string, FileEngineRenderer>()
  readonly #listeners = new Set<() => void>()
  #revision = 0

  register(engineId: string, renderer: FileEngineRenderer): () => void {
    if (!engineId.trim() || engineId !== engineId.trim() || typeof renderer !== "function") {
      throw new FileEngineRendererRegistryError(
        "invalid-renderer",
        "Renderer engineId must be non-empty and have no surrounding whitespace",
      )
    }
    if (this.#renderers.has(engineId)) {
      throw new FileEngineRendererRegistryError(
        "duplicate-renderer",
        `Renderer already registered: ${engineId}`,
      )
    }

    this.#renderers.set(engineId, renderer)
    this.#notify()

    return () => {
      if (this.#renderers.get(engineId) !== renderer) return
      this.#renderers.delete(engineId)
      this.#notify()
    }
  }

  get(engineId: string): FileEngineRenderer | null {
    return this.#renderers.get(engineId) ?? null
  }

  list(): string[] {
    return [...this.#renderers.keys()].sort()
  }

  revision(): number {
    return this.#revision
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  clear(): void {
    if (this.#renderers.size === 0) return
    this.#renderers.clear()
    this.#notify()
  }

  #notify(): void {
    this.#revision += 1
    for (const listener of this.#listeners) listener()
  }
}

export const fileEngineRendererRegistry = new FileEngineRendererRegistry()

export function registerFileEngineRenderer(
  engineId: string,
  renderer: FileEngineRenderer,
): () => void {
  return fileEngineRendererRegistry.register(engineId, renderer)
}

export function resolveFileEngineRenderer(engineId: string): FileEngineRenderer | null {
  return fileEngineRendererRegistry.get(engineId)
}

export function subscribeFileEngineRenderers(listener: () => void): () => void {
  return fileEngineRendererRegistry.subscribe(listener)
}

export function getFileEngineRendererRevision(): number {
  return fileEngineRendererRegistry.revision()
}

export function clearFileEngineRenderersForTest(): void {
  fileEngineRendererRegistry.clear()
}
