import { readPublicConfig, writePublicConfig } from "./public-config"

const SETTINGS_KEY = "ideall:semantic-search:v1"

export function isLocalSemanticSearchEnabled(): boolean {
  return readPublicConfig(SETTINGS_KEY) === "1"
}

export function setLocalSemanticSearchEnabled(enabled: boolean): boolean {
  return writePublicConfig(SETTINGS_KEY, enabled ? "1" : "0")
}
