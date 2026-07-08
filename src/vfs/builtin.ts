import { getVfsProvider, registerVfsProvider } from "./registry"
import { nodeVfsProvider } from "./node-provider"
import { connectedVfsProviders } from "./connected-providers"

export const builtInVfsProviders = [nodeVfsProvider, ...connectedVfsProviders]

export function registerBuiltInVfsProviders(): void {
  for (const provider of builtInVfsProviders) {
    if (!getVfsProvider(provider.scheme)) registerVfsProvider(provider)
  }
}
