import type { IdeallFile } from "@protocol/file-system"
import type { EngineCandidate, EngineResolution } from "@/engines/registry"
import type { WorkspaceKind } from "./types"

function candidateById(candidates: readonly EngineCandidate[], engineId: string) {
  return candidates.find((candidate) => candidate.descriptor.engineId === engineId)
}

/** 工作区只影响无显式偏好时的默认 Engine；文件身份与候选引擎集合保持不变。 */
export function resolveWorkspaceEngine(
  file: IdeallFile,
  workspace: WorkspaceKind,
  candidates: readonly EngineCandidate[],
  resolved: EngineResolution | null,
): EngineCandidate | null {
  if (!resolved || resolved.source !== "priority") return resolved

  const mediaType = file.mediaType.toLowerCase()
  const currentId = resolved.descriptor.engineId
  const preview = candidateById(candidates, "ideall.preview")
  const audioContent = mediaType.startsWith("audio/")
  const generic = currentId === "ideall.code" || (currentId === "ideall.audio" && audioContent)

  if (workspace === "audio" && audioContent) {
    return candidateById(candidates, "ideall.audio") ?? resolved
  }
  if (workspace === "development" && (generic || currentId === "ideall.preview")) {
    return candidateById(candidates, "ideall.code") ?? preview ?? resolved
  }
  if (workspace !== "development" && generic) return preview ?? resolved
  return resolved
}
