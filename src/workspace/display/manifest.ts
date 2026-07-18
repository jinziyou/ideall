import { displayEnginesFileSystemContribution } from "./display-engines-file-system"
import { engineDescriptorsFileSystemContribution } from "./engine-descriptors-file-system"

/**
 * `ideall.display`：Engine 关联（app.display/engines.json）与 Engine 描述符（app.engines）
 * 两个投影必须作为同一运行时扩展原子挂载（docs/freedesktop-alignment.md §4/§5）。
 */
export const displayManifest = {
  id: "display" as const,
  runtimeExtensionFactory: {
    id: "ideall.display",
    label: "ideall 显示",
    version: 1,
    source: { kind: "builtin" as const, id: "ideall" },
    digest: "builtin/ideall.display/v1",
    permissionDigest: "builtin/ideall.display/permissions/v1",
    permissions: ["fs:read"] as const,
    create() {
      return {
        id: "ideall.display",
        label: "ideall 显示",
        fileSystems: [
          displayEnginesFileSystemContribution,
          engineDescriptorsFileSystemContribution,
        ],
      }
    },
  },
}
