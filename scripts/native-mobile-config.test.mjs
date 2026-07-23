import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const IOS_PROJECT = new URL(
  "../native/apps/ideall-mobile/platforms/ios/project.yml",
  import.meta.url,
)

test("iOS XcodeGen 工程为模拟器和真机选择对应的 Rust 静态库", () => {
  const project = readFileSync(IOS_PROJECT, "utf8")
  const settingsBlocks = project.match(/^    settings:$/gm) ?? []

  assert.equal(settingsBlocks.length, 1, "target must have exactly one settings block")
  assert.match(
    project,
    /^        "IDEALL_STATIC_LIB\[sdk=iphonesimulator\*\]": .*aarch64-apple-ios-sim/m,
  )
  assert.match(project, /^        "IDEALL_STATIC_LIB\[sdk=iphoneos\*\]": .*aarch64-apple-ios\//m)
  assert.doesNotMatch(project, /^      settings:$/m, "build settings must not be nested")
})
