import {
  SETTINGS_READ_PERMISSION,
  SETTINGS_WRITE_PERMISSION,
  settingsFileSystemContribution,
} from "./settings-file-system"
import { settingsEngineContribution } from "./settings-engines"

/** 基本设置的合成文件系统与专用 Display 必须作为同一运行时扩展原子挂载。 */
export const settingsManifest = {
  id: "settings" as const,
  runtimeExtensionFactory: {
    id: "ideall.settings",
    label: "ideall 设置",
    version: 1,
    source: { kind: "builtin" as const, id: "ideall" },
    digest: "builtin/ideall.settings/v1",
    permissionDigest: "builtin/ideall.settings/permissions/v1",
    permissions: ["fs:read", SETTINGS_READ_PERMISSION, SETTINGS_WRITE_PERMISSION] as const,
    create() {
      return {
        id: "ideall.settings",
        label: "ideall 设置",
        fileSystems: [settingsFileSystemContribution],
        engines: [settingsEngineContribution],
      }
    },
  },
}
