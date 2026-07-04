"use client"

import * as React from "react"

/** TabHost 注入: 当前标签面板是否为激活态 (后台 keep-alive 标签为 false)。 */
export const TabActiveContext = React.createContext(true)

export function useTabActive(): boolean {
  return React.useContext(TabActiveContext)
}
