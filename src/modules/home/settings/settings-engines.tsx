import * as React from "react"
import { sameFileRef } from "@protocol/file-system"
import type { EngineDescriptor } from "@protocol/engine"
import { SETTINGS_ROOT_MEDIA_TYPE, SETTINGS_ROOT_REF } from "@/filesystem/builtin-app-roots"
import type { FileEngineRenderer } from "@/workspace/file-engine-renderer"

const SettingsPage = React.lazy(() => import("./settings-page"))

export const settingsEngineDescriptor = {
  engineId: "ideall.settings",
  label: "基本设置",
  match: {
    kinds: ["directory"],
    mediaTypes: [SETTINGS_ROOT_MEDIA_TYPE],
    properties: { settingsRoot: true },
  },
  priority: 930,
  layout: "padded",
  access: "read-write",
  supportsStandaloneWindow: false,
  iconHint: "settings",
} as const satisfies EngineDescriptor

export const settingsEngineRenderer: FileEngineRenderer = ({ file, descriptor }) =>
  sameFileRef(file.ref, SETTINGS_ROOT_REF) ? (
    <SettingsPage />
  ) : (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      {descriptor.label}尚未接入此文件。
    </div>
  )

export const settingsEngineContribution = {
  descriptor: settingsEngineDescriptor,
  renderer: settingsEngineRenderer,
} as const

export const settingsEngineContributions = [settingsEngineContribution] as const
