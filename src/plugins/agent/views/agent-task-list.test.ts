import assert from "node:assert/strict"
import { test } from "node:test"
import type { AgentTask } from "../lib/agent-tasks"
import type { AgentWorkspace } from "../lib/agent-workspace"
import type { AgentThread } from "../lib/model"
import { buildAgentTaskListItems } from "./agent-task-list"

test("agent task list: joins thread titles and workspace ownership in recent-first order", () => {
  const tasks = [
    { id: "older", workspaceId: "space-a", status: "done", updatedAt: 10 },
    { id: "newer", workspaceId: "space-b", status: "running", updatedAt: 20 },
  ] as AgentTask[]
  const workspaces = [
    { id: "space-a", name: "研究" },
    { id: "space-b", name: "写作" },
  ] as AgentWorkspace[]
  const threads = [
    { id: "older", title: "整理资料" },
    { id: "newer", title: "起草文章" },
  ] as AgentThread[]

  assert.deepEqual(buildAgentTaskListItems(tasks, workspaces, threads), [
    {
      id: "newer",
      workspaceId: "space-b",
      workspaceName: "写作",
      workspaceAvailable: true,
      title: "起草文章",
      status: "running",
      updatedAt: 20,
    },
    {
      id: "older",
      workspaceId: "space-a",
      workspaceName: "研究",
      workspaceAvailable: true,
      title: "整理资料",
      status: "done",
      updatedAt: 10,
    },
  ])
})

test("agent task list: keeps orphaned metadata visible with safe labels", () => {
  const tasks = [
    {
      id: "missing-thread",
      workspaceId: "missing-space",
      status: "failed",
      updatedAt: 1,
    },
  ] as AgentTask[]

  assert.deepEqual(buildAgentTaskListItems(tasks, [], []), [
    {
      id: "missing-thread",
      workspaceId: "missing-space",
      workspaceName: "空间已删除",
      workspaceAvailable: false,
      title: "对话不可用",
      status: "failed",
      updatedAt: 1,
    },
  ])
})
