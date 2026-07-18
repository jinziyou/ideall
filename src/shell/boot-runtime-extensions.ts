import type { RuntimeExtensionCatalog, RuntimeExtensionFactory } from "./runtime-extensions"
import { appsManifest } from "@/modules/apps/manifest"
import { settingsManifest } from "@/modules/home/settings/manifest"
import { agentManifest } from "@/plugins/agent/manifest"
import { displayManifest } from "@/workspace/display/manifest"

export const bundledRuntimeExtensionFactories = [
  appsManifest.runtimeExtensionFactory,
  settingsManifest.runtimeExtensionFactory,
  agentManifest.runtimeExtensionFactory,
  displayManifest.runtimeExtensionFactory,
] as const satisfies readonly RuntimeExtensionFactory[]

type BundledRuntimeExtensionCatalog = Pick<
  RuntimeExtensionCatalog,
  "discoverBuiltin" | "tryActivate"
>

export type BundledRuntimeExtensionActivation = Readonly<{
  id: string
  active: boolean
}>

function removeDiscoveredFactories(disposers: Array<() => Promise<void>>): void {
  for (const dispose of disposers.reverse()) {
    // discover disposer 会在首个 await 前撤掉 Catalog 可见项；后续异步 teardown 的失败
    // 已由 Catalog/Registry 记录，不能让组合根回滚产生未处理 rejection。
    try {
      void dispose().catch(() => {})
    } catch {
      // 兼容测试替身或未来同步 disposer；组合根仍继续逆序撤销其余 factory。
    }
  }
}

/**
 * 同批发现随包 factory。中途校验/重复 id 失败时，已经可见的条目会立即逆序撤销，
 * 避免 registerAll 回到 idle 后 Catalog 留下半套随包能力。
 */
export function discoverBundledRuntimeExtensions(
  catalog: BundledRuntimeExtensionCatalog,
  factories: readonly RuntimeExtensionFactory[] = bundledRuntimeExtensionFactories,
): () => void {
  const disposers: Array<() => Promise<void>> = []
  try {
    for (const factory of factories) disposers.push(catalog.discoverBuiltin(factory))
  } catch (error) {
    removeDiscoveredFactories(disposers)
    throw error
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    removeDiscoveredFactories(disposers)
  }
}

/**
 * 每个随包扩展独立激活；一个 factory 的 create/activate/install 失败不会阻断其余项。
 * 结果保留给 boot 级回归测试与后续诊断，具体失败仍以 Catalog 状态为准。
 */
export async function activateBundledRuntimeExtensions(
  catalog: BundledRuntimeExtensionCatalog,
  factories: readonly RuntimeExtensionFactory[] = bundledRuntimeExtensionFactories,
): Promise<readonly BundledRuntimeExtensionActivation[]> {
  return Promise.all(
    factories.map(async (factory) => {
      try {
        return { id: factory.id, active: await catalog.tryActivate(factory.id) }
      } catch {
        return { id: factory.id, active: false }
      }
    }),
  )
}
