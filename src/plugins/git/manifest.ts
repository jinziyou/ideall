import * as React from "react"
import type { IdeallFile } from "@protocol/file-system"
import { BUILTIN_ENGINES, engineRegistry } from "@/engines/builtin"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import { mountFileSystem } from "@/filesystem/composite-root"
import { fileSystemRegistry } from "@/filesystem/registry"
import { registerGitFileSystem } from "./git-file-system"

const GitPage = React.lazy(() => import("./git-page")) as React.LazyExoticComponent<
  React.ComponentType<{ initialRepoPath?: string }>
>

export const gitManifest = {
  id: "git" as const,
  engines: ["ideall.git"] as const,
  renderEngine({ file }: { file: IdeallFile }) {
    const initialRepoPath =
      typeof file.properties?.path === "string" ? file.properties.path : undefined
    return React.createElement(GitPage, { initialRepoPath })
  },
  register() {
    const descriptor = BUILTIN_ENGINES.find((engine) => engine.engineId === "ideall.git")
    if (descriptor && !engineRegistry.get(descriptor.engineId)) engineRegistry.register(descriptor)
    registerGitFileSystem((provider) => {
      mountFileSystem(fileSystemRegistry, ideallRootFileSystem, provider, {
        entryId: "app.git-repositories",
        name: "Git 仓库",
        properties: { workspaceModes: ["local"] },
      })
    })
  },
}
