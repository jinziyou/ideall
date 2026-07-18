import type { FileRef } from "@protocol/file-system"
import { invokeFileAction } from "@/filesystem/registry"
import { DISPLAY_ENGINES_FILE_REF } from "@/filesystem/builtin-app-roots"
import type { EnginePreferenceScope } from "@/engines/preferences"
import {
  DISPLAY_ENGINES_REMOVE_ASSOCIATION_ACTION,
  DISPLAY_ENGINES_RESTORE_ASSOCIATION_ACTION,
  DISPLAY_ENGINES_SET_FILE_DEFAULT_ACTION,
  DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION,
  encodeFileDefaultInput,
} from "./display-engines-file-contract"

/**
 * EnginePicker 等 UI 写入口（docs/freedesktop-alignment.md §4.2）：一律经 FileSystem
 * registry 回到 provider，与 engines.json 的 CAS 写共用同一把 FileRef 锁——
 * 不允许绕过 provider 直写 localStorage，否则跨窗口会与文件写互相覆盖。
 */

export type DisplayEnginesMutationClient = Readonly<{
  invoke(action: string, input: unknown): Promise<unknown>
}>

const registryDisplayEnginesClient: DisplayEnginesMutationClient = {
  invoke(action, input) {
    return invokeFileAction(DISPLAY_ENGINES_FILE_REF, action, input, {
      actor: "ui",
      permissions: [],
      intent: "action",
    })
  },
}

export type DisplayEnginesMutationResult = Readonly<{
  changed: boolean
  version: string
}>

function decodeMutationResult(value: unknown): DisplayEnginesMutationResult {
  const record = (value ?? {}) as { changed?: unknown; version?: unknown }
  return {
    changed: record.changed === true,
    version: typeof record.version === "string" ? record.version : "",
  }
}

/** 设为某文件在当前工作区的默认引擎（engineId 为 null 时清除单文件偏好）。 */
export async function setFileEngineDefault(
  scope: EnginePreferenceScope,
  ref: FileRef,
  engineId: string | null,
  client: DisplayEnginesMutationClient = registryDisplayEnginesClient,
): Promise<DisplayEnginesMutationResult> {
  const result = await client.invoke(
    DISPLAY_ENGINES_SET_FILE_DEFAULT_ACTION,
    encodeFileDefaultInput(scope, ref, engineId),
  )
  return decodeMutationResult(result)
}

/** 设为某 media type 在当前工作区的默认引擎；自动解除同类型同引擎的屏蔽。 */
export async function setMediaTypeEngineDefault(
  scope: EnginePreferenceScope,
  mediaType: string,
  engineId: string | null,
  client: DisplayEnginesMutationClient = registryDisplayEnginesClient,
): Promise<DisplayEnginesMutationResult> {
  const result = await client.invoke(DISPLAY_ENGINES_SET_MEDIA_TYPE_DEFAULT_ACTION, {
    scope,
    mediaType,
    engineId,
  })
  return decodeMutationResult(result)
}

/** Removed Associations：不再用此引擎打开该类型（沿父链生效，解析侧有兜底守卫）。 */
export async function removeEngineAssociation(
  scope: EnginePreferenceScope,
  mediaType: string,
  engineId: string,
  client: DisplayEnginesMutationClient = registryDisplayEnginesClient,
): Promise<DisplayEnginesMutationResult> {
  const result = await client.invoke(DISPLAY_ENGINES_REMOVE_ASSOCIATION_ACTION, {
    scope,
    mediaType,
    engineId,
  })
  return decodeMutationResult(result)
}

/** 解除精确类型级别的屏蔽（继承自父类型的屏蔽需在父类型上解除或编辑 engines.json）。 */
export async function restoreEngineAssociation(
  scope: EnginePreferenceScope,
  mediaType: string,
  engineId: string,
  client: DisplayEnginesMutationClient = registryDisplayEnginesClient,
): Promise<DisplayEnginesMutationResult> {
  const result = await client.invoke(DISPLAY_ENGINES_RESTORE_ASSOCIATION_ACTION, {
    scope,
    mediaType,
    engineId,
  })
  return decodeMutationResult(result)
}
