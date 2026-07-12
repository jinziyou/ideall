import { CompositeRootFileSystem } from "./composite-root"
import { getFileSystem, registerFileSystem } from "./registry"
import { corePlaceRef, resourceFileSystem, type CorePlaceId } from "./resource-file-system"
import { remoteServerFileSystem } from "./remote-server-file-system"
import { trashFileSystem } from "./trash-file-system"

export const IDEALL_ROOT_FILE_SYSTEM_ID = "ideall.root"

const NAVIGATION_ROOTS = [
  { id: "home", name: "我的", target: "home" },
  { id: "activity", name: "活动", target: "workspace" },
  { id: "browse", name: "浏览", target: "info" },
  { id: "apps", name: "应用", target: "apps" },
  { id: "settings", name: "设置", target: "system" },
] as const satisfies readonly { id: string; name: string; target: CorePlaceId }[]

export const ideallRootFileSystem = new CompositeRootFileSystem({
  fileSystemId: IDEALL_ROOT_FILE_SYSTEM_ID,
  name: "ideall",
  coreEntries: NAVIGATION_ROOTS.map((root, index) => ({
    entryId: root.id,
    name: root.name,
    target: corePlaceRef(root.target),
    sortKey: String(index).padStart(3, "0"),
    properties: { navigationSection: root.id },
  })),
})

export function registerBuiltInFileSystems(): () => void {
  const disposers: Array<() => void> = []
  if (!getFileSystem(resourceFileSystem.descriptor.fileSystemId)) {
    disposers.push(registerFileSystem(resourceFileSystem))
  }
  if (!getFileSystem(ideallRootFileSystem.descriptor.fileSystemId)) {
    disposers.push(registerFileSystem(ideallRootFileSystem))
  }
  if (!getFileSystem(remoteServerFileSystem.descriptor.fileSystemId)) {
    disposers.push(registerFileSystem(remoteServerFileSystem))
  }
  if (!getFileSystem(trashFileSystem.descriptor.fileSystemId)) {
    disposers.push(registerFileSystem(trashFileSystem))
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
