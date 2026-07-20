import assert from "node:assert/strict"
import { test } from "node:test"
import {
  FILES_UPDATED,
  SUBSCRIPTIONS_SYNCED,
  notifyFilesUpdated,
  onFilesUpdated,
  type FilesUpdate,
} from "./flowback"

class BroadcastChannelMock extends EventTarget {
  static instances: BroadcastChannelMock[] = []

  readonly posted: unknown[] = []
  closed = false
  closeCalls = 0

  constructor(readonly name: string) {
    super()
    BroadcastChannelMock.instances.push(this)
  }

  postMessage(value: unknown) {
    this.posted.push(value)
  }

  close() {
    this.closeCalls++
    this.closed = true
  }

  receive(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: value }))
  }
}

function withWindow<T>(run: (target: EventTarget, channels: typeof BroadcastChannelMock) => T): T {
  const previous = globalThis.window
  BroadcastChannelMock.instances = []
  const target = new EventTarget()
  Object.defineProperty(target, "BroadcastChannel", {
    value: BroadcastChannelMock,
    configurable: true,
  })
  Object.defineProperty(globalThis, "window", { value: target, configurable: true })
  try {
    return run(target, BroadcastChannelMock)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window")
    else Object.defineProperty(globalThis, "window", { value: previous, configurable: true })
  }
}

test("flowback: keeps same-window events and broadcasts only sanitized invalidation data", () => {
  withWindow((target, channels) => {
    let local: FilesUpdate | undefined
    target.addEventListener(FILES_UPDATED, (event) => {
      local = (event as CustomEvent<FilesUpdate>).detail
    })

    notifyFilesUpdated({
      kind: "note",
      id: "n1",
      subType: "document",
      secret: "must-not-cross-windows",
    } as FilesUpdate & { secret: string })

    assert.deepEqual(local, { kind: "note", id: "n1", subType: "document" })
    assert.equal(channels.instances.length, 1)
    const publisher = channels.instances[0]
    assert.equal(publisher.name, "ideall:files-updated:v1")
    assert.equal(publisher.closed, true)
    assert.equal(publisher.posted.length, 1)
    const payload = publisher.posted[0] as { sender: unknown; detail: unknown }
    assert.deepEqual(Object.keys(payload).sort(), ["detail", "sender"])
    assert.equal(typeof payload.sender, "string")
    assert.deepEqual(payload.detail, { kind: "note", id: "n1", subType: "document" })
  })
})

test("flowback: receives validated cross-window updates without echoing its own sender", () => {
  withWindow((target, channels) => {
    const received: Array<FilesUpdate | undefined> = []
    const dispose = onFilesUpdated((detail) => received.push(detail))
    const listener = channels.instances[0]

    notifyFilesUpdated({ kind: "note", id: "n1" })
    assert.deepEqual(received, [{ kind: "note", id: "n1" }])
    const ownSender = (channels.instances[1].posted[0] as { sender: string }).sender
    listener.receive({ sender: ownSender, detail: { kind: "note", id: "n1" } })
    assert.equal(received.length, 1)

    listener.receive({ sender: "another-window", detail: { kind: "thread", id: "t1" } })
    assert.deepEqual(received[1], { kind: "thread", id: "t1" })

    target.dispatchEvent(new CustomEvent(SUBSCRIPTIONS_SYNCED, { detail: { kind: "feed" } }))
    assert.deepEqual(received[2], { kind: "feed" })
    dispose()
  })
})

test("flowback: rejects malformed or data-bearing broadcast payloads", () => {
  withWindow((_target, channels) => {
    const received: Array<FilesUpdate | undefined> = []
    const dispose = onFilesUpdated((detail) => received.push(detail))
    const listener = channels.instances[0]

    for (const value of [
      null,
      {},
      { sender: "", detail: {} },
      { sender: "other", detail: null },
      { sender: "other", detail: [] },
      { sender: "other", detail: { kind: 1 } },
      { sender: "other", detail: { kind: undefined } },
      { sender: "other", detail: { kind: "note", content: "private" } },
      { sender: "other", detail: {}, content: "private" },
    ]) {
      listener.receive(value)
    }

    assert.deepEqual(received, [])
    listener.receive({ sender: "other", detail: {} })
    listener.receive({ sender: "other", detail: { subType: "entity" } })
    assert.deepEqual(received, [{}, { subType: "entity" }])
    dispose()
  })
})

test("flowback: dispose removes local and broadcast listeners and closes once", () => {
  withWindow((target, channels) => {
    let count = 0
    const dispose = onFilesUpdated(() => count++)
    const listener = channels.instances[0]

    dispose()
    dispose()
    assert.equal(listener.closed, true)
    assert.equal(listener.closeCalls, 1)
    target.dispatchEvent(new CustomEvent(FILES_UPDATED, { detail: {} }))
    listener.receive({ sender: "other", detail: {} })
    assert.equal(count, 0)
  })
})

test("flowback: SSR and unavailable or failing BroadcastChannel implementations are safe", () => {
  const previous = globalThis.window
  Reflect.deleteProperty(globalThis, "window")
  try {
    assert.doesNotThrow(() => notifyFilesUpdated({ kind: "note" }))
    assert.doesNotThrow(() => onFilesUpdated(() => {})())
  } finally {
    if (previous !== undefined) {
      Object.defineProperty(globalThis, "window", { value: previous, configurable: true })
    }
  }

  const target = new EventTarget()
  Object.defineProperty(target, "BroadcastChannel", {
    value: class {
      constructor() {
        throw new Error("unavailable")
      }
    },
  })
  Object.defineProperty(globalThis, "window", { value: target, configurable: true })
  try {
    let count = 0
    const dispose = onFilesUpdated(() => count++)
    assert.doesNotThrow(() => notifyFilesUpdated({ kind: "note" }))
    assert.equal(count, 1)
    assert.doesNotThrow(dispose)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window")
    else Object.defineProperty(globalThis, "window", { value: previous, configurable: true })
  }
})
