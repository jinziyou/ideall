import { createActor, waitFor, type AnyStateMachine, type SnapshotFrom } from "xstate"
import { store } from "@/lib/store"
import { flowProgressActions, type FlowProgress } from "@/lib/flow-progress-slice"
import type { AuthFlowInput } from "@/lib/auth/auth-flow-runner"
import { actorInspectOptions, ensureXStateInspector } from "@/lib/xstate-inspector"

export function setFlowProgress(progress: FlowProgress | null) {
  store.dispatch(flowProgressActions.set(progress))
}

export function authProgressFromSnapshot(
  snapshot: SnapshotFrom<AnyStateMachine>,
  mode: AuthFlowInput["mode"],
): FlowProgress | null {
  if (snapshot.matches("handshake")) {
    return { kind: "auth", phase: "handshake", label: "安全握手中…" }
  }
  if (snapshot.matches("submitting")) {
    return {
      kind: "auth",
      phase: "submitting",
      label: mode === "login" ? "登录中…" : "注册中…",
    }
  }
  if (snapshot.matches("profile")) {
    return { kind: "auth", phase: "profile", label: "加载资料…" }
  }
  return null
}

/** 并行 sync 编排: 根据 subscriptions / notes 子状态拼进度文案。 */
export function syncProgressFromSnapshot(
  snapshot: SnapshotFrom<AnyStateMachine>,
): FlowProgress | null {
  if (!snapshot.matches("syncing")) return null
  const v = snapshot.value
  const parts: string[] = []
  if (typeof v === "object" && v !== null && "syncing" in v) {
    const par = (v as { syncing: Record<string, string> }).syncing
    if (par.subscriptions === "run") parts.push("关注")
    if (par.notes === "run") parts.push("笔记")
  }
  return {
    kind: "sync",
    phase: "syncing",
    label:
      parts.length === 2 ? "同步关注与笔记…" : parts.length === 1 ? `同步${parts[0]}…` : "同步中…",
    detail: parts.length ? parts.join("、") : undefined,
  }
}

type RunActorOpts<TOutput> = {
  mapProgress: (snapshot: SnapshotFrom<AnyStateMachine>) => FlowProgress | null
  getError?: (snapshot: SnapshotFrom<AnyStateMachine>) => string | undefined
  getOutput?: (snapshot: SnapshotFrom<AnyStateMachine>) => TOutput
  fallbackError?: string
}

/** 启动 actor、订阅进度、等待终态; 结束时清除进度。 */
export async function runActorWithProgress<TOutput>(
  machine: AnyStateMachine,
  input: unknown,
  opts: RunActorOpts<TOutput>,
): Promise<TOutput> {
  const { mapProgress, getError, getOutput, fallbackError = "操作失败" } = opts
  await ensureXStateInspector()
  const actor = createActor(machine, { input, ...actorInspectOptions() })
  const sub = actor.subscribe((s) => {
    const p = mapProgress(s)
    if (p) setFlowProgress(p)
  })
  actor.start()
  setFlowProgress(mapProgress(actor.getSnapshot()))

  try {
    const snapshot = await waitFor(actor, (s) => s.status === "done" || s.matches("failed"))

    if (snapshot.matches("failed")) {
      throw new Error(getError?.(snapshot) ?? fallbackError)
    }
    if (snapshot.status === "done") {
      if (getOutput) return getOutput(snapshot)
      return snapshot.output as TOutput
    }

    throw new Error(fallbackError)
  } finally {
    sub.unsubscribe()
    actor.stop()
    setFlowProgress(null)
  }
}
