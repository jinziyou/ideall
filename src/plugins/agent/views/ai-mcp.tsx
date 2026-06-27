"use client"

// MCP 服务器注册表视图 —— 连接器: 外部数据与工具 + 内置「本地能力 (loopback)」。
// 主列表 (每行一个 server: 状态点 / 名称 / 传输+目标 / 启用开关) + 选中项详情面板。
// loopback 行展示进程内能力位 (只读, 不可删); 外部行可编辑请求头 / 测试连接 / 删除 (运行任务时即时连接)。

import * as React from "react"
import { Loader2, Plug, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

import {
  AiPage,
  Panel,
  SettingRow,
  StatusDot,
  CountBadge,
  Chip,
  Toggle,
  ListRow,
  AddButton,
  type Tone,
} from "./ui-kit"
import {
  getMcpServers,
  subscribeMcpServers,
  getServerMcpServers,
  createMcpServer,
  saveMcpServer,
  setMcpEnabled,
  deleteMcpServer,
  runStatusOf,
  MCP_TRANSPORTS,
  LOOPBACK_ID,
  type McpServer,
  type McpTransport,
  type McpRunStatus,
} from "../lib/agent-mcp-registry"
import { CAPABILITY_OPTIONS } from "../lib/agent-capabilities"
import { probeMcpServer } from "../lib/agent-mcp"

import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Label } from "@/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/ui/dialog"

const STATUS_TONE: Record<McpRunStatus, Tone> = {
  connected: "ok",
  connecting: "warn",
  error: "error",
  disabled: "idle",
  pending: "idle",
}

function transportLabel(transport: McpTransport): string {
  return MCP_TRANSPORTS.find((t) => t.value === transport)?.label ?? transport
}

export default function AiMcp() {
  const servers = React.useSyncExternalStore(
    subscribeMcpServers,
    getMcpServers,
    getServerMcpServers,
  )

  const [selectedId, setSelectedId] = React.useState<string | undefined>(servers[0]?.id)
  const selected = servers.find((s) => s.id === selectedId) ?? servers[0]

  // 添加服务器表单
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [transport, setTransport] = React.useState<McpTransport>("stdio")
  const [command, setCommand] = React.useState("")
  const [args, setArgs] = React.useState("")
  const [url, setUrl] = React.useState("")

  function openDialog() {
    setName("")
    setTransport("stdio")
    setCommand("")
    setArgs("")
    setUrl("")
    setDialogOpen(true)
  }

  function submit() {
    const created = createMcpServer({
      name: name.trim() || "未命名服务器",
      transport,
      command,
      args,
      url,
    })
    setSelectedId(created.id)
    setDialogOpen(false)
  }

  function remove(id: string) {
    deleteMcpServer(id)
    setSelectedId(LOOPBACK_ID)
  }

  return (
    <AiPage
      title="MCP"
      icon={Plug}
      description="连接器：外部数据与工具。本地能力 (loopback) 内置。"
      action={<AddButton label="添加服务器" onClick={openDialog} />}
    >
      <div className="space-y-8">
        {/* 服务器列表 */}
        <div className="space-y-2">
          {servers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              active={selected?.id === server.id}
              onSelect={() => setSelectedId(server.id)}
            />
          ))}
        </div>

        {/* 选中项详情 (key=id: 切换 server 重挂, 清空测试结果) */}
        {selected && (
          <ServerDetail key={selected.id} server={selected} onDelete={() => remove(selected.id)} />
        )}
      </div>

      {/* 添加服务器对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加 MCP 服务器</DialogTitle>
            <DialogDescription>
              连接外部数据与工具（HTTP / SSE 跨平台；stdio 本地命令仅桌面
              App）。添加后可在详情里配置请求头。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-name">名称</Label>
              <Input
                id="mcp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：文件系统"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mcp-transport">传输</Label>
              <Select value={transport} onValueChange={(v) => setTransport(v as McpTransport)}>
                <SelectTrigger id="mcp-transport" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MCP_TRANSPORTS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {transport === "stdio" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-command">启动命令</Label>
                  <Input
                    id="mcp-command"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="npx"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-args">参数</Label>
                  <Input
                    id="mcp-args"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    placeholder="-y @modelcontextprotocol/server-filesystem ."
                  />
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="mcp-url">端点 URL</Label>
                <Input
                  id="mcp-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={submit}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AiPage>
  )
}

/** 列表行: 一个 MCP server。 */
function ServerRow({
  server,
  active,
  onSelect,
}: {
  server: McpServer
  active: boolean
  onSelect: () => void
}) {
  const isLoopback = server.transport === "loopback"
  const subtitle = isLoopback
    ? "本地进程内 · 读写「我的」/ 联网"
    : `${transportLabel(server.transport)} · ${server.command || server.url || "未配置"}`

  return (
    <ListRow
      leading={<StatusDot tone={STATUS_TONE[runStatusOf(server)]} />}
      title={server.name}
      subtitle={subtitle}
      active={active}
      onClick={onSelect}
      trailing={
        <>
          {isLoopback && <CountBadge>{CAPABILITY_OPTIONS.length}</CountBadge>}
          <Toggle
            checked={server.enabled}
            onChange={(v) => setMcpEnabled(server.id, v)}
            label="启用"
          />
        </>
      }
    />
  )
}

/** 选中项详情面板: 按传输分派 (loopback 无状态 / 外部带状态, 守 hooks 规则)。 */
function ServerDetail({ server, onDelete }: { server: McpServer; onDelete: () => void }) {
  return server.transport === "loopback" ? (
    <LoopbackDetail />
  ) : (
    <ExternalServerDetail server={server} onDelete={onDelete} />
  )
}

function LoopbackDetail() {
  return (
    <Panel title="本地能力 (loopback)" description="进程内 MCP；工作空间按能力位选用。">
      <div className="divide-y">
        {CAPABILITY_OPTIONS.map((c) => (
          <div
            key={c.perm}
            className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{c.label}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{c.hint}</p>
            </div>
            <Chip>{c.perm}</Chip>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function ExternalServerDetail({ server, onDelete }: { server: McpServer; onDelete: () => void }) {
  const isStdio = server.transport === "stdio"
  const [probing, setProbing] = React.useState(false)
  const [probe, setProbe] = React.useState<Awaited<ReturnType<typeof probeMcpServer>> | null>(null)

  async function test() {
    setProbing(true)
    setProbe(null)
    try {
      setProbe(await probeMcpServer(server))
    } finally {
      setProbing(false)
    }
  }
  const patchHeaders = (next: McpServer["headers"]) => saveMcpServer({ ...server, headers: next })

  return (
    <Panel
      title={server.name}
      description="外部连接器配置。运行任务（智能体模式）时即时连接；stdio（本地命令）仅桌面 App。"
      action={
        <>
          <Button variant="outline" size="sm" onClick={test} disabled={probing}>
            {probing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            测试连接
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
            删除
          </Button>
        </>
      }
    >
      <div className="divide-y">
        <SettingRow label="传输">
          <Chip tone="info">{transportLabel(server.transport)}</Chip>
        </SettingRow>

        {isStdio ? (
          <>
            <SettingRow label="启动命令">
              <span className="font-mono text-[13px] text-muted-foreground">
                {server.command || "未配置"}
              </span>
            </SettingRow>
            <SettingRow label="参数">
              <span className="font-mono text-[13px] text-muted-foreground">
                {server.args || "无"}
              </span>
            </SettingRow>
          </>
        ) : (
          <SettingRow label="端点 URL">
            <span className="font-mono text-[13px] text-muted-foreground">
              {server.url || "未配置"}
            </span>
          </SettingRow>
        )}
      </div>

      {/* 请求头 (sse/http 认证: 如 Authorization: Bearer <token>); 仅存本机 */}
      {!isStdio && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">请求头</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => patchHeaders([...server.headers, { key: "", value: "" }])}
            >
              <Plus className="h-4 w-4" />
              添加
            </Button>
          </div>
          {server.headers.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              无。如需认证可加 Authorization：Bearer &lt;token&gt;。
            </p>
          ) : (
            server.headers.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="h-8 flex-1"
                  placeholder="Header 名"
                  value={h.key}
                  onChange={(e) =>
                    patchHeaders(
                      server.headers.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                    )
                  }
                />
                <Input
                  className="h-8 flex-1"
                  type="password"
                  autoComplete="off"
                  placeholder="值（仅存本机）"
                  value={h.value}
                  onChange={(e) =>
                    patchHeaders(
                      server.headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => patchHeaders(server.headers.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}

      {/* 测试连接结果 */}
      {probe && (
        <div
          className={cn(
            "mt-4 rounded-lg border px-4 py-3 text-[13px]",
            probe.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
          )}
        >
          {probe.ok
            ? `连接成功 · 列出 ${probe.toolCount} 个工具${probe.tools?.length ? `：${probe.tools.join("、")}` : ""}`
            : `连接失败：${probe.error}`}
        </div>
      )}
    </Panel>
  )
}
