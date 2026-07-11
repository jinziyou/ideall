import { BUILTIN_ENGINES, engineRegistry } from "@/engines/builtin"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import { mountFileSystem } from "@/filesystem/composite-root"
import { fileSystemRegistry } from "@/filesystem/registry"
import { registerDatabaseFileSystem } from "./database-file-system"

export const databaseManifest = {
  id: "database" as const,
  engines: ["ideall.database"] as const,
  register() {
    const descriptor = BUILTIN_ENGINES.find((engine) => engine.engineId === "ideall.database")
    if (descriptor && !engineRegistry.get(descriptor.engineId)) engineRegistry.register(descriptor)
    registerDatabaseFileSystem((provider) => {
      mountFileSystem(fileSystemRegistry, ideallRootFileSystem, provider, {
        entryId: "app.database",
        name: "数据库",
        properties: { workspaceModes: ["local"] },
      })
    })
  },
}
