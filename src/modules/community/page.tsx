// /community —— 改为 Web 容器: 内嵌 wonita/portal 的社区应用 (iframe + postMessage + MCP)。
// 原生实现已移入 wonita/portal; (discover) 外壳/nav 仍由 ideall 提供。
// 发布闭环经 MCP community.publish —— token 由宿主 ideall 持有, 永不进 iframe (见 docs/ideall-embed-bridge.md §7)。
import { EmbedHost } from "@/plugins/embed/host"
import { communityEmbedManifest } from "@/plugins/embed/manifest"

export default function Community() {
  return <EmbedHost manifest={communityEmbedManifest} />
}
