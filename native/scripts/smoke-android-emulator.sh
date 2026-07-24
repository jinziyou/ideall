#!/usr/bin/env bash
set -euo pipefail

apk_path="${1:-}"
package_name="com.jinziyou.ideall"
activity_name="${package_name}/com.jinziyou.ideall.IdeallNativeActivity"
screenshot_path="${RUNNER_TEMP:-/tmp}/ideall-android-smoke.png"

[[ -n "${apk_path}" && -f "${apk_path}" ]] || {
  echo "usage: $0 <debug-apk>" >&2
  exit 2
}
command -v adb >/dev/null || {
  echo "adb is required" >&2
  exit 1
}

assert_running() {
  adb shell pidof "${package_name}" | grep -E '[0-9]+' >/dev/null || {
    adb logcat -d -b all |
      grep -E -C 80 'com\.jinziyou\.ideall|ideall_mobile|must construct App' || true
    exit 1
  }
  adb shell dumpsys activity activities |
    grep -E "(mResumedActivity|topResumedActivity).*${package_name}" >/dev/null
  ! adb logcat -d -b crash |
    grep -E "${package_name}|ideall_mobile" >/dev/null
}

wait_for_accessible_input() {
  local label="$1"
  local attempt
  for attempt in {1..20}; do
    adb shell uiautomator dump /sdcard/ideall-window.xml >/dev/null 2>&1 || true
    if adb shell cat /sdcard/ideall-window.xml 2>/dev/null |
      grep -F "content-desc=\"${label}\"" |
      grep -F 'focused="true"' >/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "timed out waiting for focused Android input: ${label}" >&2
  adb shell cat /sdcard/ideall-window.xml 2>/dev/null || true
  return 1
}

screen_size="$(
  adb shell wm size |
    sed -n 's/.*Physical size: \([0-9][0-9]*x[0-9][0-9]*\).*/\1/p' |
    tail -1
)"
[[ "${screen_size}" =~ ^([0-9]+)x([0-9]+)$ ]] || {
  echo "unable to resolve emulator screen size: ${screen_size}" >&2
  exit 1
}
screen_width="${BASH_REMATCH[1]}"
screen_height="${BASH_REMATCH[2]}"

adb logcat -c
adb install -r "${apk_path}"
adb shell am start -W -n "${activity_name}"
sleep 5
assert_running

# Create a note, then prove that GPUI focus reaches the real Android EditText
# bridge and accepts text for both single-line and multiline fields.
adb shell input tap "$((screen_width * 87 / 100))" "$((screen_height * 7 / 100))"
sleep 2
adb shell input tap "$((screen_width * 50 / 100))" "$((screen_height * 11 / 100))"
wait_for_accessible_input "标题"
adb shell input text "ideall-android-smoke-title"
adb shell input keyevent KEYCODE_BACK

adb shell input tap "$((screen_width * 50 / 100))" "$((screen_height * 44 / 100))"
wait_for_accessible_input "正文"
adb shell input text "ideall-android-smoke-body"
adb shell input keyevent KEYCODE_BACK
adb shell input swipe \
  "$((screen_width * 50 / 100))" \
  "$((screen_height * 70 / 100))" \
  "$((screen_width * 50 / 100))" \
  "$((screen_height * 30 / 100))" \
  350
assert_running

# Exercise configuration changes plus background/foreground delivery without
# allowing Android to silently recreate a crashed process.
initial_pid="$(adb shell pidof "${package_name}" | tr -d '\r')"
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 3
assert_running
[[ "$(adb shell pidof "${package_name}" | tr -d '\r')" == "${initial_pid}" ]] || {
  echo "Android process restarted during rotation" >&2
  exit 1
}

adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell pidof "${package_name}" | grep -E '[0-9]+' >/dev/null
adb shell am start -W -n "${activity_name}"
sleep 3
assert_running
[[ "$(adb shell pidof "${package_name}" | tr -d '\r')" == "${initial_pid}" ]] || {
  echo "Android process restarted during background resume" >&2
  exit 1
}

adb shell settings put system user_rotation 0
adb shell screencap -p /sdcard/ideall-android-smoke.png
adb pull /sdcard/ideall-android-smoke.png "${screenshot_path}" >/dev/null
[[ -s "${screenshot_path}" ]] || {
  echo "Android smoke screenshot is empty" >&2
  exit 1
}
echo "Android interactive smoke passed; screenshot: ${screenshot_path}"
