import {
  CAPTURE_ONBOARDING_STORAGE_KEY,
  readPublicConfig,
  writePublicConfig,
  type PublicConfigStorage,
} from "./public-config"

export type CaptureOnboardingPhase = "not-started" | "captured" | "prompted" | "completed"

type PersistedCaptureOnboarding = Readonly<{
  version: 1
  phase: Exclude<CaptureOnboardingPhase, "not-started">
  capturedAt: number
  updatedAt: number
}>

const listeners = new Set<() => void>()

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

export function isPersistedCaptureOnboarding(value: unknown): value is PersistedCaptureOnboarding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  return (
    state.version === 1 &&
    (state.phase === "captured" || state.phase === "prompted" || state.phase === "completed") &&
    isTimestamp(state.capturedAt) &&
    isTimestamp(state.updatedAt) &&
    state.updatedAt >= state.capturedAt
  )
}

function readState(storage?: PublicConfigStorage): PersistedCaptureOnboarding | null {
  const raw = readPublicConfig(CAPTURE_ONBOARDING_STORAGE_KEY, storage)
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isPersistedCaptureOnboarding(value) ? value : null
  } catch {
    return null
  }
}

function publish(): void {
  for (const listener of listeners) listener()
}

function writeState(state: PersistedCaptureOnboarding, storage?: PublicConfigStorage): boolean {
  const written = writePublicConfig(CAPTURE_ONBOARDING_STORAGE_KEY, JSON.stringify(state), storage)
  if (written) publish()
  return written
}

export function getCaptureOnboardingPhase(storage?: PublicConfigStorage): CaptureOnboardingPhase {
  return readState(storage)?.phase ?? "not-started"
}

export function getServerCaptureOnboardingPhase(): CaptureOnboardingPhase {
  return "not-started"
}

/** 只有真正创建的新捕获会启动引导；已有链接和后续捕获不会重置状态。 */
export function recordFirstCreatedCapture(
  storage?: PublicConfigStorage,
  now = Date.now(),
): boolean {
  if (readState(storage)) return false
  return writeState({ version: 1, phase: "captured", capturedAt: now, updatedAt: now }, storage)
}

/** toast 对首次提示做一次性 claim；未 claim 或已 claim 的状态都继续允许收件箱显示内联说明。 */
export function claimFirstCapturePrompt(storage?: PublicConfigStorage, now = Date.now()): boolean {
  const state = readState(storage)
  if (!state || state.phase !== "captured") return false
  return writeState(
    { ...state, phase: "prompted", updatedAt: Math.max(now, state.updatedAt) },
    storage,
  )
}

/** 完成一次整理或主动关闭说明后永久结束；返回值表示本次是否发生了状态转换。 */
export function completeCaptureOnboarding(
  storage?: PublicConfigStorage,
  now = Date.now(),
): boolean {
  const state = readState(storage)
  if (!state || state.phase === "completed") return false
  return writeState(
    { ...state, phase: "completed", updatedAt: Math.max(now, state.updatedAt) },
    storage,
  )
}

export function subscribeCaptureOnboarding(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === CAPTURE_ONBOARDING_STORAGE_KEY || event.key === null) listener()
  }
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage)
  }
}
