// 组合根 (composition root) —— 唯一允许 import 各 app/plugin manifest 的地方。
// 客户端启动时注册进 protocol registry: (1) core 自身实现的 FilesPort; (2) 各 app/plugin
// manifest 贡献的能力 (info/community 的内容解析器、sync 插件的 SyncPort)。
// 使终端外壳 (core) 永不直接依赖具体 app/plugin。
import { registerContentResolver } from "@protocol/content"
import { registerFilesPort } from "@protocol/files"
import { registerStorageSyncPort } from "@protocol/storage-sync"
import { registerUiActions } from "@/lib/ui-actions"
import { registerActiveNode } from "@/lib/active-node"
import { registerBuiltInResourceSources } from "@/filesystem/resource-sources/builtin"
import { registerBuiltInFileSystems } from "@/filesystem/builtin"
import { registerBuiltInEngines } from "@/engines/builtin"
import { registerBuiltInFileEngineRenderers } from "@/workspace/registry"
import { isTauri } from "@/lib/tauri"
import { filesPort } from "@/files/files-runtime-port"
import { storageSyncPort } from "@/files/storage-sync-port"
import {
  openTarget,
  closeFileTabs,
  closeNodeTabs,
  getActiveId,
  getActiveSource,
  getTabs,
  openAiSettings,
  openAiSection,
  openAiTasks,
} from "@/workspace/store"
import { nodeResourceRefForTab } from "@/workspace/resource-tab"
import { fileEngineTargetForTab } from "@/workspace/file-tab"
import {
  aiTasksPanelFileRef,
  resourceFileRef,
  resourceRefForFile,
} from "@/filesystem/resource-file-system"
import { openInBrowserTab } from "@/workspace/browser-open"
import { infoManifest } from "@/modules/info/manifest"
import { communityManifest } from "@/modules/community/manifest"
import { syncManifest } from "@/plugins/sync/manifest"
import { shellManifest } from "@/plugins/shell/manifest"
import { gitManifest } from "@/plugins/git/manifest"
import { databaseManifest } from "@/plugins/database/manifest"
import { audioManifest } from "@/plugins/audio/manifest"
import { codeManifest } from "@/plugins/code/manifest"
import { agentManifest } from "@/plugins/agent/manifest"
import { runtimeExtensionCatalog } from "./runtime-extensions"
import { registerPluginDataPorts } from "@/plugins/shared/plugin-data-registry"
import { registerLocalDataSchemas } from "@/plugins/shared/local-data-schema"
import { runRegistrationTransaction } from "./boot-transaction"
import {
  activateBundledRuntimeExtensions,
  discoverBundledRuntimeExtensions,
} from "./boot-runtime-extensions"

let bootState: "idle" | "registering" | "ready" = "idle"

/** 幂等: 注册所有 app/plugin 能力。客户端启动前置步骤 (BootGate) 调一次。 */
export function registerAll(): void {
  if (bootState === "ready") return
  if (bootState === "registering") throw new Error("Composition root registration is re-entrant")
  bootState = "registering"

  try {
    runRegistrationTransaction([
      () => registerFilesPort(filesPort),
      () => registerStorageSyncPort(storageSyncPort),
      // 旧 Resource source 仍只是存储适配器；FileSystem/Engine/Display 是运行时入口。
      () => registerBuiltInResourceSources(),
      () => registerBuiltInFileSystems(),
      () => registerBuiltInEngines(),
      () => registerBuiltInFileEngineRenderers(),
      // 插件自有诊断/备份契约由 manifest 贡献；shared 不反向依赖具体插件。
      () =>
        runRegistrationTransaction(
          [audioManifest, databaseManifest, gitManifest, agentManifest, syncManifest].flatMap(
            (manifest) => [
              () => registerPluginDataPorts(manifest.dataPorts),
              () => registerLocalDataSchemas(manifest.localDataSchemas),
            ],
          ),
        ),
      // UI 端口保留 active-node 的用户来源隐私守卫。
      () =>
        registerUiActions({
          openTab: (kind, id, title) =>
            openTarget(
              { type: "file", ref: resourceFileRef({ scheme: "node", kind, id }), title },
              "agent",
            ),
          closeTab: (kind, id) => closeNodeTabs({ kind, id }),
          openExternal: (url) => openInBrowserTab(url),
          openAiSettings,
          openAiSection,
          openAiTasks,
          closeAiTasks: (workspaceId) => closeFileTabs(aiTasksPanelFileRef(workspaceId)),
        }),
      () =>
        registerActiveNode(() => {
          const id = getActiveId()
          const tab = getTabs().find((candidate) => candidate.id === id)
          if (!tab || getActiveSource() !== "user") return null
          const fileTarget = fileEngineTargetForTab(tab)
          const fileResource = fileTarget ? resourceRefForFile(fileTarget.ref) : null
          const ref = fileResource?.scheme === "node" ? fileResource : nodeResourceRefForTab(tab)
          return ref ? { kind: ref.kind, id: ref.id } : null
        }),
      () =>
        runRegistrationTransaction(
          [infoManifest, communityManifest].flatMap((manifest) =>
            (manifest.resolvers ?? []).map(
              (resolver) => () => registerContentResolver(resolver.types, resolver.resolve),
            ),
          ),
        ),
      () =>
        runRegistrationTransaction(
          [
            syncManifest,
            shellManifest,
            gitManifest,
            databaseManifest,
            audioManifest,
            codeManifest,
          ].map((manifest) => () => manifest.register()),
        ),
      // 随包 FileSystem + Engine + Display 统一走生产 runtime factory 路径；Catalog/Registry
      // 会跨 provider、mount、descriptor 与 renderer 做同批安装和逆序回滚。
      () => discoverBundledRuntimeExtensions(runtimeExtensionCatalog),
      // 持久化快照只重放可信 factory id，不承载可执行代码。
      () => runtimeExtensionCatalog.hydrate(),
    ])
    bootState = "ready"
  } catch (error) {
    bootState = "idle"
    throw error
  }

  // 随包能力默认启用；单个扩展失败只记录在 catalog，不中断整个 shell 启动。
  void activateBundledRuntimeExtensions(runtimeExtensionCatalog)
}

/**
 * 客户端启动副作用 (仅客户端, 经 BootGate 的 useEffect 调一次; SSR 预渲染不触发)。
 * 与 registerAll (同步纯注册) 分开: 这里做异步、仅 App 的副作用。
 */
export function bootClientEffects(): void {
  // XState Inspector 由内嵌 XStateInspectorPanel 挂载 iframe 后初始化 (避免 Tauri 弹窗被拦 / 错误 URL)。
  // ACP 暴露自启动: 仅桌面 + 用户已开启时才动态加载 agent 暴露链路并启动监听 ——
  // 关闭时不加载 agent 内核 (acp-settings 轻量, 先查; acp-expose 重, 仅按需 import), 不拖累初始包。
  void (async () => {
    if (!isTauri()) return
    const { getAcpSettings } = await import("@/plugins/agent/lib/acp/acp-settings")
    if (!getAcpSettings().allowEditorConnect) return
    const { autostartAcpServerFromSettings } = await import("@/plugins/agent/lib/acp/acp-expose")
    await autostartAcpServerFromSettings()
  })()
}
