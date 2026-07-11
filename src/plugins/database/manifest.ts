import * as React from "react"
import type { IdeallFile } from "@protocol/file-system"
import { BUILTIN_ENGINES, engineRegistry } from "@/engines/builtin"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import { mountFileSystem } from "@/filesystem/composite-root"
import { fileSystemRegistry } from "@/filesystem/registry"
import { registerDatabaseFileSystem } from "./database-file-system"
import {
  DATABASE_DATA_SPEC,
  DATABASE_DB_NAME,
  DATABASE_DB_VERSION,
  exportDatabaseJson,
  importDatabaseJson,
  inspectDatabaseData,
} from "./database-store"
import type { PluginDataPort } from "@/plugins/shared/plugin-data"
import type { LocalDataSchema } from "@/plugins/shared/local-data-schema"

const DatabasePage = React.lazy(() => import("./database-page")) as React.LazyExoticComponent<
  React.ComponentType<{ initialTableId?: string }>
>

const databaseDataPort: PluginDataPort = {
  ...DATABASE_DATA_SPEC,
  filenamePrefix: "ideall-database",
  importMode: "replace",
  importDescription: "导入会替换当前数据库插件的表和行。",
  exportJson: exportDatabaseJson,
  importJson: importDatabaseJson,
  inspect: async () => {
    const info = await inspectDatabaseData()
    return {
      pluginId: DATABASE_DATA_SPEC.pluginId,
      label: DATABASE_DATA_SPEC.pluginLabel,
      dataKind: DATABASE_DATA_SPEC.dataKind,
      dataVersion: DATABASE_DATA_SPEC.dataVersion,
      status: info.tables > 0 ? "ready" : "empty",
      itemCount: info.tables + info.rows,
      bytes: info.bytes,
      updatedAt: info.updatedAt,
      detail: `${info.tables} 张表 / ${info.rows} 行`,
    }
  },
}

const databaseLocalDataSchemas: readonly LocalDataSchema[] = [
  {
    id: "database.db",
    label: "数据库工作台",
    owner: "database",
    storage: "indexedDB",
    key: DATABASE_DB_NAME,
    currentVersion: DATABASE_DB_VERSION,
    portable: true,
  },
]

export const databaseManifest = {
  id: "database" as const,
  engines: ["ideall.database"] as const,
  dataPorts: [databaseDataPort] as const,
  localDataSchemas: databaseLocalDataSchemas,
  renderEngine({ file }: { file: IdeallFile }) {
    const initialTableId =
      typeof file.properties?.tableId === "string" ? file.properties.tableId : undefined
    return React.createElement(DatabasePage, { initialTableId })
  },
  register() {
    const disposers: Array<() => void> = []
    const descriptor = BUILTIN_ENGINES.find((engine) => engine.engineId === "ideall.database")
    if (descriptor && !engineRegistry.get(descriptor.engineId)) {
      disposers.push(engineRegistry.register(descriptor))
    }
    disposers.push(
      registerDatabaseFileSystem((provider) =>
        mountFileSystem(fileSystemRegistry, ideallRootFileSystem, provider, {
          entryId: "app.database",
          name: "数据库",
          properties: { workspaceModes: ["local"], navigationHidden: true },
        }),
      ),
    )
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  },
}
