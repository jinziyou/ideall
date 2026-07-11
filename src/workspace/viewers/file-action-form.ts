import type { FileRef, IdeallFile } from "@protocol/file-system"
import type { FileAction, FileActionInputSchema, FileActionRisk } from "@/filesystem/types"

export const ROOT_ACTION_INPUT = "$value"

export type FileActionDraft = Record<string, unknown>

export type PendingFileAction = Readonly<{
  action: FileAction
  ref: FileRef
  version?: string
  input?: unknown
}>

export type ParsedFileActionInput = { ok: true; value: unknown } | { ok: false; error: string }

function schemaDefault(schema: FileActionInputSchema): unknown {
  switch (schema.type) {
    case "string":
      return schema.default ?? ""
    case "number":
    case "integer":
      return schema.default == null ? "" : String(schema.default)
    case "boolean":
      return schema.default ?? false
    case "array":
      return ""
    case "object":
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([name, property]) => [
          name,
          schemaDefault(property),
        ]),
      )
  }
}

export function initialFileActionDraft(schema: FileActionInputSchema): FileActionDraft {
  if (schema.type === "object") return schemaDefault(schema) as FileActionDraft
  return { [ROOT_ACTION_INPUT]: schemaDefault(schema) }
}

function missing(raw: unknown): boolean {
  return raw == null || raw === ""
}

function parseJson(
  raw: unknown,
  expected: "object" | "array",
  label: string,
): ParsedFileActionInput {
  let value = raw
  if (typeof raw === "string") {
    if (!raw.trim()) return { ok: false, error: `${label}不能为空` }
    try {
      value = JSON.parse(raw)
    } catch {
      return { ok: false, error: `${label}不是有效 JSON` }
    }
  }
  const valid =
    expected === "array"
      ? Array.isArray(value)
      : value !== null && typeof value === "object" && !Array.isArray(value)
  return valid
    ? { ok: true, value }
    : { ok: false, error: `${label}必须是${expected === "array" ? "数组" : "对象"}` }
}

function parseSchemaValue(
  schema: FileActionInputSchema,
  raw: unknown,
  label: string,
): ParsedFileActionInput {
  switch (schema.type) {
    case "string": {
      if (schema.format === "binary") {
        if (typeof Blob !== "undefined" && raw instanceof Blob) return { ok: true, value: raw }
        return { ok: false, error: `请选择${label}` }
      }
      if (typeof raw !== "string") return { ok: false, error: `${label}必须是文本` }
      if (schema.minLength != null && raw.length < schema.minLength) {
        return { ok: false, error: `${label}至少需要 ${schema.minLength} 个字符` }
      }
      if (schema.maxLength != null && raw.length > schema.maxLength) {
        return { ok: false, error: `${label}最多允许 ${schema.maxLength} 个字符` }
      }
      if (schema.enum && !schema.enum.includes(raw)) {
        return { ok: false, error: `${label}不是允许的选项` }
      }
      if (schema.pattern) {
        try {
          if (!new RegExp(schema.pattern).test(raw)) {
            return { ok: false, error: `${label}格式不正确` }
          }
        } catch {
          return { ok: false, error: `${label}的校验规则无效` }
        }
      }
      return { ok: true, value: raw }
    }
    case "number":
    case "integer": {
      const value = typeof raw === "number" ? raw : Number(raw)
      if (!Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) {
        return { ok: false, error: `${label}必须是${schema.type === "integer" ? "整数" : "数字"}` }
      }
      if (schema.minimum != null && value < schema.minimum) {
        return { ok: false, error: `${label}不能小于 ${schema.minimum}` }
      }
      if (schema.maximum != null && value > schema.maximum) {
        return { ok: false, error: `${label}不能大于 ${schema.maximum}` }
      }
      return { ok: true, value }
    }
    case "boolean":
      return typeof raw === "boolean"
        ? { ok: true, value: raw }
        : { ok: false, error: `${label}必须是布尔值` }
    case "array": {
      const parsed = parseJson(raw, "array", label)
      if (!parsed.ok) return parsed
      const values = parsed.value as unknown[]
      if (schema.minItems != null && values.length < schema.minItems) {
        return { ok: false, error: `${label}至少需要 ${schema.minItems} 项` }
      }
      if (schema.maxItems != null && values.length > schema.maxItems) {
        return { ok: false, error: `${label}最多允许 ${schema.maxItems} 项` }
      }
      for (let index = 0; index < values.length; index += 1) {
        const item = parseSchemaValue(schema.items, values[index], `${label}第 ${index + 1} 项`)
        if (!item.ok) return item
        values[index] = item.value
      }
      return { ok: true, value: values }
    }
    case "object": {
      const parsed = parseJson(raw, "object", label)
      if (!parsed.ok) return parsed
      return parseObjectSchema(schema, parsed.value as Record<string, unknown>)
    }
  }
}

function parseObjectSchema(
  schema: Extract<FileActionInputSchema, { type: "object" }>,
  draft: Record<string, unknown>,
): ParsedFileActionInput {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const value: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(properties)) {
    const raw = draft[name]
    const label = property.title ?? name
    if (missing(raw)) {
      if (required.has(name)) return { ok: false, error: `${label}不能为空` }
      continue
    }
    const parsed = parseSchemaValue(property, raw, label)
    if (!parsed.ok) return parsed
    value[name] = parsed.value
  }
  if (schema.additionalProperties) {
    for (const [name, raw] of Object.entries(draft)) {
      if (!(name in properties)) value[name] = raw
    }
  }
  return { ok: true, value }
}

export function parseFileActionInput(
  schema: FileActionInputSchema,
  draft: FileActionDraft,
): ParsedFileActionInput {
  if (schema.type === "object") return parseObjectSchema(schema, draft)
  const raw = draft[ROOT_ACTION_INPUT]
  if (missing(raw)) return { ok: false, error: `${schema.title ?? "输入"}不能为空` }
  return parseSchemaValue(schema, raw, schema.title ?? "输入")
}

export function fileActionRisk(action: FileAction): FileActionRisk {
  return action.risk ?? (action.destructive ? "destructive" : "safe")
}

export function capturePendingFileAction(
  action: FileAction,
  file: Pick<IdeallFile, "ref" | "version">,
  input?: unknown,
): PendingFileAction {
  return { action, ref: file.ref, version: file.version, input }
}

export function isPendingFileActionCurrent(
  pending: PendingFileAction,
  file: Pick<IdeallFile, "ref" | "version">,
): boolean {
  return (
    pending.ref.fileSystemId === file.ref.fileSystemId &&
    pending.ref.fileId === file.ref.fileId &&
    pending.version === file.version
  )
}
