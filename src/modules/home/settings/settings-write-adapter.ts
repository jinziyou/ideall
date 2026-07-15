import type { FileRef } from "@protocol/file-system"
import { invokeFileAction, writeFile } from "@/filesystem/registry"
import type { FileWriteInput } from "@/filesystem/types"
import { withFileWriteLock } from "@/filesystem/write-lock"
import {
  SETTINGS_CONNECTION_REVOKE_ACTION,
  SETTINGS_SECTION_MEDIA_TYPE,
  decodeSettingsMutationResult,
  settingsSectionFileRef,
  type SettingsSectionId,
  type SettingsThemeChoice,
} from "./settings-contract"

type MaybePromise<T> = T | Promise<T>
type FileWriteLock = <T>(ref: FileRef, operation: () => MaybePromise<T>) => Promise<T>

export type SettingsMutationClient = Readonly<{
  write(ref: FileRef, input: FileWriteInput): Promise<unknown>
  invoke(ref: FileRef, action: string, input: unknown): Promise<unknown>
}>

const registrySettingsMutationClient: SettingsMutationClient = {
  write(ref, input) {
    return writeFile(ref, input, { actor: "ui", permissions: [], intent: "write" })
  },
  invoke(ref, action, input) {
    return invokeFileAction(ref, action, input, {
      actor: "ui",
      permissions: [],
      intent: "action",
    })
  },
}

/** Settings provider 与绕过 provider 的兼容入口共享的 section FileRef mutation 屏障。 */
export function withSettingsSectionMutationLock<T>(
  section: SettingsSectionId,
  operation: () => MaybePromise<T>,
  lock: FileWriteLock = withFileWriteLock,
): Promise<T> {
  return lock(settingsSectionFileRef(section), operation)
}

/** shell 主题入口；只经 FileSystem registry 写合成文件，不直接依赖主题存储。 */
export async function setSettingsThemeChoice(
  choice: SettingsThemeChoice,
  client: SettingsMutationClient = registrySettingsMutationClient,
): Promise<void> {
  await client.write(settingsSectionFileRef("appearance"), {
    data: { choice },
    mediaType: SETTINGS_SECTION_MEDIA_TYPE,
  })
}

/**
 * 旧 Connected Apps 面板的撤销入口；结果保留 provider 的幂等 changed 语义。
 *
 * 这里仅通过 FileSystem registry 进入 provider。连接 register/deregister 仍是运行期生命周期
 * 事件，不获取 Settings 写锁；provider 在 section 锁内重读连接并调用 raw revoke，以排序所有
 * 用户 mutation，同时不把连接生命周期误装成持久化事务。
 */
export async function revokeSettingsConnection(
  id: string,
  client: SettingsMutationClient = registrySettingsMutationClient,
): Promise<boolean> {
  const result = await client.invoke(
    settingsSectionFileRef("connections"),
    SETTINGS_CONNECTION_REVOKE_ACTION,
    { id },
  )
  return decodeSettingsMutationResult(result).changed
}
