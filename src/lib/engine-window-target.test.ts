import { test } from "node:test"
import assert from "node:assert/strict"

import {
  assertEngineWindowTarget,
  buildEngineWindowLabel,
  buildEngineWindowUrl,
  normalizeEngineWindowPathname,
  parseEngineWindowUrl,
} from "./engine-window-target"

test("engine window URL: round-trips opaque file keys and the selected engine", () => {
  const url = buildEngineWindowUrl(
    { fileKey: "local:notes/你好 ?#", engineId: "builtin.code-preview" },
    "/home/notes/",
  )
  assert.equal(
    url,
    "/home/notes?file=local%3Anotes%2F%E4%BD%A0%E5%A5%BD+%3F%23&engine=builtin.code-preview&display=window",
  )
  assert.deepEqual(parseEngineWindowUrl(url), {
    pathname: "/home/notes",
    fileKey: "local:notes/你好 ?#",
    engineId: "builtin.code-preview",
    display: "window",
  })
})

test("engine window pathname: keeps local workspace routes and falls back from unsafe routes", () => {
  assert.equal(normalizeEngineWindowPathname("/info/analysis"), "/info/analysis")
  assert.equal(normalizeEngineWindowPathname("/home/notes///"), "/home/notes")
  for (const pathname of [
    undefined,
    null,
    "",
    "/",
    "/auth",
    "/auth/login",
    "//evil.test",
    "/../x",
    "/a?x=1",
  ]) {
    assert.equal(normalizeEngineWindowPathname(pathname), "/home")
  }
})

test("engine window target: rejects empty, control-bearing, oversized and malformed IDs", () => {
  for (const fileKey of [
    "",
    "   ",
    "local:\u0000secret",
    "local:\ufffd",
    "x".repeat(2_049),
    "bad\ud800",
  ]) {
    assert.throws(() => assertEngineWindowTarget({ fileKey, engineId: "preview" }), /文件引用/)
  }
  for (const engineId of ["", ".preview", "preview/other", "preview?x=1", "x".repeat(129)]) {
    assert.throws(() => assertEngineWindowTarget({ fileKey: "local:file-1", engineId }), /引擎标识/)
  }
})

test("engine window URL: rejects origins, fragments and query smuggling", () => {
  for (const url of [
    "https://evil.test/home?file=x&engine=preview&display=window",
    "//evil.test/home?file=x&engine=preview&display=window",
    "/home?file=x&engine=preview&display=window#fragment",
    "/home?file=x&file=y&engine=preview&display=window",
    "/home?file=x&engine=preview&display=window&extra=1",
    "/home?file=x&engine=preview&display=tab",
    "/auth?file=x&engine=preview&display=window",
  ]) {
    assert.throws(() => parseEngineWindowUrl(url))
  }
})

test("engine window label: is Tauri-safe, opaque and unique per nonce", () => {
  const target = { fileKey: "local:private-file", engineId: "builtin.preview" }
  const first = buildEngineWindowLabel(target, "00112233-4455-6677-8899-aabbccddeeff")
  const second = buildEngineWindowLabel(target, "ffeeddcc-bbaa-9988-7766-554433221100")
  assert.match(first, /^engine-[a-z0-9]+-[a-f0-9]{32}$/)
  assert.notEqual(first, second)
  assert.equal(first.includes("private-file"), false)
  assert.throws(() => buildEngineWindowLabel(target, "guessable"), /nonce/)
})
