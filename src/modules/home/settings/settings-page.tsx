"use client"

// 「我的 · 设置」标签内容 —— 外观 / 本机状态 / 已连接应用 (原顶栏设置弹层)。
import * as React from "react"
import { Settings } from "lucide-react"
import { ConnectedAppsView } from "@/plugins/embed/connected-apps-view"
import { LocalDeviceStatusView } from "@/shared/local-device-status-view"
import { ThemeToggleButton } from "@/shared/theme-toggle-button"
import { useFileDocument } from "@/shared/use-file-document"
import { FOLLOWING_TARGET } from "@/shell/nav-config"
import { Panel, SettingRow } from "@/ui/panel"
import { openTarget } from "@/workspace/store"
import {
  RuntimeExtensionsPanel,
  type RuntimeExtensionManagementAction,
  type RuntimeExtensionPanelAction,
} from "./runtime-extensions-panel"
import { LocalDataPanel } from "./local-data-panel"
import {
  SETTINGS_CONNECTION_REVOKE_ACTION,
  SETTINGS_RUNTIME_AUTHORIZE_ACTION,
  SETTINGS_RUNTIME_APPLY_UPDATE_ACTION,
  SETTINGS_RUNTIME_DISCARD_UPDATE_ACTION,
  SETTINGS_RUNTIME_APPLY_PUBLISHER_ROTATION_ACTION,
  SETTINGS_RUNTIME_IMPORT_REVOCATIONS_ACTION,
  SETTINGS_RUNTIME_INSPECT_PUBLISHER_ACTION,
  SETTINGS_RUNTIME_INSPECT_PUBLISHER_ROTATION_ACTION,
  SETTINGS_RUNTIME_INSTALL_PACKAGE_ACTION,
  SETTINGS_RUNTIME_PREPARE_UPDATE_ACTION,
  SETTINGS_RUNTIME_RETRY_ACTION,
  SETTINGS_RUNTIME_REFRESH_REGISTRY_ACTION,
  SETTINGS_RUNTIME_REVOKE_PUBLISHER_ACTION,
  SETTINGS_RUNTIME_REVOKE_ACTION,
  SETTINGS_RUNTIME_ROLLBACK_PACKAGE_ACTION,
  SETTINGS_RUNTIME_TRUST_PUBLISHER_ACTION,
  SETTINGS_RUNTIME_UNINSTALL_ACTION,
  decodeAppearanceSettings,
  decodeConnectionSettings,
  decodeDataSettings,
  decodeDeviceSettings,
  decodeRuntimeExtensionSettings,
  decodeRuntimeExtensionPublisherCandidate,
  decodeRuntimeExtensionPublisherRotationCandidate,
  decodeRuntimeExtensionUpdateCandidate,
  decodeSettingsMutationResult,
  settingsSectionFileRef,
  type SettingsRuntimeAction,
} from "./settings-contract"

const APPEARANCE_REF = settingsSectionFileRef("appearance")
const DEVICE_REF = settingsSectionFileRef("device")
const DATA_REF = settingsSectionFileRef("data")
const CONNECTIONS_REF = settingsSectionFileRef("connections")
const RUNTIME_EXTENSIONS_REF = settingsSectionFileRef("runtime-extensions")

const RUNTIME_ACTION: Record<RuntimeExtensionPanelAction, SettingsRuntimeAction> = {
  authorize: SETTINGS_RUNTIME_AUTHORIZE_ACTION,
  retry: SETTINGS_RUNTIME_RETRY_ACTION,
  revoke: SETTINGS_RUNTIME_REVOKE_ACTION,
  uninstall: SETTINGS_RUNTIME_UNINSTALL_ACTION,
}

function DocumentFailure({ error }: { error: unknown | null }) {
  if (error === null) return null
  return (
    <p role="alert" className="mt-3 text-xs text-destructive">
      {error instanceof Error ? error.message : "设置文件暂时不可用"}
    </p>
  )
}

export default function SettingsPage() {
  const appearance = useFileDocument(APPEARANCE_REF, decodeAppearanceSettings)
  const device = useFileDocument(DEVICE_REF, decodeDeviceSettings)
  const data = useFileDocument(DATA_REF, decodeDataSettings)
  const connections = useFileDocument(CONNECTIONS_REF, decodeConnectionSettings)
  const runtimeExtensions = useFileDocument(RUNTIME_EXTENSIONS_REF, decodeRuntimeExtensionSettings)

  const toggleTheme = React.useCallback(() => {
    void appearance
      .update((current) => ({
        ...current,
        choice: current.effectiveColorScheme === "dark" ? "light" : "dark",
      }))
      .catch(() => {})
  }, [appearance])

  const revokeConnectedApp = React.useCallback(
    (id: string) => {
      void connections.invoke(SETTINGS_CONNECTION_REVOKE_ACTION, { id }).catch(() => {})
    },
    [connections],
  )

  const manageRuntimeExtension = React.useCallback(
    async (id: string, action: RuntimeExtensionPanelAction) => {
      const result = await runtimeExtensions.invoke(RUNTIME_ACTION[action], { id })
      return decodeSettingsMutationResult(result).changed
    },
    [runtimeExtensions],
  )

  const manageRuntimeExtensionHost = React.useCallback(
    async (action: RuntimeExtensionManagementAction, input?: unknown): Promise<unknown> => {
      switch (action) {
        case "install-package":
          return runtimeExtensions.invoke(SETTINGS_RUNTIME_INSTALL_PACKAGE_ACTION)
        case "refresh-registry":
          return runtimeExtensions.invoke(SETTINGS_RUNTIME_REFRESH_REGISTRY_ACTION)
        case "prepare-update":
          return decodeRuntimeExtensionUpdateCandidate(
            await runtimeExtensions.invoke(SETTINGS_RUNTIME_PREPARE_UPDATE_ACTION, input),
          )
        case "apply-update":
          return runtimeExtensions.invoke(SETTINGS_RUNTIME_APPLY_UPDATE_ACTION, input)
        case "discard-update":
          return runtimeExtensions.invoke(SETTINGS_RUNTIME_DISCARD_UPDATE_ACTION, input)
        case "inspect-publisher":
          return decodeRuntimeExtensionPublisherCandidate(
            await runtimeExtensions.invoke(SETTINGS_RUNTIME_INSPECT_PUBLISHER_ACTION),
          )
        case "inspect-publisher-rotation":
          return decodeRuntimeExtensionPublisherRotationCandidate(
            await runtimeExtensions.invoke(SETTINGS_RUNTIME_INSPECT_PUBLISHER_ROTATION_ACTION),
          )
        case "apply-publisher-rotation":
          return runtimeExtensions.invoke(SETTINGS_RUNTIME_APPLY_PUBLISHER_ROTATION_ACTION, input)
        case "trust-publisher":
          return runtimeExtensions.invoke(SETTINGS_RUNTIME_TRUST_PUBLISHER_ACTION, input)
        case "revoke-publisher":
          return runtimeExtensions.invoke(SETTINGS_RUNTIME_REVOKE_PUBLISHER_ACTION, input)
        case "import-revocations":
          return runtimeExtensions.invoke(SETTINGS_RUNTIME_IMPORT_REVOCATIONS_ACTION)
        case "rollback-package":
          return runtimeExtensions.invoke(SETTINGS_RUNTIME_ROLLBACK_PACKAGE_ACTION, input)
      }
    },
    [runtimeExtensions],
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Settings className="h-6 w-6 text-muted-foreground" />
          设置
        </h1>
      </div>

      <Panel>
        <SettingRow label="外观">
          <ThemeToggleButton
            disabled={appearance.data === null || appearance.saving}
            onToggle={toggleTheme}
          />
        </SettingRow>
        <DocumentFailure error={appearance.error} />
      </Panel>

      <LocalDataPanel document={data} />
      <DocumentFailure error={data.error} />

      <Panel>
        {device.data ? (
          <LocalDeviceStatusView
            value={{
              synced: device.data.sync.enabled,
              lastSync: device.data.sync.lastRun,
              storage: device.data.storage,
              publishingIdentity: device.data.publishingIdentity,
            }}
            onManageSync={() => openTarget(FOLLOWING_TARGET)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">正在读取本机状态文件…</p>
        )}
        <DocumentFailure error={device.error} />
      </Panel>

      <Panel>
        <ConnectedAppsView
          connections={connections.data ?? []}
          disabled={connections.acting}
          onRevoke={revokeConnectedApp}
        />
        {connections.loading ? (
          <p className="text-sm text-muted-foreground">正在读取连接文件…</p>
        ) : null}
        <DocumentFailure error={connections.error} />
      </Panel>

      <RuntimeExtensionsPanel
        extensions={runtimeExtensions.data?.extensions ?? []}
        publishers={runtimeExtensions.data?.publishers ?? []}
        registry={runtimeExtensions.data?.registry}
        nativeAvailable={runtimeExtensions.data?.nativeAvailable ?? false}
        loading={runtimeExtensions.loading}
        disabled={runtimeExtensions.acting}
        onAction={manageRuntimeExtension}
        onManagement={manageRuntimeExtensionHost}
      />
      <DocumentFailure error={runtimeExtensions.error} />
    </div>
  )
}
