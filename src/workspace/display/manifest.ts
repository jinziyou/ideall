import { displayEnginesFileSystemContribution } from "./display-engines-file-system"

/**
 * `ideall.display`：Engine 关联（app.display/engines.json）投影（docs/freedesktop-alignment.md §4）。
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
        fileSystems: [displayEnginesFileSystemContribution],
      }
    },
  },
}
