"use client"

// MCP 服务器注册表视图 —— 连接器: 外部数据与工具 + 内置「本地能力 (loopback)」。
// 主列表 (每行一个 server: 状态点 / 名称 / 传输+目标 / 启用开关) + 选中项详情面板。
// loopback 行展示进程内能力位 (只读, 不可删); 外部行可编辑请求头 / 测试连接 / 删除 (运行任务时即时连接)。

import * as React from "react"
import { KeyRound, Loader2, Plug, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useFileDocument } from "@/shared/use-file-document"
import { Chip } from "@/ui/chip"
import { EmptyState } from "@/ui/empty-state"
import { Panel, SettingRow } from "@/ui/panel"
import { StatusDot, CountBadge, type Tone } from "@/ui/status-dot"
import { Switch } from "@/ui/switch"

import { AiPage, ListRow, AddButton } from "./ui-kit"
import {
  runStatusOf,
  MCP_TRANSPORTS,
  LOOPBACK_ID,
  type McpServer,
  type McpTransport,
  type McpRunStatus,
} from "../lib/agent-mcp-registry"
import {
  AGENT_MCP_CREATE_ACTION,
  AGENT_MCP_PROBE_ACTION,
  agentConfigFileRef,
  type AgentMcpCreateResult,
  type AgentMcpProbeResult,
} from "../agent-config-file-system"
import { CAPABILITY_OPTIONS } from "../lib/agent-capabilities"
import { decodeAgentMcpServers } from "../lib/agent-config-codecs"
import {
  subscribeSecrets,
  getSecrets,
  getServerSecrets,
  setSecret,
  deleteSecret,
  hydrateAgentSecretsSecure,
  isValidSecretName,
} from "../lib/agent-secrets"
import {
  startMcpAuthAuto,
  stopMcpAuthCallback,
  finishMcpAuth,
  hydrateMcpOAuthSecure,
  isMcpAuthorized,
  clearMcpAuth,
  revokeMcpAuth,
  lastAuthUrl,
} from "../lib/agent-oauth"

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

const MCP_FILE_REF = agentConfigFileRef("mcp")

type UpdateMcpServer = (updater: (server: McpServer) => McpServer) => Promise<unknown>

function reportMcpWriteError(error: unknown): void {
  toast.error("MCP 配置保存失败", {
    description: error instanceof Error ? error.message : String(error),
  })
}

function transportLabel(transport: McpTransport): string {
  return MCP_TRANSPORTS.find((t) => t.value === transport)?.label ?? transport
}

export default function AiMcp() {
  const document = useFileDocument(MCP_FILE_REF, decodeAgentMcpServers)
  const updateServers = document.update
  const servers = document.data ?? []

  const [selectedId, setSelectedId] = React.useState<string | undefined>(servers[0]?.id)
  const selected = servers.find((s) => s.id === selectedId) ?? servers[0]

  const [secretsOpen, setSecretsOpen] = React.useState(false)
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

  async function submit() {
    const now = Date.now()
    const created: McpServer = {
      // provider 生成最终身份；占位 id 只用于复用完整 MCP 输入 codec。
      id: "pending-mcp-create",
      name: name.trim() || "未命名服务器",
      transport,
      command,
      args,
      url,
      env: [],
      headers: [],
      auth: "none",
      enabled: true,
      builtin: false,
      createdAt: now,
      updatedAt: now,
    }
    try {
      const result = await document.invoke<AgentMcpCreateResult>(AGENT_MCP_CREATE_ACTION, created)
      setSelectedId(result.serverId)
      setDialogOpen(false)
    } catch (error) {
      reportMcpWriteError(error)
    }
  }

  const updateServer = React.useCallback(
    (id: string, updater: (server: McpServer) => McpServer) => {
      const updatedAt = Date.now()
      return updateServers((current) =>
        current.map((server) => (server.id === id ? { ...updater(server), updatedAt } : server)),
      )
    },
    [updateServers],
  )

  async function remove(id: string) {
    try {
      await updateServers((current) =>
        current.filter((server) => server.id !== id || server.builtin),
      )
      setSelectedId(LOOPBACK_ID)
    } catch (error) {
      reportMcpWriteError(error)
    }
  }

  function retryRead() {
    void document.refresh().catch(() => {})
  }

  return (
    <AiPage
      title="MCP"
      icon={Plug}
      action={
        <>
          {document.saving || document.acting ? <Chip tone="neutral">保存中</Chip> : null}
          {document.error && document.data !== null ? <Chip tone="error">操作失败</Chip> : null}
          {document.data !== null ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setSecretsOpen(true)}>
                <KeyRound className="h-4 w-4" />
                密钥
              </Button>
              <AddButton label="添加服务器" onClick={openDialog} />
            </>
          ) : null}
        </>
      }
    >
      {document.loading && document.data === null ? (
        <EmptyState icon={Plug} title="正在读取 MCP 配置…" variant="halo" bordered={false} />
      ) : document.data === null ? (
        <EmptyState
          icon={Plug}
          title="MCP 配置读取失败"
          description="文件系统暂不可用，请稍后重试。"
          variant="halo"
          bordered={false}
          action={
            <Button type="button" variant="outline" size="sm" onClick={retryRead}>
              重新读取
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {/* 服务器列表 */}
          <div className="space-y-2">
            {servers.map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                active={selected?.id === server.id}
                onSelect={() => setSelectedId(server.id)}
                onUpdate={(updater) => updateServer(server.id, updater)}
              />
            ))}
          </div>

          {/* 选中项详情 (key=id: 切换 server 重挂, 清空测试结果) */}
          {selected && (
            <ServerDetail
              key={selected.id}
              server={selected}
              onUpdate={(updater) => updateServer(selected.id, updater)}
              onDelete={() => void remove(selected.id)}
              onProbe={(serverId) =>
                document.invoke<AgentMcpProbeResult>(AGENT_MCP_PROBE_ACTION, { serverId })
              }
            />
          )}

          {document.error ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <span>MCP 配置操作失败，请重新读取后再试。</span>
              <Button type="button" variant="outline" size="sm" onClick={retryRead}>
                重试读取
              </Button>
            </div>
          ) : null}
        </div>
      )}

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
            <Button onClick={() => void submit()} disabled={document.acting}>
              {document.acting ? "正在添加…" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SecretsDialog open={secretsOpen} onOpenChange={setSecretsOpen} />
    </AiPage>
  )
}

/** 本机密钥管理 (${NAME} 引用): 请求头等配置写 ${NAME}, 实际值集中存这里 (遮罩, 仅存本机)。 */
function SecretsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const secrets = React.useSyncExternalStore(subscribeSecrets, getSecrets, getServerSecrets)
  const [name, setName] = React.useState("")
  const [value, setValue] = React.useState("")
  React.useEffect(() => {
    if (open) void hydrateAgentSecretsSecure()
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>密钥</DialogTitle>
          <DialogDescription>
            请求头等配置里用 {"${NAME}"} 引用；密钥仅存本机，不内嵌进 server 配置。名称仅限字母 /
            数字 / 下划线。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {secrets.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">还没有密钥。</p>
          ) : (
            secrets.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 text-[12px]">{`\${${s.id}}`}</code>
                <span className="flex-1 truncate text-[13px] text-muted-foreground">••••••</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    void deleteSecret(s.id).catch((error) =>
                      toast.error(error instanceof Error ? error.message : "删除密钥失败"),
                    )
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
          <div className="flex items-center gap-2 pt-2">
            <Input
              className="h-8 flex-1"
              placeholder="名称（如 ZOTERO_TOKEN）"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              className="h-8 flex-1"
              type="password"
              autoComplete="off"
              placeholder="值"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!isValidSecretName(name)}
              onClick={() => {
                void setSecret(name, value)
                  .then(() => {
                    setName("")
                    setValue("")
                  })
                  .catch((error) =>
                    toast.error(error instanceof Error ? error.message : "保存密钥失败"),
                  )
              }}
            >
              存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 列表行: 一个 MCP server。 */
function ServerRow({
  server,
  active,
  onSelect,
  onUpdate,
}: {
  server: McpServer
  active: boolean
  onSelect: () => void
  onUpdate: UpdateMcpServer
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
          <Switch
            checked={server.enabled}
            onChange={(enabled) => {
              void onUpdate((current) => ({ ...current, enabled })).catch(reportMcpWriteError)
            }}
            label="启用"
          />
        </>
      }
    />
  )
}

/** 选中项详情面板: 按传输分派 (loopback 无状态 / 外部带状态, 守 hooks 规则)。 */
function ServerDetail({
  server,
  onUpdate,
  onDelete,
  onProbe,
}: {
  server: McpServer
  onUpdate: UpdateMcpServer
  onDelete: () => void
  onProbe: (serverId: string) => Promise<AgentMcpProbeResult>
}) {
  return server.transport === "loopback" ? (
    <LoopbackDetail />
  ) : (
    <ExternalServerDetail
      server={server}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onProbe={onProbe}
    />
  )
}

function LoopbackDetail() {
  return (
    <Panel title="本地能力 (loopback)">
      <div className="divide-y">
        {CAPABILITY_OPTIONS.map((c) => (
          <div
            key={c.perm}
            className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{c.label}</p>
            </div>
            <Chip>{c.perm}</Chip>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function ExternalServerDetail({
  server,
  onUpdate,
  onDelete,
  onProbe,
}: {
  server: McpServer
  onUpdate: UpdateMcpServer
  onDelete: () => void
  onProbe: (serverId: string) => Promise<AgentMcpProbeResult>
}) {
  const isStdio = server.transport === "stdio"
  const [probing, setProbing] = React.useState(false)
  const [probe, setProbe] = React.useState<AgentMcpProbeResult | null>(null)

  async function test() {
    setProbing(true)
    setProbe(null)
    try {
      setProbe(await onProbe(server.id))
    } catch {
      setProbe({ ok: false, error: "文件系统无法执行连接测试" })
    } finally {
      setProbing(false)
    }
  }
  const patchHeaders = (headers: McpServer["headers"]) => {
    void onUpdate((current) => ({ ...current, headers })).catch(reportMcpWriteError)
  }

  // OAuth (手动粘贴授权码); forceAuthRefresh 在授权状态变化后强制重读 localStorage。
  const [, forceAuthRefresh] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => {
    if (server.auth !== "oauth") return
    let alive = true
    hydrateMcpOAuthSecure(server.id)
      .then(() => {
        if (alive) forceAuthRefresh()
      })
      .catch(() => {
        /* 授权状态读取失败时保持未授权展示 */
      })
    return () => {
      alive = false
    }
  }, [server.auth, server.id])
  const authorized = isMcpAuthorized(server.id)
  const [oauthStep, setOauthStep] = React.useState<"idle" | "paste">("idle")
  const [pasted, setPasted] = React.useState("")
  const [oauthMsg, setOauthMsg] = React.useState<string | null>(null)
  const [oauthBusy, setOauthBusy] = React.useState(false)
  // run token: 取消 / 新一轮使旧 await 的后续 setState 失效 (桌面等回调可能挂到超时)。
  const authRunRef = React.useRef(0)

  async function authorize() {
    const myRun = ++authRunRef.current
    setOauthBusy(true)
    setOauthStep("idle")
    setOauthMsg("已打开授权页，请在浏览器完成授权…")
    try {
      // 桌面: loopback 自动回调 (免粘贴); web: 退回手动粘贴。
      const r = await startMcpAuthAuto(server.id, server.url)
      if (authRunRef.current !== myRun) return // 已取消 / 新一轮
      if (r === "REDIRECT") {
        setOauthStep("paste")
        setOauthMsg("已打开授权页。授权后把浏览器地址栏里回调的整条 URL（含 ?code=…）粘到下方。")
      } else {
        forceAuthRefresh()
        setOauthMsg("授权成功")
      }
    } catch (e) {
      if (authRunRef.current !== myRun) return
      setOauthMsg(`授权失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (authRunRef.current === myRun) setOauthBusy(false)
    }
  }

  function cancelAuth() {
    authRunRef.current++ // 失效当前 run (其后续 setState 跳过)
    void stopMcpAuthCallback() // 释放 loopback 端口 (桌面)
    setOauthBusy(false)
    setOauthStep("idle")
    setOauthMsg("已取消")
  }

  const [revoking, setRevoking] = React.useState(false)
  async function revoke() {
    setRevoking(true)
    try {
      await revokeMcpAuth(server.id, server.url) // RFC 7009 服务端撤销 + 清本机 (失败仍清本机)
    } finally {
      setRevoking(false)
      forceAuthRefresh()
      setOauthMsg("已撤销授权")
    }
  }
  async function completeAuth() {
    setOauthBusy(true)
    setOauthMsg(null)
    try {
      await finishMcpAuth(server.id, pasted, server.url)
      setOauthStep("idle")
      setPasted("")
      forceAuthRefresh()
      setOauthMsg("授权成功")
    } catch (e) {
      setOauthMsg(`完成授权失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setOauthBusy(false)
    }
  }

  return (
    <Panel
      title={server.name}
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
                为保护本机配置，启动参数不在公开文件中显示
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
          <p className="text-[12px] text-muted-foreground">
            值可用 {"${NAME}"} 引用「密钥」（顶部「密钥」管理），避免内嵌明文。
          </p>
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

      {/* OAuth 授权 (sse/http; 手动粘贴授权码) */}
      {!isStdio && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">OAuth 授权</span>
            <Switch
              checked={server.auth === "oauth"}
              onChange={(v) => {
                void onUpdate((current) => ({ ...current, auth: v ? "oauth" : "none" }))
                  .then(() => {
                    if (!v) {
                      // 关 OAuth 时清本地 token, 避免「已授权」假象与陈旧 token。
                      clearMcpAuth(server.id)
                      forceAuthRefresh()
                    }
                  })
                  .catch(reportMcpWriteError)
              }}
              label="OAuth"
            />
          </div>
          {server.auth === "oauth" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={authorized ? "ok" : "warn"}>{authorized ? "已授权" : "未授权"}</Chip>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={oauthBusy || !server.url}
                  onClick={authorize}
                >
                  {oauthBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {authorized ? "重新授权" : "授权"}
                </Button>
                {oauthBusy && (
                  <Button variant="ghost" size="sm" onClick={cancelAuth}>
                    取消
                  </Button>
                )}
                {authorized && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoking}
                    onClick={revoke}
                    title="向授权方撤销 token (RFC 7009) 并清本机；撤销失败仍清本机"
                  >
                    {revoking && <Loader2 className="h-4 w-4 animate-spin" />}
                    撤销授权
                  </Button>
                )}
              </div>
              {oauthStep === "paste" && (
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 flex-1"
                    placeholder="粘贴回调 URL（含 ?code=…）"
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                  />
                  <Button size="sm" disabled={oauthBusy || !pasted.trim()} onClick={completeAuth}>
                    完成授权
                  </Button>
                </div>
              )}
              {oauthStep === "paste" && lastAuthUrl(server.id) && (
                <a
                  href={lastAuthUrl(server.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[13px] text-primary underline-offset-2 hover:underline"
                >
                  若没有自动打开授权页，点此手动打开
                </a>
              )}
              {oauthMsg && (
                <p className="text-[13px] leading-relaxed text-muted-foreground">{oauthMsg}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 测试连接结果 */}
      {probe && (
        <div
          className={cn(
            "mt-4 rounded-lg border px-4 py-3 text-[13px]",
            probe.ok
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive",
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
