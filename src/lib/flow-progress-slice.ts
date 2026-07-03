import { createSlice, type PayloadAction } from "@reduxjs/toolkit"

export type FlowProgress = {
  kind: "auth" | "sync"
  phase: string
  label: string
  detail?: string
}

type FlowProgressState = {
  current: FlowProgress | null
}

const initialState: FlowProgressState = { current: null }

export const flowProgressSlice = createSlice({
  name: "flowProgress",
  initialState,
  reducers: {
    set(state, action: PayloadAction<FlowProgress | null>) {
      state.current = action.payload
    },
  },
})

export const flowProgressActions = flowProgressSlice.actions
