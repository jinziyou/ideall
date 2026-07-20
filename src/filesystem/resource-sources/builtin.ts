import { getResourceSource, registerResourceSource } from "./registry"
import { nodeResourceSource } from "./node-source"
import { connectedResourceSources } from "./connected-sources"

export const builtInResourceSources = [nodeResourceSource, ...connectedResourceSources]

export function registerBuiltInResourceSources(): () => void {
  const disposers: Array<() => void> = []
  for (const source of builtInResourceSources) {
    if (!getResourceSource(source.scheme)) disposers.push(registerResourceSource(source))
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
