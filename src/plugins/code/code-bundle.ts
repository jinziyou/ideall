import type { PluginDataInspection } from "@/plugins/shared/plugin-data-registry"
import type { LocalDataSchemaInspection } from "@/plugins/shared/local-data-schema"
import type { CodeSnapshot } from "./code-snapshot"
import type { SecurityDiagnostics } from "./security-diagnostics"

export function createCodeBundle(
  snapshot: CodeSnapshot,
  pluginData: PluginDataInspection[],
  schemaData: LocalDataSchemaInspection[],
  security?: SecurityDiagnostics | null,
) {
  return {
    kind: "ideall.code-bundle",
    version: 1,
    exportedAt: new Date().toISOString(),
    snapshot,
    pluginData,
    schemaData,
    security,
  }
}
