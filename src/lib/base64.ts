type BufferLike = Uint8Array & {
  toString: (encoding: string) => string
}

type BufferConstructorLike = {
  from: (input: Uint8Array | string, encoding?: string) => BufferLike
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/
const BYTE_STRING_CHUNK_SIZE = 0x8000

function getBuffer(): BufferConstructorLike | undefined {
  return (globalThis as unknown as { Buffer?: BufferConstructorLike }).Buffer
}

export function isBase64(value: string): boolean {
  return value.length % 4 === 0 && BASE64_RE.test(value)
}

export function bytesToBase64(bytes: Uint8Array): string {
  const buffer = getBuffer()
  if (buffer) return buffer.from(bytes).toString("base64")

  let binary = ""
  for (let i = 0; i < bytes.length; i += BYTE_STRING_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.slice(i, i + BYTE_STRING_CHUNK_SIZE))
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const buffer = getBuffer()
  if (buffer) return new Uint8Array(buffer.from(value, "base64"))

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
