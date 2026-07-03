import { configureStore, type Middleware } from "@reduxjs/toolkit"
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux"
import { workspaceSlice } from "@/workspace/workspace-slice"
import { persistWorkspaceSnapshot } from "@/workspace/workspace-persist"
import { flowProgressSlice } from "@/lib/flow-progress-slice"

const workspacePersistMiddleware: Middleware = (api) => (next) => (action) => {
  const result = next(action)
  if (
    workspaceSlice.actions.patch.match(action) ||
    workspaceSlice.actions.hydrate.match(action)
  ) {
    const ws = api.getState().workspace
    persistWorkspaceSnapshot(ws, ws.hydrated)
  }
  return result
}

export const store = configureStore({
  reducer: {
    workspace: workspaceSlice.reducer,
    flowProgress: flowProgressSlice.reducer,
  },
  middleware: (getDefault) => getDefault().concat(workspacePersistMiddleware),
  devTools: process.env.NODE_ENV !== "production",
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
