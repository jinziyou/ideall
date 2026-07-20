"use client"

import * as React from "react"

/** Keep-alive surface visibility port. Consumers outside TabHost default to active. */
export const TabActiveContext = React.createContext(true)

export function useTabActive(): boolean {
  return React.useContext(TabActiveContext)
}
