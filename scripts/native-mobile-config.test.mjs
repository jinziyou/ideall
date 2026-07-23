import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const IOS_PROJECT = new URL(
  "../native/apps/ideall-mobile/platforms/ios/project.yml",
  import.meta.url,
)
const IOS_MAIN = new URL("../native/apps/ideall-mobile/platforms/ios/main.m", import.meta.url)
const ANDROID_APP_BUILD = new URL(
  "../native/apps/ideall-mobile/platforms/android/app/build.gradle.kts",
  import.meta.url,
)
const ANDROID_MANIFEST = new URL(
  "../native/apps/ideall-mobile/platforms/android/app/src/main/AndroidManifest.xml",
  import.meta.url,
)
const ANDROID_PLATFORM_VIEW = new URL(
  "../native/apps/ideall-mobile/platforms/android/app/src/main/java/dev/gpui/mobile/GpuiPlatformView.java",
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

test("iOS 宿主在 UIKit 激活后启动 GPUI 并串行化状态通知", () => {
  const main = readFileSync(IOS_MAIN, "utf8")

  const didFinish = main.slice(
    main.indexOf("didFinishLaunchingWithOptions:"),
    main.indexOf("- (void)installTextInputBridgeIfNeeded"),
  )
  assert.doesNotMatch(didFinish, /gpui_ios_run_demo/)
  assert.match(main, /startGpuiIfNeeded[\s\S]*?gpui_ios_run_demo\(\)/)
  assert.match(main, /IdeallInstallCrashDiagnosticsIfRequested/)
  assert.match(main, /getenv\("IDEALL_CRASH_DIAGNOSTICS"\)/)
  assert.match(main, /gpuiActiveNotificationInProgress/)
  assert.match(main, /gpuiActiveNotificationPending/)
  assert.match(main, /dispatch_async\(dispatch_get_main_queue\(\)/)
  assert.match(main, /applicationDidBecomeActive:[\s\S]*?\[self startGpuiIfNeeded\]/)
  assert.match(
    main,
    /applicationWillResignActive:[\s\S]*?\[self scheduleGpuiApplicationActive:NO\]/,
  )
  assert.doesNotMatch(main, /gpui_ios_will_enter_foreground\(NULL\)/)
  assert.doesNotMatch(main, /gpui_ios_did_enter_background\(NULL\)/)
})

test("Android Rust NDK API 与应用 minSdk 保持一致", () => {
  const appBuild = readFileSync(ANDROID_APP_BUILD, "utf8")
  const buildScript = readFileSync(MOBILE_BUILD_SCRIPT, "utf8")
  const minSdk = appBuild.match(/^\s*minSdk\s*=\s*(\d+)\s*$/m)?.[1]

  assert.ok(minSdk, "Android minSdk must be declared")
  assert.match(buildScript, new RegExp(`--platform\\s+${minSdk}\\b`))
})

test("Android 壳完整承接 GPUI 生命周期与 WebView 平台桥", () => {
  const manifest = readFileSync(ANDROID_MANIFEST, "utf8")
  const platformView = readFileSync(ANDROID_PLATFORM_VIEW, "utf8")
  const configChanges = manifest.match(/android:configChanges="([^"]+)"/)?.[1]?.split("|")

  assert.deepEqual(configChanges, [
    "colorMode",
    "density",
    "fontScale",
    "fontWeightAdjustment",
    "grammaticalGender",
    "keyboard",
    "keyboardHidden",
    "layoutDirection",
    "locale",
    "mcc",
    "mnc",
    "navigation",
    "orientation",
    "screenLayout",
    "screenSize",
    "smallestScreenSize",
    "touchscreen",
    "uiMode",
  ])
  assert.match(platformView, /public static boolean createView\(/)
  assert.match(platformView, /public static void pauseAll\(\)/)
  assert.match(platformView, /public static void resumeAll\(\)/)
  assert.match(platformView, /public static void disposeAll\(\)/)
  assert.match(platformView, /settings\.setAllowFileAccess\(false\)/)
  assert.match(platformView, /settings\.setAllowContentAccess\(false\)/)
})
