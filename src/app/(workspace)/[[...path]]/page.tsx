import OpenWorkspaceTab from "@/workspace/open-workspace-tab"
import { workspaceStaticParams } from "@/workspace/static-routes"

// App 生产形态是 output: export；根路径与清单内深链统一由可选 catch-all 导出。
export async function generateStaticParams() {
  return [{ path: [] }, ...workspaceStaticParams()]
}

export default function WorkspaceRoute() {
  return <OpenWorkspaceTab />
}
