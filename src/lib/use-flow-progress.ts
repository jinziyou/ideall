"use client"

import { useAppSelector } from "@/lib/store"

/** 当前 auth / sync XState 流程进度 (null = 无进行中的流程)。 */
export function useFlowProgress() {
  return useAppSelector((s) => s.flowProgress.current)
}
