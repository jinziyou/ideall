import assert from "node:assert/strict"
import { test } from "node:test"
import { WORKSPACE_STATIC_PATHS, workspaceStaticParams } from "./static-routes"

test("workspace static routes: paths are unique, relative and emitted as catch-all params", () => {
  assert.equal(new Set(WORKSPACE_STATIC_PATHS).size, WORKSPACE_STATIC_PATHS.length)
  assert.ok(WORKSPACE_STATIC_PATHS.every((path) => path.length > 0 && !path.startsWith("/")))
  assert.deepEqual(
    workspaceStaticParams().map(({ path }) => path.join("/")),
    WORKSPACE_STATIC_PATHS,
  )
})

test("workspace static routes: retain current navigation and resource deep links", () => {
  const paths = new Set<string>(WORKSPACE_STATIC_PATHS)
  for (const path of [
    "home",
    "home/notes",
    "home/following",
    "home/resources",
    "activity/spaces",
    "activity/tasks",
    "activity/deleted",
    "apps/local-apps",
    "settings/basic",
    "settings/ai",
    "community/publication",
    "code",
  ]) {
    assert.ok(paths.has(path), path)
  }
  assert.equal(paths.has("home/agent"), false, "AI 入口应直接打开右侧面板，不再维护虚拟路由")
})
