import assert from "node:assert/strict"
import { test } from "node:test"
import { createPluginMutationInvalidationChannel } from "./plugin-mutation-channel"

class BroadcastChannelMock extends EventTarget {
  static instances: BroadcastChannelMock[] = []

  readonly posted: unknown[] = []
  closed = false

  constructor(readonly name: string) {
    super()
    BroadcastChannelMock.instances.push(this)
  }

  postMessage(value: unknown): void {
    this.posted.push(value)
  }

  close(): void {
    this.closed = true
  }

  receive(value: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: value }))
  }
}

function withWindow<T>(run: (channels: typeof BroadcastChannelMock) => T): T {
  const previous = globalThis.window
  BroadcastChannelMock.instances = []
  const target = new EventTarget()
  Object.defineProperty(target, "BroadcastChannel", {
    value: BroadcastChannelMock,
    configurable: true,
  })
  Object.defineProperty(globalThis, "window", { value: target, configurable: true })
  try {
    return run(BroadcastChannelMock)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window")
    else Object.defineProperty(globalThis, "window", { value: previous, configurable: true })
  }
}

test("plugin mutation channel: same-window delivery is single and broadcast payload is minimal", () => {
  withWindow((channels) => {
    const channel = createPluginMutationInvalidationChannel("app.audio-library")
    const sources: string[] = []
    const dispose = channel.subscribe((source) => sources.push(source))

    channel.publish()

    assert.deepEqual(sources, ["local"])
    assert.equal(channels.instances.length, 1)
    const publisher = channels.instances[0]
    assert.equal(publisher.name, "ideall:plugin-mutation:v1")
    assert.equal(publisher.closed, false)
    const payload = publisher.posted[0] as Record<string, unknown>
    assert.deepEqual(Object.keys(payload).sort(), ["fileSystemId", "sender"])
    assert.equal(payload.fileSystemId, "app.audio-library")
    assert.equal(typeof payload.sender, "string")

    // 浏览器会把同一 realm 的发送投递给其它 channel 实例；sender 去重保证同窗口只通知一次。
    channels.instances[0].receive(payload)
    assert.deepEqual(sources, ["local"])
    dispose()
    assert.equal(publisher.closed, true)
  })
})

test("plugin mutation channel: accepts matching external invalidations and rejects malformed scope", () => {
  withWindow((channels) => {
    const channel = createPluginMutationInvalidationChannel("app.database")
    const sources: string[] = []
    const dispose = channel.subscribe((source) => sources.push(source))
    const receiver = channels.instances[0]

    for (const value of [
      null,
      {},
      { sender: "other", fileSystemId: "app.audio-library" },
      { sender: "other", fileSystemId: "app.database", content: "private" },
      { sender: "", fileSystemId: "app.database" },
    ]) {
      receiver.receive(value)
    }
    assert.deepEqual(sources, [])

    receiver.receive({ sender: "another-window", fileSystemId: "app.database" })
    assert.deepEqual(sources, ["broadcast"])
    dispose()
    receiver.receive({ sender: "another-window", fileSystemId: "app.database" })
    assert.deepEqual(sources, ["broadcast"])
    assert.equal(receiver.closed, true)
  })
})

test("plugin mutation channel: all scopes and watchers share one receiver transport", () => {
  withWindow((channels) => {
    const audio = createPluginMutationInvalidationChannel("app.audio-library")
    const database = createPluginMutationInvalidationChannel("app.database")
    const first = audio.subscribe(() => undefined)
    const second = audio.subscribe(() => undefined)
    const third = database.subscribe(() => undefined)

    assert.equal(channels.instances.length, 1)
    const receiver = channels.instances[0]
    first()
    second()
    assert.equal(receiver.closed, false)
    third()
    assert.equal(receiver.closed, true)
  })
})

test("plugin mutation channel: SSR and unavailable BroadcastChannel keep local delivery", () => {
  const previous = globalThis.window
  Reflect.deleteProperty(globalThis, "window")
  try {
    const channel = createPluginMutationInvalidationChannel("app.git-repositories")
    const sources: string[] = []
    const dispose = channel.subscribe((source) => sources.push(source))
    assert.doesNotThrow(() => channel.publish())
    assert.deepEqual(sources, ["local"])
    dispose()
  } finally {
    if (previous !== undefined) {
      Object.defineProperty(globalThis, "window", { value: previous, configurable: true })
    }
  }
})
