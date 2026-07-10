import type { FileCapability, FileKind } from "./file-system"

/** 引擎只描述展示需求；具体 React 组件由 UI 层按 engineId 另行注册。 */
export type EngineLayout = "padded" | "fill"

export type EngineAccess = "read-only" | "read-write"

export type EngineMatchPropertyValue = string | number | boolean | null

export type EngineMatcher = Readonly<{
  /** 不指定即接受 file 与 directory。 */
  kinds?: readonly FileKind[]
  /** MIME 模式；支持精确值、类型通配、全通配以及片段通配。 */
  mediaTypes?: readonly string[]
  /** 文件必须同时具备这里列出的所有 capability。 */
  requiredCapabilities?: readonly FileCapability[]
  /** 文件 properties 中必须存在且严格相等的标量属性。 */
  properties?: Readonly<Record<string, EngineMatchPropertyValue>>
}>

export type EngineDescriptor = Readonly<{
  engineId: string
  label: string
  match?: EngineMatcher
  /** 数字越大，未配置用户偏好时越优先；缺省为 0。 */
  priority?: number
  layout: EngineLayout
  access: EngineAccess
  supportsStandaloneWindow?: boolean
  iconHint?: string
}>
