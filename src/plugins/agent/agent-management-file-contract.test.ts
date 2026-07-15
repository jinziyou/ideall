import assert from "node:assert/strict"
import { test } from "node:test"
import {
  decodeAgentWorkspaceActivateInput,
  decodeAgentWorkspaceActivateResult,
  decodeAgentWorkspaceCreateInput,
  decodeAgentTasksDocument,
  decodeAgentWorkspaceCreateResult,
  decodeAgentWorkspacesDocument,
  MAX_AGENT_MANAGEMENT_STRING_LENGTH,
  MAX_AGENT_TASK_ITEMS,
  MAX_AGENT_WORKSPACE_ITEMS,
} from "./agent-management-file-contract"

test("agent management file contract: decodes only the public list fields", () => {
  assert.deepEqual(
    decodeAgentWorkspacesDocument({
      workspaces: [{ id: "ws-1", name: "研究", taskCount: 3, model: { apiKey: "not-consumed" } }],
      activeId: "ws-1",
    }),
    { workspaces: [{ id: "ws-1", name: "研究", taskCount: 3 }], activeId: "ws-1" },
  )
  assert.deepEqual(
    decodeAgentTasksDocument([
      {
        id: "thread-1",
        threadRef: { fileSystemId: "ideall.core", fileId: "resource:thread-1" },
        workspaceId: "ws-1",
        status: "running",
        updatedAt: 2,
        starred: false,
      },
    ]),
    [
      {
        id: "thread-1",
        threadRef: { fileSystemId: "ideall.core", fileId: "resource:thread-1" },
        workspaceId: "ws-1",
        status: "running",
        updatedAt: 2,
      },
    ],
  )
})

test("agent management file contract: rejects dangling identities and malformed task status", () => {
  assert.throws(
    () =>
      decodeAgentWorkspacesDocument({
        workspaces: [{ id: "ws-1", name: "研究", taskCount: 0 }],
        activeId: "missing",
      }),
    /activeId/,
  )
  assert.throws(
    () =>
      decodeAgentTasksDocument([
        {
          id: "thread-1",
          threadRef: { fileSystemId: "ideall.core", fileId: "resource:thread-1" },
          workspaceId: "ws-1",
          status: "unknown",
          updatedAt: 1,
        },
      ]),
    /status/,
  )
})

test("agent management file contract: decodes the minimal safe create result", () => {
  assert.deepEqual(decodeAgentWorkspaceCreateResult({ workspaceId: "ws-2", name: "工作区 2" }), {
    workspaceId: "ws-2",
    name: "工作区 2",
  })
  assert.deepEqual(decodeAgentWorkspaceCreateInput(undefined), {})
  assert.deepEqual(decodeAgentWorkspaceCreateInput({ name: "研究" }), { name: "研究" })
  assert.deepEqual(decodeAgentWorkspaceActivateInput({ workspaceId: "ws-2" }), {
    workspaceId: "ws-2",
  })
  assert.deepEqual(decodeAgentWorkspaceActivateResult({ workspaceId: "ws-2" }), {
    workspaceId: "ws-2",
  })
  assert.throws(
    () =>
      decodeAgentWorkspaceCreateResult({
        workspaceId: "ws-2",
        name: "工作区 2",
        apiKey: "must-not-cross-boundary",
      }),
    /未知字段/,
  )
})

test("agent management file contract: bounds collections, strings and timestamps", () => {
  assert.throws(
    () =>
      decodeAgentWorkspacesDocument({
        workspaces: Array.from({ length: MAX_AGENT_WORKSPACE_ITEMS + 1 }, (_, index) => ({
          id: `ws-${index}`,
          name: "工作区",
          taskCount: 0,
        })),
        activeId: "ws-0",
      }),
    /不能超过/,
  )
  assert.throws(
    () =>
      decodeAgentTasksDocument(
        Array.from({ length: MAX_AGENT_TASK_ITEMS + 1 }, (_, index) => ({
          id: `task-${index}`,
          threadRef: { fileSystemId: "ideall.core", fileId: `resource:task-${index}` },
          workspaceId: "ws-1",
          status: "active",
          updatedAt: index,
        })),
      ),
    /不能超过/,
  )
  assert.throws(
    () =>
      decodeAgentWorkspacesDocument({
        workspaces: [
          {
            id: "ws-1",
            name: "x".repeat(MAX_AGENT_MANAGEMENT_STRING_LENGTH + 1),
            taskCount: 0,
          },
        ],
        activeId: "ws-1",
      }),
    /不能超过/,
  )
  for (const taskCount of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        decodeAgentWorkspacesDocument({
          workspaces: [{ id: "ws-1", name: "工作区", taskCount }],
          activeId: "ws-1",
        }),
      /taskCount.*安全整数/,
    )
  }
  assert.throws(
    () =>
      decodeAgentTasksDocument([
        {
          id: "task-1",
          threadRef: { fileSystemId: "ideall.core", fileId: "resource:task-1" },
          workspaceId: "ws-1",
          status: "active",
          updatedAt: Number.MAX_SAFE_INTEGER + 1,
        },
      ]),
    /安全整数/,
  )
  assert.throws(
    () =>
      decodeAgentWorkspaceActivateInput({
        workspaceId: "x".repeat(MAX_AGENT_MANAGEMENT_STRING_LENGTH + 1),
      }),
    /不能超过/,
  )
})
