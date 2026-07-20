import {
  pluginDataErrorInspection,
  type PluginDataInspection,
  type PluginDataPort,
} from "./plugin-data"

export type { PluginDataInspection } from "./plugin-data"

const ports = new Map<string, PluginDataPort>()

function assertPluginDataPort(port: PluginDataPort): void {
  if (
    !port.pluginId.trim() ||
    !port.pluginLabel.trim() ||
    !port.dataKind.trim() ||
    !Number.isSafeInteger(port.dataVersion) ||
    port.dataVersion < 1 ||
    !port.filenamePrefix.trim() ||
    typeof port.exportJson !== "function" ||
    typeof port.importJson !== "function" ||
    typeof port.inspect !== "function"
  ) {
    throw new TypeError(`Invalid plugin data port: ${port.pluginId || "<empty>"}`)
  }
}

/** 注册插件自有的数据导入/导出端口；共享层不依赖任何具体插件。 */
export function registerPluginDataPort(port: PluginDataPort): () => void {
  assertPluginDataPort(port)
  const existing = ports.get(port.pluginId)
  if (existing === port) return () => {}
  if (existing) throw new Error(`Plugin data port already registered: ${port.pluginId}`)
  ports.set(port.pluginId, port)

  return () => {
    if (ports.get(port.pluginId) === port) ports.delete(port.pluginId)
  }
}

/** 批量注册保持原子性：任一重复或非法端口会回滚本批此前的注册。 */
export function registerPluginDataPorts(next: readonly PluginDataPort[]): () => void {
  const disposers: Array<() => void> = []
  try {
    for (const port of next) disposers.push(registerPluginDataPort(port))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

export function listPluginDataPorts(): PluginDataPort[] {
  return [...ports.values()]
}

export function pluginDataPortById(id: string): PluginDataPort | undefined {
  return ports.get(id)
}

export async function inspectPluginDataPorts(): Promise<PluginDataInspection[]> {
  return Promise.all(
    listPluginDataPorts().map(async (port) => {
      try {
        return await port.inspect()
      } catch (error) {
        return pluginDataErrorInspection(port, error)
      }
    }),
  )
}
