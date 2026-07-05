"use client"

import * as React from "react"
import { hydrateSessionTokenSecure } from "@/lib/auth/auth-store"
import { hydrateSyncCodeSecure } from "@/lib/sync-code"

export default function SecureHydrationBootstrap() {
  React.useEffect(() => {
    void hydrateSessionTokenSecure()
    void hydrateSyncCodeSecure()
  }, [])

  return null
}
