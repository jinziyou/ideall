// /info —— 改为 Web 容器: 内嵌 wonita/portal 的资讯应用 (iframe + postMessage + MCP)。
// 原生实现已移入 wonita/portal; (discover) 外壳/nav 仍由 ideall 提供。
// 公共语料由被嵌入页直连 apiserver; 订阅/收藏回写经 MCP hub.* 落本地 home (见 docs/ideall-embed-bridge.md)。
import { EmbedHost } from "@/components/embed/host"
import { infoEmbedManifest } from "@/components/embed/manifest"

export default function Info() {
  return <EmbedHost manifest={infoEmbedManifest} />
}
