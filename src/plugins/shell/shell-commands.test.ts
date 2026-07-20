import { test } from "node:test"
import assert from "node:assert/strict"
import { defaultShell, normalizeShellOptions } from "./shell-commands"

test("defaultShell: 按 userAgent 选择默认 shell", () => {
  assert.deepEqual(defaultShell("Mozilla/5.0 Windows NT"), {
    program: "powershell",
    args: ["-Command"],
  })
  assert.deepEqual(defaultShell("Mozilla/5.0 X11 Linux"), { program: "bash", args: ["-c"] })
  assert.deepEqual(defaultShell(""), { program: "bash", args: ["-c"] })
})

test("normalizeShellOptions: trim cwd 并保持空选项兼容", () => {
  assert.equal(normalizeShellOptions(), undefined)
  assert.equal(normalizeShellOptions({ cwd: "   " }), undefined)
  assert.deepEqual(normalizeShellOptions({ cwd: " /tmp/workspace " }), { cwd: "/tmp/workspace" })
})
