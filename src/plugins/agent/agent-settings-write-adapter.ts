import { fileRefKey, type FileRef } from "@protocol/file-system"
import {
  AGENT_CONFIG_FILE_SYSTEM_ID,
  AGENT_SETTINGS_FILE_REF,
} from "@/filesystem/builtin-app-roots"
import { withFileWriteLock } from "@/filesystem/write-lock"
import { createPluginMutationInvalidationChannel } from "@/plugins/shared/plugin-mutation-channel"
import { AGENT_PUBLIC_CONFIG_SECTIONS, importAgentConfigJson } from "./lib/agent-data-port"
import { persistAgentSettings, type AgentSettings } from "./lib/agent-settings"

type AgentSettingsPersistence = (settings: AgentSettings) => Promise<void>
type AgentConfigImporter = (raw: string) => Promise<{ keys: number }>
type FileWriteLock = <T>(ref: FileRef, operation: () => T | Promise<T>) => Promise<T>

const agentImportInvalidations = createPluginMutationInvalidationChannel(
  AGENT_CONFIG_FILE_SYSTEM_ID,
)

export const subscribeAgentImportInvalidation = agentImportInvalidations.subscribe

const AGENT_CONFIG_SECTION_FILE_REFS: readonly FileRef[] = Object.freeze(
  [...AGENT_PUBLIC_CONFIG_SECTIONS]
    .map(({ id }): FileRef =>
      Object.freeze({
        fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID,
        fileId: `config:${id}`,
      }),
    )
    .filter(
      (ref, index, refs) =>
        refs.findIndex((candidate) => fileRefKey(candidate) === fileRefKey(ref)) === index,
    )
    .sort((left, right) => {
      const leftKey = fileRefKey(left)
      const rightKey = fileRefKey(right)
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    }),
)

/** Agent settings 的跨入口写屏障；所有绕过 FileSystem provider 的写入也必须经过同一 FileRef。 */
export function withAgentSettingsFileWriteLock<T>(operation: () => T | Promise<T>): Promise<T> {
  return withFileWriteLock(AGENT_SETTINGS_FILE_REF, operation)
}

/** 旧复合设置 UI 的兼容写入口；依赖参数仅用于验证跨 adapter/provider 的锁串行化。 */
export function persistAgentSettingsWithFileLock(
  settings: AgentSettings,
  persist: AgentSettingsPersistence = persistAgentSettings,
): Promise<void> {
  return withAgentSettingsFileWriteLock(() => persist(settings))
}

/**
 * Agent 整包事务按稳定 FileRef 顺序获取全部公开 section 锁；嵌套 finally 会在 importer
 * 完成后逆序释放。importer 必须保持为不重入 FileSystem provider 的 store 级原语。
 */
export function withAgentConfigSectionWriteLocks<T>(
  operation: () => T | Promise<T>,
  lock: FileWriteLock = withFileWriteLock,
): Promise<T> {
  async function acquire(index: number): Promise<T> {
    const ref = AGENT_CONFIG_SECTION_FILE_REFS[index]
    return ref ? lock(ref, () => acquire(index + 1)) : operation()
  }
  return acquire(0)
}

export async function importAgentConfigJsonWithFileLocks(
  raw: string,
  importConfig: AgentConfigImporter = importAgentConfigJson,
): Promise<{ keys: number }> {
  const result = await withAgentConfigSectionWriteLocks(() => importConfig(raw))
  agentImportInvalidations.publish()
  return result
}
