import assert from "node:assert/strict"
import { test } from "node:test"
import type { EngineDescriptor } from "@protocol/engine"
import { EngineRegistry } from "@/engines/registry"
import { FileEngineRendererRegistry, type FileEngineRenderer } from "./file-engine-renderer"
import {
  FileEngineRegistrationError,
  registerFileEngineContribution,
} from "./file-engine-registration"

function descriptor(engineId: string): EngineDescriptor {
  return {
    engineId,
    label: "Timeline",
    match: { mediaTypes: ["application/x-timeline"] },
    layout: "fill",
    access: "read-only",
  }
}

test("file engine contribution: register and dispose are paired, observable and idempotent", () => {
  const engines = new EngineRegistry()
  const renderers = new FileEngineRendererRegistry()
  const observations: Array<[boolean, boolean]> = []
  const observe = () =>
    observations.push([
      engines.get("demo.timeline") !== null,
      renderers.get("demo.timeline") !== null,
    ])
  engines.subscribe(observe)
  renderers.subscribe(observe)
  const renderer: FileEngineRenderer = () => "timeline"

  const dispose = registerFileEngineContribution(
    { descriptor: descriptor("demo.timeline"), renderer },
    { engines, renderers },
  )

  assert.equal(engines.get("demo.timeline")?.label, "Timeline")
  assert.equal(renderers.get("demo.timeline"), renderer)
  dispose()
  dispose()
  assert.equal(engines.get("demo.timeline"), null)
  assert.equal(renderers.get("demo.timeline"), null)
  assert.deepEqual(observations, [
    [true, true],
    [true, true],
    [false, false],
    [false, false],
  ])
})

test("file engine contribution: a pre-existing half is rejected without altering either registry", () => {
  const engines = new EngineRegistry()
  const renderers = new FileEngineRendererRegistry()
  const existing = descriptor("demo.timeline")
  engines.register(existing)

  assert.throws(
    () =>
      registerFileEngineContribution(
        { descriptor: existing, renderer: () => null },
        { engines, renderers },
      ),
    (error) =>
      error instanceof FileEngineRegistrationError && error.code === "duplicate-contribution",
  )
  assert.equal(engines.get("demo.timeline")?.engineId, "demo.timeline")
  assert.equal(renderers.get("demo.timeline"), null)
})

test("file engine contribution: second-half failure rolls back before subscribers are notified", () => {
  class FailingRendererRegistry extends FileEngineRendererRegistry {
    override register(engineId: string, renderer: FileEngineRenderer): () => void {
      if (engineId === "demo.failure") throw new Error("renderer failed")
      return super.register(engineId, renderer)
    }
  }

  const engines = new EngineRegistry()
  const renderers = new FailingRendererRegistry()
  const observations: Array<[boolean, boolean]> = []
  engines.subscribe(() =>
    observations.push([
      engines.get("demo.failure") !== null,
      renderers.get("demo.failure") !== null,
    ]),
  )

  assert.throws(
    () =>
      registerFileEngineContribution(
        { descriptor: descriptor("demo.failure"), renderer: () => null },
        { engines, renderers },
      ),
    /renderer failed/,
  )
  assert.equal(engines.get("demo.failure"), null)
  assert.equal(renderers.get("demo.failure"), null)
  assert.deepEqual(observations, [[false, false]])
})
