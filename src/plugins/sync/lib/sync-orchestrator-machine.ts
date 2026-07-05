// 跨域同步编排 XState 状态机 —— 并发同步关注 + 笔记, 聚合 SyncResult; 任一失败则 failed。
import { setup, assign, fromPromise } from "xstate"
import type { SyncResult } from "@protocol/sync"
import { runDomainSync } from "./sync-domain-machine"
import { subscriptionsSyncConfig } from "./subscription-sync"
import { notesSyncConfig } from "./notes-sync"
import { runActorWithProgress, syncProgressFromSnapshot } from "@/lib/xstate-progress"

type OrchestratorContext = {
  code: string
  subsResult?: SyncResult
  notesResult?: SyncResult
  error?: string
}

const syncOrchestratorMachine = setup({
  types: {
    context: {} as OrchestratorContext,
    input: {} as { code: string },
    output: {} as SyncResult,
  },
  actors: {
    syncSubscriptions: fromPromise(async ({ input }: { input: { code: string } }) =>
      runDomainSync(input.code, subscriptionsSyncConfig),
    ),
    syncNotes: fromPromise(async ({ input }: { input: { code: string } }) =>
      runDomainSync(input.code, notesSyncConfig),
    ),
  },
}).createMachine({
  id: "syncOrchestrator",
  initial: "syncing",
  context: ({ input }) => ({ code: input.code }),
  states: {
    syncing: {
      type: "parallel",
      states: {
        subscriptions: {
          initial: "run",
          states: {
            run: {
              invoke: {
                src: "syncSubscriptions",
                input: ({ context }) => ({ code: context.code }),
                onDone: {
                  target: "ok",
                  actions: assign({
                    subsResult: ({ event }) => event.output,
                  }),
                },
                onError: {
                  target: "err",
                  actions: assign({
                    error: ({ context, event }) => {
                      const msg =
                        event.error instanceof Error ? event.error.message : String(event.error)
                      return context.error ? `${context.error}；${msg}` : msg
                    },
                  }),
                },
              },
            },
            ok: { type: "final" },
            err: { type: "final" },
          },
        },
        notes: {
          initial: "run",
          states: {
            run: {
              invoke: {
                src: "syncNotes",
                input: ({ context }) => ({ code: context.code }),
                onDone: {
                  target: "ok",
                  actions: assign({
                    notesResult: ({ event }) => event.output,
                  }),
                },
                onError: {
                  target: "err",
                  actions: assign({
                    error: ({ context, event }) => {
                      const msg =
                        event.error instanceof Error ? event.error.message : String(event.error)
                      return context.error ? `${context.error}；${msg}` : msg
                    },
                  }),
                },
              },
            },
            ok: { type: "final" },
            err: { type: "final" },
          },
        },
      },
      onDone: [
        {
          guard: ({ context }) => !context.error,
          target: "complete",
        },
        { target: "failed" },
      ],
    },
    complete: { type: "final" },
    failed: { type: "final" },
  },
  output: ({ context }) => ({
    total: (context.subsResult?.total ?? 0) + (context.notesResult?.total ?? 0),
    added: (context.subsResult?.added ?? 0) + (context.notesResult?.added ?? 0),
  }),
})

/** SyncPort.syncNow 入口 —— 经 XState 并发编排两域。 */
export async function runSyncOrchestrator(code: string): Promise<SyncResult> {
  return runActorWithProgress(
    syncOrchestratorMachine,
    { code },
    {
      mapProgress: syncProgressFromSnapshot,
      getError: (s) => (s.context as OrchestratorContext).error,
      fallbackError: "同步失败",
    },
  )
}

export { syncOrchestratorMachine }
