import { ideallRootFileSystem } from "@/filesystem/builtin"
import { mountFileSystem } from "@/filesystem/composite-root"
import { fileSystemRegistry } from "@/filesystem/registry"
import { registerInstalledAppsFileSystem } from "./installed-app-file-system"

export const appsManifest = {
  id: "apps" as const,
  register() {
    registerInstalledAppsFileSystem((provider) => {
      mountFileSystem(fileSystemRegistry, ideallRootFileSystem, provider, {
        entryId: "third-party.installed-apps",
        name: "本机应用",
        properties: { workspaceModes: ["local"] },
      })
    })
  },
}
