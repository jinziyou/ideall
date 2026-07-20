import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import {
  AGENT_CONTEXT_TRAY_LIMIT,
  AGENT_CONTEXT_URL_LIMIT,
  addAgentContextSource,
  clearAgentContextSources,
  getAgentContextSources,
  nodeAgentContextSource,
  removeAgentContextSource,
  subscribeAgentContextSources,
  urlAgentContextSource,
} from "./agent-context-tray"

afterEach(clearAgentContextSources)

test("agent context tray: deduplicates, publishes stable snapshots and removes sources", () => {
  const events: number[] = []
  const dispose = subscribeAgentContextSources(() => events.push(getAgentContextSources().length))
  const source = nodeAgentContextSource("note", "note-1", "Research")

  assert.equal(addAgentContextSource(source), "added")
  const first = getAgentContextSources()
  assert.equal(addAgentContextSource(source), "exists")
  assert.equal(getAgentContextSources(), first)
  removeAgentContextSource(source.key)
  dispose()

  assert.deepEqual(events, [1, 0])
})

test("agent context tray: validates URLs and enforces a bounded explicit selection", () => {
  assert.equal(urlAgentContextSource("javascript:alert(1)", "bad"), null)
  assert.equal(
    urlAgentContextSource(`https://example.com/${"x".repeat(AGENT_CONTEXT_URL_LIMIT)}`, "long"),
    null,
  )
  const link = urlAgentContextSource("https://user:secret@example.com/a", "Article")
  assert.equal(link?.type, "url")
  if (link?.type === "url") assert.equal(link.url, "https://example.com/a")

  for (let index = 0; index < AGENT_CONTEXT_TRAY_LIMIT; index++) {
    assert.equal(
      addAgentContextSource(nodeAgentContextSource("note", String(index), `Note ${index}`)),
      "added",
    )
  }
  assert.equal(
    addAgentContextSource(nodeAgentContextSource("note", "overflow", "Overflow")),
    "full",
  )
})
