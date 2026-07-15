import assert from "node:assert/strict"
import test from "node:test"
import { tabRevealDelta, tabScrollBehavior } from "./tab-scroll"

test("tabRevealDelta only moves tabs clipped outside the horizontal viewport", () => {
  const viewport = { left: 100, right: 300 }

  assert.equal(tabRevealDelta({ left: 120, right: 240 }, viewport), 0)
  assert.equal(tabRevealDelta({ left: 100, right: 300 }, viewport), 0)
  assert.equal(tabRevealDelta({ left: 80, right: 180 }, viewport), -20)
  assert.equal(tabRevealDelta({ left: 240, right: 325 }, viewport), 25)
  assert.equal(tabRevealDelta({ left: 99.5, right: 250 }, viewport), 0)
})

test("tabScrollBehavior honors reduced motion", () => {
  assert.equal(tabScrollBehavior(false), "smooth")
  assert.equal(tabScrollBehavior(true), "auto")
})
