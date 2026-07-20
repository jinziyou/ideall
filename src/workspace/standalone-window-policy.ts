import type { EngineDescriptor } from "@protocol/engine"
import type { IdeallFile } from "@protocol/file-system"

export function canOpenStandaloneWindow(
  file: Pick<IdeallFile, "capabilities">,
  engine: Pick<EngineDescriptor, "supportsStandaloneWindow">,
): boolean {
  return file.capabilities.includes("standalone-window") && engine.supportsStandaloneWindow === true
}
