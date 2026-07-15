import * as React from "react"
import { sameFileRef } from "@protocol/file-system"
import type { EngineDescriptor } from "@protocol/engine"
import {
  INSTALLED_APPS_ROOT_MEDIA_TYPE,
  INSTALLED_APPS_ROOT_REF,
} from "@/filesystem/builtin-app-roots"
import type { FileEngineRenderer } from "@/workspace/file-engine-renderer"

const AppsPage = React.lazy(() => import("./apps-page"))

export const installedAppsEngineDescriptor = {
  engineId: "ideall.installed-apps",
  label: "本机应用",
  match: {
    kinds: ["directory"],
    mediaTypes: [INSTALLED_APPS_ROOT_MEDIA_TYPE],
  },
  priority: 930,
  layout: "padded",
  access: "read-only",
  supportsStandaloneWindow: false,
  iconHint: "app",
} as const satisfies EngineDescriptor

export const installedAppsEngineRenderer: FileEngineRenderer = ({ file, descriptor }) =>
  sameFileRef(file.ref, INSTALLED_APPS_ROOT_REF) ? (
    <AppsPage rootRef={file.ref} />
  ) : (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      {descriptor.label}尚未接入 {file.source.label ?? file.source.id} 的此类目录。
    </div>
  )

export const installedAppsEngineContribution = {
  descriptor: installedAppsEngineDescriptor,
  renderer: installedAppsEngineRenderer,
} as const
