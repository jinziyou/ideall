import { CompositeRootFileSystem } from "./composite-root"
import { getFileSystem, registerFileSystem } from "./registry"
import {
  CORE_PLACE_IDS,
  corePlaceRef,
  resourceFileSystem,
  type CorePlaceId,
} from "./resource-file-system"
import { remoteServerFileSystem } from "./remote-server-file-system"
import { trashFileSystem } from "./trash-file-system"

export const IDEALL_ROOT_FILE_SYSTEM_ID = "ideall.root"

const PLACE_LABELS: Record<CorePlaceId, string> = {
  home: "Home",
  subscriptions: "关注",
  bookmarks: "书签",
  files: "文件",
  notes: "笔记",
  workspace: "工作区",
  apps: "应用",
  info: "资讯",
  community: "社区",
  tool: "工具",
  browser: "浏览器",
  system: "系统",
}

export const ideallRootFileSystem = new CompositeRootFileSystem({
  fileSystemId: IDEALL_ROOT_FILE_SYSTEM_ID,
  name: "ideall",
  coreEntries: CORE_PLACE_IDS.map((place, index) => ({
    entryId: place,
    name: PLACE_LABELS[place],
    target: corePlaceRef(place),
    sortKey: String(index).padStart(3, "0"),
    properties: { place, navigationHidden: place === "workspace" },
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
