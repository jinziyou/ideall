import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const IOS_PROJECT = new URL(
  "../native/apps/ideall-mobile/platforms/ios/project.yml",
  import.meta.url,
)
const ANDROID_APP_BUILD = new URL(
  "../native/apps/ideall-mobile/platforms/android/app/build.gradle.kts",
  import.meta.url,
)
const MOBILE_BUILD_SCRIPT = new URL("../native/apps/ideall-mobile/build-mobile.sh", import.meta.url)

test("iOS XcodeGen 工程为模拟器和真机选择对应的 Rust 静态库", () => {
  const project = readFileSync(IOS_PROJECT, "utf8")
  const buildScript = readFileSync(MOBILE_BUILD_SCRIPT, "utf8")
  const settingsBlocks = project.match(/^    settings:$/gm) ?? []
  const deploymentTarget = project.match(/^\s*iOS:\s*"([^"]+)"\s*$/m)?.[1]

  assert.equal(settingsBlocks.length, 1, "target must have exactly one settings block")
  assert.ok(deploymentTarget, "iOS deployment target must be declared")
  assert.ok(
    buildScript.includes(
      `IPHONEOS_DEPLOYMENT_TARGET="\${IPHONEOS_DEPLOYMENT_TARGET:-${deploymentTarget}}"`,
    ),
    "Rust and Xcode must use the same iOS deployment target",
  )
  assert.match(
    project,
    /^        "IDEALL_STATIC_LIB\[sdk=iphonesimulator\*\]": .*aarch64-apple-ios-sim/m,
  )
  assert.match(project, /^        "IDEALL_STATIC_LIB\[sdk=iphoneos\*\]": .*aarch64-apple-ios\//m)
  assert.match(project, /^          - -framework CoreMedia$/m)
  assert.match(project, /^          - -framework AVFoundation$/m)
  assert.doesNotMatch(project, /^      settings:$/m, "build settings must not be nested")
})

test("Android Rust NDK API 与应用 minSdk 保持一致", () => {
  const appBuild = readFileSync(ANDROID_APP_BUILD, "utf8")
  const buildScript = readFileSync(MOBILE_BUILD_SCRIPT, "utf8")
  const minSdk = appBuild.match(/^\s*minSdk\s*=\s*(\d+)\s*$/m)?.[1]

  assert.ok(minSdk, "Android minSdk must be declared")
  assert.match(buildScript, new RegExp(`--platform\\s+${minSdk}\\b`))
})
