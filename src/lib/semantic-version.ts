import { bytesToHex } from "@/lib/hex"

/**
 * 为已经完成确定性序列化的语义快照生成抗碰撞版本。
 * namespace 是协议的一部分；升级序列化规则时应同步提升 namespace。
 */
export async function sha256SemanticVersion(namespace: string, snapshot: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error("SHA-256 is unavailable for semantic versioning")
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(snapshot))
  return `${namespace}:${bytesToHex(new Uint8Array(digest))}`
}
