"use client"

import type { ComponentType } from "react"
import { AppWindow, Compass, Globe, Monitor, Search, Users } from "lucide-react"
import type { ResourceRef, ResourceScheme } from "@protocol/resource"
import { iconForNodeKind, NODE_KIND_UI, resolveViewer, type ViewerEntry } from "./node-kind-ui"
import type { TabLayout } from "./tab-definitions"

export type ResourceEngine = {
  scheme: ResourceScheme
  kind: string
  layout: TabLayout
  icon: ComponentType<{ className?: string }>
}

const CONNECTED_ENGINES = {
  info: {
    home: { layout: "fill", icon: Globe },
    entity: { layout: "fill", icon: Globe },
    publisher: { layout: "fill", icon: Globe },
    search: { layout: "fill", icon: Search },
  },
  community: {
    home: { layout: "fill", icon: Users },
    peer: { layout: "fill", icon: Users },
    publication: { layout: "fill", icon: Users },
  },
  tool: {
    search: { layout: "padded", icon: Search },
    ai: { layout: "padded", icon: Globe },
    navigation: { layout: "padded", icon: Compass },
  },
  browser: {
    page: { layout: "fill", icon: Monitor },
    bookmark: { layout: "fill", icon: Monitor },
  },
  app: {
    "native-app": { layout: "padded", icon: AppWindow },
  },
} as const satisfies Record<
  Exclude<ResourceScheme, "node">,
  Record<string, { layout: TabLayout; icon: ComponentType<{ className?: string }> }>
>

export function resolveResourceEngine(ref: ResourceRef): ResourceEngine | null {
  if (ref.scheme === "node") {
    return {
      scheme: "node",
      kind: ref.kind,
      layout: NODE_KIND_UI[ref.kind].layout,
      icon: iconForNodeKind(ref.kind),
    }
  }
  switch (ref.scheme) {
    case "info": {
      const engine = CONNECTED_ENGINES.info[ref.kind]
      return engine ? { scheme: ref.scheme, kind: ref.kind, ...engine } : null
    }
    case "community": {
      const engine = CONNECTED_ENGINES.community[ref.kind]
      return engine ? { scheme: ref.scheme, kind: ref.kind, ...engine } : null
    }
    case "tool": {
      const engine = CONNECTED_ENGINES.tool[ref.kind]
      return engine ? { scheme: ref.scheme, kind: ref.kind, ...engine } : null
    }
    case "browser": {
      const engine = CONNECTED_ENGINES.browser[ref.kind]
      return engine ? { scheme: ref.scheme, kind: ref.kind, ...engine } : null
    }
    case "app": {
      const engine = CONNECTED_ENGINES.app[ref.kind]
      return engine ? { scheme: ref.scheme, kind: ref.kind, ...engine } : null
    }
  }
}

export function resourceLayout(ref: ResourceRef): TabLayout {
  return resolveResourceEngine(ref)?.layout ?? "padded"
}

export function resolveNodeResourceViewer(ref: ResourceRef): ViewerEntry | null {
  return ref.scheme === "node" ? resolveViewer(ref.kind) : null
}
