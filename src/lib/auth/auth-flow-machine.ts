// 登录/注册 XState 状态机 —— handshake → submitting → profile → complete | failed。
import { setup, assign, fromPromise } from "xstate"
import type { AuthPayload } from "@/lib/auth/auth-api"
import {
  type AuthFlowInput,
  type AuthFlowResult,
  runAuthHandshake,
  runAuthProfile,
  runAuthSubmit,
} from "./auth-flow-runner"
import { runActorWithProgress, authProgressFromSnapshot } from "@/lib/xstate-progress"

type AuthFlowContext = {
  mode: AuthFlowInput["mode"]
  email: string
  password: string
  payload?: AuthPayload
  emailTrimmed?: string
  token?: string
  result?: AuthFlowResult
  error?: string
}

const authFlowMachine = setup({
  types: {
    context: {} as AuthFlowContext,
    input: {} as AuthFlowInput,
    output: {} as AuthFlowResult,
  },
  actors: {
    handshake: fromPromise(async ({ input }: { input: AuthFlowInput }) => runAuthHandshake(input)),
    submit: fromPromise(
      async ({ input }: { input: { mode: AuthFlowInput["mode"]; payload: AuthPayload } }) =>
        runAuthSubmit(input.mode, input.payload),
    ),
    profile: fromPromise(async ({ input }: { input: { token: string; email: string } }) =>
      runAuthProfile(input.token, input.email),
    ),
  },
}).createMachine({
  id: "authFlow",
  initial: "handshake",
  context: ({ input }) => ({
    mode: input.mode,
    email: input.email,
    password: input.password,
  }),
  states: {
    handshake: {
      invoke: {
        src: "handshake",
        input: ({ context }) => ({
          mode: context.mode,
          email: context.email,
          password: context.password,
        }),
        onDone: {
          target: "submitting",
          actions: assign({
            payload: ({ event }) => event.output.payload,
            emailTrimmed: ({ event }) => event.output.email,
          }),
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
    submitting: {
      invoke: {
        src: "submit",
        input: ({ context }) => ({
          mode: context.mode,
          payload: context.payload!,
        }),
        onDone: {
          target: "profile",
          actions: assign({
            token: ({ event }) => event.output.token,
            emailTrimmed: ({ event }) => event.output.email,
          }),
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
    profile: {
      invoke: {
        src: "profile",
        input: ({ context }) => ({
          token: context.token!,
          email: context.emailTrimmed!,
        }),
        onDone: {
          target: "complete",
          actions: assign({ result: ({ event }) => event.output }),
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
    complete: { type: "final" },
    failed: { type: "final" },
  },
})

/** 经 XState 完成登录/注册; 成功后由调用方 setSession (会话仍走 auth-store 端口)。 */
export async function runAuthFlow(input: AuthFlowInput): Promise<AuthFlowResult> {
  return runActorWithProgress(authFlowMachine, input, {
    mapProgress: (s) => authProgressFromSnapshot(s, input.mode),
    getError: (s) => (s.context as AuthFlowContext).error,
    getOutput: (s) => (s.context as AuthFlowContext).result!,
    fallbackError: "操作失败，请重试",
  })
}

export { authFlowMachine }
