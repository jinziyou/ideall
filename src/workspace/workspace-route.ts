import type { DevelopmentTool, WorkspaceKind } from "./types"

export type WorkspaceRouteCommand = Readonly<{
  workspace: WorkspaceKind
  developmentTool?: DevelopmentTool
}>

const WORKSPACE_ROUTE_COMMANDS: Readonly<Record<string, WorkspaceRouteCommand>> = {
  "/audio": { workspace: "audio" },
  "/git": { workspace: "development", developmentTool: "git" },
  "/database": { workspace: "development", developmentTool: "database" },
  "/shell": { workspace: "development", developmentTool: "shell" },
}

/** 旧插件路由现在只切换保持挂载的工作区 Dock，不再重复打开同一工具标签。 */
export function workspaceCommandForPath(pathname: string): WorkspaceRouteCommand | null {
  return WORKSPACE_ROUTE_COMMANDS[pathname] ?? null
}
