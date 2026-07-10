import { BUILTIN_ENGINES, engineRegistry } from "@/engines/builtin"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import { mountFileSystem } from "@/filesystem/composite-root"
import { fileSystemRegistry } from "@/filesystem/registry"
import { registerGitFileSystem } from "./git-file-system"

export const gitManifest = {
  id: "git" as const,
  engines: ["ideall.git"] as const,
  register() {
    const descriptor = BUILTIN_ENGINES.find((engine) => engine.engineId === "ideall.git")
    if (descriptor && !engineRegistry.get(descriptor.engineId)) engineRegistry.register(descriptor)
    registerGitFileSystem((provider) => {
      mountFileSystem(fileSystemRegistry, ideallRootFileSystem, provider, {
        entryId: "app.git-repositories",
        name: "Git 仓库",
      })
    })
  },
}
