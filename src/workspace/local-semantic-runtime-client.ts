import { LOCAL_SEMANTIC_RUNTIME_PATH } from "@/lib/local-semantic-contract"
import type * as SemanticRuntime from "./local-semantic-search"

type LocalSemanticRuntime = Pick<
  typeof SemanticRuntime,
  | "deleteLocalSemanticSearch"
  | "getLocalSemanticSearchStatus"
  | "installLocalSemanticSearch"
  | "invalidateLocalSemanticSearch"
  | "mergeLocalSemanticRanks"
  | "queryLocalSemanticScores"
  | "rebuildLocalSemanticSearch"
  | "refreshLocalSemanticDocument"
  | "setLocalSemanticSearchActive"
>

declare global {
  interface Window {
    IdeallSemanticRuntime?: LocalSemanticRuntime
  }
}

let runtimePromise: Promise<LocalSemanticRuntime> | null = null

export function loadLocalSemanticRuntime(): Promise<LocalSemanticRuntime> {
  if (window.IdeallSemanticRuntime) return Promise.resolve(window.IdeallSemanticRuntime)
  if (runtimePromise) return runtimePromise
  const loading = new Promise<LocalSemanticRuntime>((resolve, reject) => {
    const script = document.createElement("script")
    script.onload = () => {
      if (window.IdeallSemanticRuntime) resolve(window.IdeallSemanticRuntime)
      else reject(new Error("语义运行时不可用"))
    }
    script.onerror = () => reject(new Error("语义运行时加载失败"))
    script.src = LOCAL_SEMANTIC_RUNTIME_PATH
    document.head.append(script)
  })
  runtimePromise = loading
  return loading
}
