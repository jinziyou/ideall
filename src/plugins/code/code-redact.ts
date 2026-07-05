const SENSITIVE_RE =
  /(token|secret|api[-_]?key|authorization|auth|cookie|password|session|jwt|bearer|credential|refresh|sync[:_-]?code)/i

export type RedactedPreview = {
  value: string
  redacted: boolean
}

export function safeStoragePreview(key: string, value: string): RedactedPreview {
  if (SENSITIVE_RE.test(key)) return { value: "•••••• 已脱敏", redacted: true }
  try {
    const parsed = JSON.parse(value) as unknown
    const redacted = redactValue(parsed)
    const serialized = JSON.stringify(redacted)
    return { value: truncatePreview(serialized), redacted: serialized !== value }
  } catch {
    return { value: truncatePreview(value), redacted: false }
  }
}

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (!value || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_RE.test(key) ? "••••••" : redactValue(inner)
  }
  return out
}

function truncatePreview(value: string): string {
  return value.length > 160 ? `${value.slice(0, 160)}...` : value
}
