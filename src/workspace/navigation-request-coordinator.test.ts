import assert from "node:assert/strict"
import { test } from "node:test"
import { NavigationRequestCoordinator } from "./navigation-request-coordinator"

test("navigation request coordinator: later requests and invalidation make older leases stale", () => {
  const coordinator = new NavigationRequestCoordinator()
  const first = coordinator.begin()
  assert.equal(first.isCurrent(), true)
  const second = coordinator.begin()
  assert.equal(first.isCurrent(), false)
  assert.equal(second.isCurrent(), true)
  coordinator.invalidate()
  assert.equal(second.isCurrent(), false)
  assert.equal(coordinator.currentEpoch(), 3)
})

test("navigation request coordinator: independent channels cannot cancel each other", () => {
  const fileOpen = new NavigationRequestCoordinator()
  const routeOpen = new NavigationRequestCoordinator()
  const fileLease = fileOpen.begin()
  const routeLease = routeOpen.begin()
  routeOpen.invalidate()
  assert.equal(fileLease.isCurrent(), true)
  assert.equal(routeLease.isCurrent(), false)
})
