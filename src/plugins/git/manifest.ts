import * as React from "react"
import type { IdeallFile } from "@protocol/file-system"
import { BUILTIN_ENGINES, engineRegistry } from "@/engines/builtin"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import { mountFileSystem } from "@/filesystem/composite-root"
import { fileSystemRegistry } from "@/filesystem/registry"
import { registerGitFileSystem } from "./git-file-system"
import {
  GIT_DATA_SPEC,
  GIT_REPOS_STORAGE_KEY,
  exportGitReposJson,
  inspectGitReposData,
} from "./git-repos-store"
import { importGitReposJsonWithWriteLocks } from "./git-write-adapter"
import type { PluginDataPort } from "@/plugins/shared/plugin-data"
import {
  jsonArrayIssues,
  repairJsonArray,
  type LocalDataSchema,
} from "@/plugins/shared/local-data-schema"

const GitPage = React.lazy(() => import("./git-page")) as React.LazyExoticComponent<
  React.ComponentType<{ initialRepoPath?: string }>
>

const gitDataPort: PluginDataPort = {
  ...GIT_DATA_SPEC,
  filenamePrefix: "ideall-git",
  importMode: "replace",
  importDescription: "导入会替换 Git 插件保存的仓库路径列表。",
  exportJson: exportGitReposJson,
  importJson: importGitReposJsonWithWriteLocks,
  inspect: async () => {
    const info = await inspectGitReposData()
    return {
      pluginId: GIT_DATA_SPEC.pluginId,
      label: GIT_DATA_SPEC.pluginLabel,
      dataKind: GIT_DATA_SPEC.dataKind,
      dataVersion: GIT_DATA_SPEC.dataVersion,
      status: info.repos > 0 ? "ready" : "empty",
      itemCount: info.repos,
      bytes: info.bytes,
      updatedAt: info.updatedAt,
      detail: `${info.repos} 个仓库`,
    }
  },
}

const gitLocalDataSchemas: readonly LocalDataSchema[] = [
  {
    id: "git.repos",
    label: "Git 仓库列表",
    owner: "git",
    storage: "localStorage",
    key: GIT_REPOS_STORAGE_KEY,
    currentVersion: 1,
    portable: true,
    parseAs: "json",
    validate: jsonArrayIssues,
    repair: repairJsonArray,
  },
]

export const gitManifest = {
  id: "git" as const,
  engines: ["ideall.git"] as const,
  dataPorts: [gitDataPort] as const,
  localDataSchemas: gitLocalDataSchemas,
  renderEngine({ file }: { file: IdeallFile }) {
    const initialRepoPath =
      typeof file.properties?.path === "string" ? file.properties.path : undefined
    return React.createElement(GitPage, { initialRepoPath })
  },
  register() {
    const disposers: Array<() => void> = []
    const descriptor = BUILTIN_ENGINES.find((engine) => engine.engineId === "ideall.git")
    if (descriptor && !engineRegistry.get(descriptor.engineId)) {
      disposers.push(engineRegistry.register(descriptor))
    }
    disposers.push(
      registerGitFileSystem((provider) =>
        mountFileSystem(fileSystemRegistry, ideallRootFileSystem, provider, {
          entryId: "app.git-repositories",
          name: "Git 仓库",
          properties: { navigationHidden: true },
        }),
      ),
    )
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  },
}
