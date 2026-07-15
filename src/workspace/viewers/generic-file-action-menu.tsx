"use client"

import * as React from "react"
import { Loader2, MoreHorizontal } from "lucide-react"
import { toast } from "sonner"
import type { IdeallFile } from "@protocol/file-system"
import { fileActions, invokeFileAction } from "@/filesystem/registry"
import type { FileAction, FileActionFieldUiHint, FileActionInputSchema } from "@/filesystem/types"
import { ConfirmDialog } from "@/shared/prompt-dialog"
import { Button } from "@/ui/button"
import { Checkbox } from "@/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { Textarea } from "@/ui/textarea"
import {
  ROOT_ACTION_INPUT,
  capturePendingFileAction,
  fileActionRisk,
  initialFileActionDraft,
  isPendingFileActionCurrent,
  parseFileActionInput,
  pendingFileActionInvokeOptions,
  type FileActionDraft,
  type PendingFileAction,
} from "./file-action-form"

const UI_ACTION_CONTEXT = { actor: "ui", permissions: [], intent: "action" } as const

export type GenericFileActionSupport = Readonly<{
  canInvoke: boolean
  requiresInput: boolean
  requiresConfirmation: boolean
  reason?: string
}>

/** Display 只调用声明为 invoke 的动作；display 交给导航，specialized 留给场景 UI。 */
export function genericFileActionSupport(action: FileAction): GenericFileActionSupport {
  if (action.kind !== "invoke") {
    return {
      canInvoke: false,
      requiresInput: false,
      requiresConfirmation: false,
      reason: action.kind === "display" ? "由文件视图处理" : (action.reason ?? "需在专用界面操作"),
    }
  }
  return {
    canInvoke: true,
    requiresInput: action.input != null,
    requiresConfirmation: fileActionRisk(action) !== "safe",
  }
}

export function visibleGenericFileActions(actions: readonly FileAction[]): FileAction[] {
  return actions.filter((action) => action.kind !== "display")
}

function errorDescription(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function actionRequestKey(request: PendingFileAction): string {
  return `${request.ref.fileSystemId}:${request.ref.fileId}:${request.version ?? ""}:${request.action.id}`
}

function fieldLabel(name: string, schema: FileActionInputSchema, hint?: FileActionFieldUiHint) {
  return hint?.label ?? schema.title ?? (name === ROOT_ACTION_INPUT ? "输入" : name)
}

function FileActionInputField({
  name,
  schema,
  hint,
  required,
  value,
  onChange,
}: {
  name: string
  schema: FileActionInputSchema
  hint?: FileActionFieldUiHint
  required: boolean
  value: unknown
  onChange: (value: unknown) => void
}) {
  const id = React.useId()
  const label = fieldLabel(name, schema, hint)
  const control = hint?.control
  const description = schema.description

  if (schema.type === "object" && schema.properties && control !== "json") {
    const objectValue =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
    const nestedRequired = new Set(schema.required ?? [])
    return (
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">
          {label}
          {required ? " *" : ""}
        </legend>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        {Object.entries(schema.properties).map(([childName, childSchema]) => (
          <FileActionInputField
            key={childName}
            name={childName}
            schema={childSchema}
            required={nestedRequired.has(childName)}
            value={objectValue[childName]}
            onChange={(next) => onChange({ ...objectValue, [childName]: next })}
          />
        ))}
      </fieldset>
    )
  }

  let field: React.ReactNode
  if (schema.type === "boolean" || control === "checkbox") {
    field = (
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={value === true}
          onCheckedChange={(next) => onChange(next === true)}
        />
        <Label htmlFor={id} className="font-normal">
          {label}
          {required ? " *" : ""}
        </Label>
      </div>
    )
  } else if (schema.type === "string" && schema.enum && schema.enum.length > 0) {
    field = (
      <Select value={typeof value === "string" ? value : ""} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={hint?.placeholder ?? `请选择${label}`} />
        </SelectTrigger>
        <SelectContent>
          {schema.enum.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else if (schema.type === "string" && (schema.format === "binary" || control === "file")) {
    field = (
      <Input id={id} type="file" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
    )
  } else if (
    schema.type === "array" ||
    schema.type === "object" ||
    control === "json" ||
    control === "textarea" ||
    (schema.type === "string" && schema.format === "multiline")
  ) {
    field = (
      <Textarea
        id={id}
        value={typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2)}
        placeholder={hint?.placeholder}
        rows={schema.type === "array" || schema.type === "object" || control === "json" ? 7 : 4}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  } else {
    const numeric = schema.type === "number" || schema.type === "integer"
    field = (
      <Input
        id={id}
        type={
          numeric
            ? "number"
            : control === "password" || (schema.type === "string" && schema.format === "password")
              ? "password"
              : "text"
        }
        step={schema.type === "integer" ? 1 : numeric ? "any" : undefined}
        min={numeric ? schema.minimum : undefined}
        max={numeric ? schema.maximum : undefined}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
        placeholder={hint?.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  if (schema.type === "boolean" || control === "checkbox") {
    return (
      <div className="space-y-1">
        {field}
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </Label>
      {field}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  )
}

function FileActionForm({
  action,
  onCancel,
  onSubmit,
}: {
  action: Extract<FileAction, { kind: "invoke" }> & { input: FileActionInputSchema }
  onCancel: () => void
  onSubmit: (input: unknown) => void
}) {
  const [draft, setDraft] = React.useState<FileActionDraft>(() =>
    initialFileActionDraft(action.input),
  )
  const [error, setError] = React.useState<string | null>(null)
  const fields =
    action.input.type === "object"
      ? Object.entries(action.input.properties ?? {})
      : ([[ROOT_ACTION_INPUT, action.input]] as const)
  const required = new Set(
    action.input.type === "object" ? (action.input.required ?? []) : [ROOT_ACTION_INPUT],
  )

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = parseFileActionInput(action.input, draft)
        if (!parsed.ok) {
          setError(parsed.error)
          return
        }
        onSubmit(parsed.value)
      }}
    >
      {fields.map(([name, schema]) => (
        <FileActionInputField
          key={name}
          name={name}
          schema={schema}
          hint={action.uiHints?.fields?.[name]}
          required={required.has(name)}
          value={draft[name]}
          onChange={(value) => {
            setDraft((current) => ({ ...current, [name]: value }))
            setError(null)
          }}
        />
      ))}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit">{action.uiHints?.submitLabel ?? action.label}</Button>
      </DialogFooter>
    </form>
  )
}

function FileActionFormDialog({
  request,
  onOpenChange,
  onSubmit,
}: {
  request: PendingFileAction | null
  onOpenChange: (open: boolean) => void
  onSubmit: (input: unknown) => void
}) {
  const action = request?.action
  const formAction =
    action?.kind === "invoke" && action.input
      ? (action as Extract<FileAction, { kind: "invoke" }> & { input: FileActionInputSchema })
      : null
  return (
    <Dialog open={formAction !== null} onOpenChange={onOpenChange}>
      {formAction ? (
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{formAction.label}</DialogTitle>
            <DialogDescription>
              {formAction.input.description ?? "根据文件系统声明的输入契约填写参数。"}
            </DialogDescription>
          </DialogHeader>
          <FileActionForm
            key={request ? actionRequestKey(request) : formAction.id}
            action={formAction}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

export default function GenericFileActionMenu({ file }: { file: IdeallFile }) {
  const supportsActions = file.capabilities.includes("actions")
  const [actions, setActions] = React.useState<FileAction[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [runningId, setRunningId] = React.useState<string | null>(null)
  const [refreshRevision, setRefreshRevision] = React.useState(0)
  const [formRequest, setFormRequest] = React.useState<PendingFileAction | null>(null)
  const [confirmationRequest, setConfirmationRequest] = React.useState<PendingFileAction | null>(
    null,
  )
  const runningKeyRef = React.useRef<string | null>(null)
  const { fileSystemId, fileId } = file.ref
  const visibleActions = actions ? visibleGenericFileActions(actions) : null

  React.useEffect(() => {
    let alive = true
    setActions(null)
    setLoadError(null)
    if (!supportsActions) return () => undefined

    void fileActions({ fileSystemId, fileId }, UI_ACTION_CONTEXT)
      .then((next) => {
        if (alive) setActions(next)
      })
      .catch((reason) => {
        if (!alive) return
        setActions([])
        setLoadError(errorDescription(reason))
      })
    return () => {
      alive = false
    }
  }, [file.version, fileId, fileSystemId, refreshRevision, supportsActions])

  React.useEffect(() => {
    setFormRequest((current) =>
      current && !isPendingFileActionCurrent(current, file) ? null : current,
    )
    setConfirmationRequest((current) =>
      current && !isPendingFileActionCurrent(current, file) ? null : current,
    )
  }, [file, file.version, fileId, fileSystemId])

  const invoke = async (request: PendingFileAction) => {
    if (!isPendingFileActionCurrent(request, file)) {
      toast.error("文件已切换或发生变化，请重新执行操作")
      return
    }
    const runningKey = actionRequestKey(request)
    if (runningKeyRef.current !== null) return
    runningKeyRef.current = runningKey
    setRunningId(request.action.id)
    try {
      await invokeFileAction(
        request.ref,
        request.action.id,
        request.input,
        UI_ACTION_CONTEXT,
        pendingFileActionInvokeOptions(request),
      )
      toast.success(`${request.action.label}已完成`)
      setRefreshRevision((value) => value + 1)
    } catch (reason) {
      toast.error(`${request.action.label}失败`, { description: errorDescription(reason) })
    } finally {
      if (runningKeyRef.current === runningKey) runningKeyRef.current = null
      setRunningId(null)
    }
  }

  const submitRequest = (request: PendingFileAction) => {
    if (fileActionRisk(request.action) === "safe") void invoke(request)
    else setConfirmationRequest(request)
  }

  if (!supportsActions || (visibleActions?.length === 0 && !loadError)) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="文件操作"
            disabled={actions === null}
          >
            {actions === null ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>文件操作</DropdownMenuLabel>
          {loadError ? (
            <DropdownMenuItem disabled>{loadError}</DropdownMenuItem>
          ) : visibleActions?.length === 0 ? (
            <DropdownMenuItem disabled>没有可用操作</DropdownMenuItem>
          ) : (
            visibleActions?.map((action) => {
              const support = genericFileActionSupport(action)
              const running = runningId === action.id
              const destructive = fileActionRisk(action) === "destructive"
              return (
                <DropdownMenuItem
                  key={action.id}
                  disabled={!support.canInvoke || runningId !== null}
                  className={destructive ? "text-destructive focus:text-destructive" : ""}
                  onSelect={() => {
                    if (!support.canInvoke) return
                    const request = capturePendingFileAction(action, file)
                    if (support.requiresInput) setFormRequest(request)
                    else submitRequest(request)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  {running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : support.reason ? (
                    <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
                      {support.reason}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              )
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <FileActionFormDialog
        request={formRequest}
        onOpenChange={(open) => {
          if (!open) setFormRequest(null)
        }}
        onSubmit={(input) => {
          const request = formRequest
          setFormRequest(null)
          if (request) submitRequest({ ...request, input })
        }}
      />
      <ConfirmDialog
        open={confirmationRequest !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmationRequest(null)
        }}
        title={
          (confirmationRequest?.action.kind === "invoke"
            ? confirmationRequest.action.uiHints?.confirmTitle
            : undefined) ?? `确认${confirmationRequest?.action.label ?? "此操作"}?`
        }
        description={
          confirmationRequest?.action.kind === "invoke"
            ? (confirmationRequest.action.uiHints?.confirmDescription ??
              "这是文件系统声明的高风险操作，请确认目标和参数后继续。")
            : undefined
        }
        confirmLabel={
          confirmationRequest?.action.kind === "invoke"
            ? (confirmationRequest.action.uiHints?.submitLabel ?? confirmationRequest.action.label)
            : "继续"
        }
        destructive={
          confirmationRequest != null &&
          fileActionRisk(confirmationRequest.action) === "destructive"
        }
        onConfirm={() => {
          const request = confirmationRequest
          setConfirmationRequest(null)
          if (request) void invoke(request)
        }}
      />
    </>
  )
}
