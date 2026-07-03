"use client"

import { Provider } from "react-redux"
import { store } from "@/lib/store"
import type { ReactNode } from "react"

/** Redux Provider (workspace RTK + flowProgress); 挂在 BootGate 内, 包住全部客户端 UI。 */
export default function ReduxProvider({ children }: { children: ReactNode }) {
  return <Provider store={store}>{children}</Provider>
}
