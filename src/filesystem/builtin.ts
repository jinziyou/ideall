import { CompositeRootFileSystem } from "./composite-root"
import {
  NAVIGATION_SECTIONS,
  navigationDirectoryRef,
  navigationFileSystem,
} from "./navigation-file-system"
import { getFileSystem, registerFileSystem } from "./registry"
import { resourceFileSystem } from "./resource-file-system"
import { remoteServerFileSystem } from "./remote-server-file-system"
import { IDEALL_ROOT_REF } from "./root-ref"
import { trashFileSystem } from "./trash-file-system"

export { IDEALL_ROOT_FILE_SYSTEM_ID } from "./root-ref"

export const ideallRootFileSystem = new CompositeRootFileSystem({
  fileSystemId: IDEALL_ROOT_REF.fileSystemId,
  rootFileId: IDEALL_ROOT_REF.fileId,
  name: "ideall",
  coreEntries: NAVIGATION_SECTIONS.map((section, index) => ({
    entryId: section.id,
    pathName: section.pathName,
    name: section.name,
    target: navigationDirectoryRef(section.id),
    sortKey: String(index).padStart(3, "0"),
    properties: { navigationSection: section.id, iconHint: section.iconHint },
  })),
})

export function registerBuiltInFileSystems(): () => void {
  const disposers: Array<() => void> = []
  if (!getFileSystem(resourceFileSystem.descriptor.fileSystemId)) {
    disposers.push(registerFileSystem(resourceFileSystem))
  }
  if (!getFileSystem(navigationFileSystem.descriptor.fileSystemId)) {
    disposers.push(registerFileSystem(navigationFileSystem))
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
