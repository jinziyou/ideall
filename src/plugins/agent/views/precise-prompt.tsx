"use client"

// 精确模式: 让「实际发给模型的系统提示」可见可改, 并可自定义拼接模板。
//   - 拼接模板 (prompt.template): {{段名}} 占位, 动态拼装 (每次发送按当前数据重算)。
//   - 最终提示 (prompt.override): 一次性「生成」后可编辑; 勾选「原样发送」则按其原样发送 (冻结数据快照)。
// 安全: 用户可自由编辑会绕过「数据非指令」防注入护栏 —— 启用「我的」数据却删掉护栏时给出告警 (不强制)。

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/ui/button"
import { Checkbox } from "@/ui/checkbox"
import { Textarea } from "@/ui/textarea"
import {
  assembleSystemPrompt,
  buildWorkspaceSegments,
  DEFAULT_WORKSPACE_TEMPLATE,
  gatherHomeContext,
  gatherReferencedContext,
  SNAPSHOT_GUARD_SIGNATURE,
  WORKSPACE_SEGMENT_LABELS,
  WORKSPACE_SEGMENT_ORDER,
} from "../lib/agent-context"
import { homeSelectionOf, saveWorkspace, type AgentWorkspace } from "../lib/agent-workspace"

export default function PrecisePrompt({ ws }: { ws: AgentWorkspace }) {
  const [tools, setTools] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const save = (p: Partial<AgentWorkspace["prompt"]>) =>
    saveWorkspace({ ...ws, prompt: { ...ws.prompt, ...p } })

  async function generate() {
    setBusy(true)
    try {
      const sel = homeSelectionOf(ws)
      let homeContext = ""
      let referenced = ""
      if (sel) {
        try {
          homeContext = await gatherHomeContext(sel)
        } catch {
          /* 降级空上下文 */
        }
        try {
          referenced = await gatherReferencedContext()
        } catch {
          /* 忽略 */
        }
      }
      const text = assembleSystemPrompt(
        buildWorkspaceSegments({
          tools,
          homeContext,
          referenced,
          instructions: ws.prompt.instructions,
          rules: ws.rules.rules,
          examples: ws.rules.examples,
        }),
        ws.prompt.template,
      )
      save({ override: text, precise: true })
      toast.success("已生成最终提示，可直接编辑")
    } finally {
      setBusy(false)
    }
  }

  // 启用「我的」数据 + 原样发送, 但最终文本里没有防注入护栏特征句 → 告警 (不阻断)。
  const guardMissing =
    ws.data.includeHome &&
    ws.prompt.precise &&
    !!ws.prompt.override.trim() &&
    !ws.prompt.override.includes(SNAPSHOT_GUARD_SIGNATURE)

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {/* 拼接模板 */}
        <section className="space-y-2 border-b pb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">拼接模板</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => save({ template: "" })}
            >
              恢复默认
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            可用占位：{WORKSPACE_SEGMENT_ORDER.map((k) => `{{${k}}}`).join(" ")}
          </p>
          <Textarea
            rows={5}
            className="font-mono text-xs"
            placeholder={DEFAULT_WORKSPACE_TEMPLATE}
            value={ws.prompt.template}
            onChange={(e) => save({ template: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {WORKSPACE_SEGMENT_ORDER.map((k) => `{{${k}}} = ${WORKSPACE_SEGMENT_LABELS[k]}`).join(
              "，",
            )}
          </p>
        </section>

        {/* 最终系统提示 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">最终系统提示</h3>
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={generate}>
              用当前模板 + 数据生成
            </Button>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox checked={tools} onCheckedChange={(v) => setTools(v === true)} />
            生成时含工具说明（智能体模式）
          </label>
          <Textarea
            rows={12}
            className="font-mono text-xs"
            placeholder="点上方「生成」后，在此查看并编辑实际发给模型的系统提示…"
            value={ws.prompt.override}
            onChange={(e) => save({ override: e.target.value })}
          />
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <Checkbox
              checked={ws.prompt.precise}
              onCheckedChange={(v) => save({ precise: v === true })}
              className="mt-0.5"
            />
            <span>
              发送时按上面文本<strong>原样发送</strong>
              （冻结数据快照；关闭则仍按模板动态拼装）
            </span>
          </label>
          {ws.prompt.precise && !ws.prompt.override.trim() && (
            <p className="text-xs text-muted-foreground">
              已开启原样发送，但内容为空 —— 发送时将回退为模板动态拼装。
            </p>
          )}
          {guardMissing && (
            <p className="rounded-md border border-l-2 border-l-pop bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
              提示：最终提示里似乎缺少「数据非指令」防注入说明，而你启用了「我的」数据。外部来源的标题可能含注入文本，建议保留该护栏。
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => save({ override: "", precise: false })}
          >
            清空并关闭原样发送
          </Button>
        </section>
      </div>
    </div>
  )
}
