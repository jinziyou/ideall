import { installedAppsFileSystem } from "./installed-app-file-system"

export const appsManifest = {
  id: "apps" as const,
  runtimeExtensionFactory: {
    id: "ideall.installed-apps",
    label: "本机应用连接器",
    version: 1,
    source: { kind: "builtin" as const, id: "ideall" },
    // 内置贡献由发布物本身信任；这两个值是发行身份，不冒充运行时计算的签名/哈希。
    digest: "builtin/ideall.installed-apps/v1",
    permissionDigest: "builtin/ideall.installed-apps/permissions/v1",
    permissions: ["fs:read", "apps:launch"] as const,
    create() {
      return {
        id: "ideall.installed-apps",
        label: "本机应用连接器",
        fileSystems: [
          {
            provider: installedAppsFileSystem,
            mount: {
              entryId: "third-party.installed-apps",
              name: "本机应用",
              properties: { workspaceModes: ["local"] },
            },
          },
        ],
      }
    },
  },
}
