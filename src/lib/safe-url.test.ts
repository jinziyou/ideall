// safeHref 是全站「外部/跨用户 URL → <a href>/window.open」前的伪协议白名单单点收口
// (agent-tools / embed bridge / 工具订阅 / cells 外链等共同信任的那道闸)。这里用经典绕过向量
// 锁死它的行为, 守住「javascript:/data: 等伪协议绝不渲染成可点链接」这条防存储型 XSS 的不变量。
import { test } from "node:test"
import assert from "node:assert/strict"

import { safeHref } from "./safe-url"

test("safeHref: 放行 http/https, 原样返回", () => {
  assert.equal(safeHref("https://example.com/x?q=1#h"), "https://example.com/x?q=1#h")
  assert.equal(safeHref("http://127.0.0.1:8000/v1"), "http://127.0.0.1:8000/v1")
})

test("safeHref: 拦截 javascript: 伪协议 (大小写 / 前导空白也拦)", () => {
  assert.equal(safeHref("javascript:alert(1)"), undefined)
  assert.equal(safeHref("JavaScript:alert(document.cookie)"), undefined)
  assert.equal(safeHref("  javascript:alert(1)"), undefined) // URL 会裁前导空白后仍是 javascript:
  assert.equal(safeHref("\tjavascript:alert(1)"), undefined)
})

test("safeHref: 拦截 data: / vbscript: / file: 等非白名单协议", () => {
  assert.equal(safeHref("data:text/html,<script>alert(1)</script>"), undefined)
  assert.equal(safeHref("vbscript:msgbox(1)"), undefined)
  assert.equal(safeHref("file:///etc/passwd"), undefined)
})

test("safeHref: 相对路径 / 非法 / 空 / 非字符串 一律返 undefined", () => {
  assert.equal(safeHref("/home/bookmarks"), undefined) // 相对路径不作外链
  assert.equal(safeHref("not a url"), undefined)
  assert.equal(safeHref(""), undefined)
  assert.equal(safeHref(null), undefined)
  assert.equal(safeHref(undefined), undefined)
})
