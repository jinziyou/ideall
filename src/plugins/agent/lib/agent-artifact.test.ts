import assert from "node:assert/strict"
import { test } from "node:test"
import type { FsCreateInput, Node } from "@protocol/node"
import { noteText } from "@/files/note-text"
import {
  AGENT_BOOKMARK_DESCRIPTION_LIMIT,
  AGENT_NOTE_BODY_LIMIT,
  AGENT_NOTE_TAG,
  agentNoteContent,
  agentNoteDraftForMessage,
  loadAgentBookmarkTarget,
  saveAgentResponseAsNote,
  saveAgentResponseAsTask,
  saveAgentResponseToBookmarkDescription,
  undoAgentArtifact,
} from "./agent-artifact"
import { isAgentArtifactReceipt } from "./model"

const sources = [
  { key: "node:note:n1", type: "node", kind: "note", id: "n1", title: "本地资料" },
  { key: "url:https://example.com/a", type: "url", url: "https://example.com/a", title: "网页" },
] as const
const bookmarkSource = {
  key: "node:bookmark:b1",
  type: "node",
  kind: "bookmark",
  id: "b1",
  title: "参考书签",
} as const

test("agent artifact: derives a bounded editable draft and keeps source references only", () => {
  const draft = agentNoteDraftForMessage({
    content: `## 研究结论\n${"a".repeat(AGENT_NOTE_BODY_LIMIT + 10)}`,
  })
  assert.equal(draft.title, "研究结论")
  assert.equal(draft.body.length, AGENT_NOTE_BODY_LIMIT)

  const text = noteText(agentNoteContent({ title: draft.title, body: "结论正文" }, sources))
  assert.match(text, /结论正文/)
  assert.match(text, /node:note:n1/)
  assert.match(text, /https:\/\/example\.com\/a/)
  assert.doesNotMatch(text, /私密资料正文/)

  const manyLines = agentNoteContent(
    { title: "很多段", body: Array.from({ length: 1_000 }, () => "x").join("\n") },
    [],
  )
  assert.equal(manyLines.length, 512)
  assert.match(noteText(manyLines), /按本地笔记块上限截断/)
})

test("agent artifact: creates one tagged note and returns a committed audit receipt", async () => {
  const inputs: FsCreateInput[] = []
  const writer = {
    async fsCreateNode(input: FsCreateInput): Promise<Node> {
      inputs.push(input)
      return {
        kind: "note",
        id: "created-note",
        parentId: null,
        sortKey: "a",
        title: input.title ?? "",
        tags: input.tags ?? [],
        content: input.content as unknown[],
        createdAt: 123,
        updatedAt: 123,
      }
    },
  }

  const receipt = await saveAgentResponseAsNote(
    { title: "  报告  ", body: "结果" },
    sources,
    writer,
  )
  assert.deepEqual(receipt, {
    kind: "note",
    nodeId: "created-note",
    title: "报告",
    createdAt: 123,
    sourceKeys: ["node:note:n1", "url:https://example.com/a"],
  })
  assert.equal(inputs.length, 1)
  assert.deepEqual(inputs[0]?.tags, [AGENT_NOTE_TAG])
  assert.equal(inputs[0]?.kind, "note")
  assert.throws(() => agentNoteContent({ title: "空", body: "   " }, sources), /正文不能为空/)
})

test("agent artifact: task creation commits the answer, returns a versioned receipt and undoes by CAS", async () => {
  const removals: Array<{ id: string; expected: number }> = []
  const created = {
    id: "task-1",
    title: "新对话",
    messages: [],
    createdAt: 10,
    updatedAt: 10,
  }
  const taskGateway = {
    async create(workspaceId: string) {
      assert.equal(workspaceId, "ws-1")
      return created
    },
    async commit(thread: typeof created, title: string, messages: readonly { content: string }[]) {
      assert.equal(thread.id, created.id)
      assert.equal(title, "任务标题")
      assert.equal(messages.length, 2)
      assert.match(messages[0]?.content ?? "", /保存为任务资料/)
      assert.equal(messages[1]?.content, "任务正文")
      return { committedVersion: 20 }
    },
    async remove(id: string, expected: number) {
      removals.push({ id, expected })
    },
  }
  const bookmarkGateway = {
    async load() {
      throw new Error("unused")
    },
    async commit() {
      throw new Error("unused")
    },
  }

  const receipt = await saveAgentResponseAsTask(
    {
      workspaceId: "ws-1",
      workspaceName: "研究",
      title: "任务标题",
      body: "任务正文",
    },
    [bookmarkSource],
    taskGateway,
  )
  assert.equal(receipt.kind, "task")
  if (receipt.kind !== "task") assert.fail("expected task receipt")
  assert.equal(receipt.committedVersion, 20)
  assert.equal(receipt.workspaceName, "研究")
  assert.equal(isAgentArtifactReceipt(receipt), true)
  assert.deepEqual(removals, [])

  const undone = await undoAgentArtifact(receipt, {
    task: taskGateway,
    bookmark: bookmarkGateway,
  })
  assert.ok(undone.undoneAt)
  assert.equal(isAgentArtifactReceipt(undone), true)
  assert.deepEqual(removals, [{ id: "task-1", expected: 20 }])
})

test("agent artifact: failed task content commit cleans only the untouched empty task version", async () => {
  const removals: number[] = []
  await assert.rejects(
    saveAgentResponseAsTask(
      { workspaceId: "ws", workspaceName: "空间", title: "任务", body: "正文" },
      [],
      {
        async create() {
          return { id: "empty", title: "新对话", messages: [], createdAt: 5, updatedAt: 6 }
        },
        async commit() {
          throw new Error("commit failed")
        },
        async remove(_id, expected) {
          removals.push(expected)
        },
      },
    ),
    /commit failed/,
  )
  assert.deepEqual(removals, [6])
})

test("agent artifact: bookmark preview, commit and undo stay bound to actual source versions", async () => {
  const commits: Array<{ id: string; description: string; expected: string }> = []
  const bookmarkGateway = {
    async load(id: string) {
      return {
        nodeId: id,
        title: "参考书签",
        url: "https://example.com",
        description: "旧描述",
        version: "7",
      }
    },
    async commit(id: string, description: string, expected: string) {
      commits.push({ id, description, expected })
      return expected === "7" ? 8 : 9
    },
  }
  const target = await loadAgentBookmarkTarget(bookmarkSource, bookmarkGateway)
  await assert.rejects(loadAgentBookmarkTarget(sources[0], bookmarkGateway), /只能选择/)
  const receipt = await saveAgentResponseToBookmarkDescription(
    { target, description: "旧描述\n\nAI 结论" },
    [...sources, bookmarkSource],
    bookmarkGateway,
  )
  assert.equal(receipt.kind, "bookmark-description")
  if (receipt.kind !== "bookmark-description") assert.fail("expected bookmark receipt")
  assert.equal(receipt.previousDescription, "旧描述")
  assert.equal(receipt.committedVersion, 8)

  const undone = await undoAgentArtifact(receipt, {
    task: {
      async create() {
        throw new Error("unused")
      },
      async commit() {
        throw new Error("unused")
      },
      async remove() {
        throw new Error("unused")
      },
    },
    bookmark: bookmarkGateway,
  })
  assert.equal(undone.undoneAt, 9)
  assert.deepEqual(commits, [
    { id: "b1", description: "旧描述\n\nAI 结论", expected: "7" },
    { id: "b1", description: "旧描述", expected: "8" },
  ])
  assert.equal(
    isAgentArtifactReceipt({
      ...receipt,
      previousDescription: "x".repeat(AGENT_BOOKMARK_DESCRIPTION_LIMIT + 1),
    }),
    false,
  )
})
