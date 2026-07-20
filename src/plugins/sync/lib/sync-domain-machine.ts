// 单域同步 XState 状态机 —— preparing → attempting (409 重试) → done | failed。
import { setup, assign, fromPromise, createActor, waitFor } from "xstate"
import type { SyncRecord, SyncResult } from "@protocol/sync"
import {
  type DomainSyncConfig,
  prepareDomainSync,
  runDomainSyncAttempt,
  SYNC_MAX_ATTEMPTS,
} from "./sync-domain-runner"
import { actorInspectOptions, ensureXStateInspector } from "@/lib/xstate-inspector"

type DomainMachineContext = {
  code: string
  config: DomainSyncConfig<SyncRecord>
  storageId: string
  key: CryptoKey
  now: number
  localAll: SyncRecord[]
  localSnapshot: SyncRecord[]
  merged: SyncRecord[]
  attempt: number
  result?: SyncResult
  error?: string
}

const domainSyncMachine = setup({
  types: {
    context: {} as DomainMachineContext,
    input: {} as { code: string; config: DomainSyncConfig<SyncRecord> },
    output: {} as SyncResult,
  },
  actors: {
    prepare: fromPromise(
      async ({ input }: { input: { code: string; config: DomainSyncConfig<SyncRecord> } }) =>
        prepareDomainSync(input.code, input.config),
    ),
    attempt: fromPromise(
      async ({
        input,
      }: {
        input: {
          ctx: Omit<DomainMachineContext, "config" | "result" | "error">
          config: DomainSyncConfig<SyncRecord>
        }
      }) => runDomainSyncAttempt(input.ctx, input.config),
    ),
  },
}).createMachine({
  id: "domainSync",
  initial: "preparing",
  context: ({ input }) => ({
    code: input.code,
    config: input.config,
    storageId: "",
    key: null as unknown as CryptoKey,
    now: 0,
    localAll: [],
    localSnapshot: [],
    merged: [],
    attempt: 1,
  }),
  states: {
    preparing: {
      invoke: {
        src: "prepare",
        input: ({ context }) => ({ code: context.code, config: context.config }),
        onDone: {
          target: "attempting",
          actions: assign(({ event }) => ({
            storageId: event.output.storageId,
            key: event.output.key,
            now: event.output.now,
            localAll: event.output.localAll,
            localSnapshot: event.output.localSnapshot,
            merged: event.output.merged,
          })),
        },
        onError: {
          target: "failed",
          actions: assign({
            error: ({ event }) =>
              event.error instanceof Error ? event.error.message : String(event.error),
          }),
        },
      },
    },
    attempting: {
      invoke: {
        src: "attempt",
        input: ({ context }) => ({
          ctx: {
            code: context.code,
            storageId: context.storageId,
            key: context.key,
            now: context.now,
            localAll: context.localAll,
            localSnapshot: context.localSnapshot,
            merged: context.merged,
            attempt: context.attempt,
          },
          config: context.config,
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.type === "complete",
            target: "complete",
            actions: assign({
              result: ({ event }) =>
                event.output.type === "complete" ? event.output.result : undefined,
            }),
          },
          {
            guard: ({ event, context }) =>
              event.output.type === "retry" && context.attempt < SYNC_MAX_ATTEMPTS,
            target: "attempting",
            reenter: true,
            actions: assign({
              attempt: ({ context }) => context.attempt + 1,
              merged: ({ event }) => (event.output.type === "retry" ? event.output.merged : []),
              localSnapshot: ({ event }) =>
                event.output.type === "retry" ? event.output.localSnapshot : [],
            }),
          },
          {
            target: "failed",
            actions: assign({
              error: ({ event }) =>
                event.output.type === "fail"
                  ? event.output.message
                  : "同步失败: 超过最大重试次数, 请稍后再试",
            }),
          },
        ],
        onError: {
          target: "failed",
          actions: assign({
            error: ({ event }) =>
              event.error instanceof Error ? event.error.message : String(event.error),
          }),
        },
      },
    },
    complete: {
      type: "final",
    },
    failed: { type: "final" },
  },
  output: ({ context }) => {
    if (context.result) return context.result
    throw new Error(context.error ?? "同步失败")
  },
})

/** 经 XState 驱动单域同步; 对外仍返回 Promise<SyncResult>。 */
export async function runDomainSync<T extends SyncRecord>(
  code: string,
  config: DomainSyncConfig<T>,
): Promise<SyncResult> {
  await ensureXStateInspector()
  const actor = createActor(domainSyncMachine, {
    input: { code, config: config as unknown as DomainSyncConfig<SyncRecord> },
    ...actorInspectOptions(),
  })
  actor.start()

  try {
    const snapshot = await waitFor(actor, (s) => s.status === "done" || s.matches("failed"))

    if (snapshot.matches("failed")) {
      throw new Error(snapshot.context.error ?? "同步失败")
    }
    if (snapshot.status === "done") return snapshot.output as SyncResult

    throw new Error("同步失败")
  } finally {
    actor.stop()
  }
}

export { domainSyncMachine }
