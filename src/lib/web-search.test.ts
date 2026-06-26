// web-search lib 叶子单测 (node:test + tsx): egress 守卫、HTML→文本、截断、内容类型闸、级联兜底。
// resolveFetch 在非 Tauri (node) 回退 globalThis.fetch, 故 stub 之即可驱动; 不触真实网络。
import { test } from "node:test"
import assert from "node:assert/strict"
import { webFetch, webSearch, WebError } from "./web-search"

async function withFetch(impl: typeof fetch, fn: () => Promise<void>) {
  const real = globalThis.fetch
  globalThis.fetch = impl
  try {
    await fn()
  } finally {
    globalThis.fetch = real
  }
}

const html =
  (body: string, ct = "text/html") =>
  async () =>
    new Response(body, { status: 200, headers: { "content-type": ct } })

function reason(e: unknown): string {
  return e instanceof WebError ? e.reason : `非 WebError: ${String(e)}`
}

// ── webFetch: 解析 ─────────────────────────────────────────────────────────────────────────
test("webFetch: 取标题 + 剥 script/style + 块级转行", async () => {
  await withFetch(
    html(
      "<html><head><title>标题 A</title><style>.x{}</style></head><body><h1>大标题</h1><p>第一段</p><script>evil()</script><p>第二段</p></body></html>",
    ),
    async () => {
      const r = await webFetch("https://example.com")
      assert.equal(r.title, "标题 A")
      assert.ok(r.text.includes("第一段") && r.text.includes("第二段"))
      assert.ok(!r.text.includes("evil()"), "剥 script")
      assert.ok(!r.text.includes(".x{}"), "剥 style")
      assert.equal(r.truncated, false)
    },
  )
})

test("webFetch: 超 maxChars → 截断且 truncated=true", async () => {
  await withFetch(html("x".repeat(500), "text/plain"), async () => {
    const r = await webFetch("https://example.com", 200)
    assert.equal(r.text.length, 200)
    assert.equal(r.truncated, true)
  })
})

test("webFetch: 非可读内容类型 (image/png) → unsupported-content-type", async () => {
  await withFetch(html("\x89PNG", "image/png"), async () => {
    await assert.rejects(webFetch("https://example.com/a.png"), (e) =>
      reason(e) === "unsupported-content-type" ? true : false,
    )
  })
})

test("webFetch: Content-Length 超体积上限 → content-too-large", async () => {
  await withFetch(
    async () =>
      new Response("<html><body>big</body></html>", {
        status: 200,
        headers: { "content-type": "text/html", "content-length": String(9_000_000) },
      }),
    async () => {
      await assert.rejects(
        webFetch("https://example.com"),
        (e) => reason(e) === "content-too-large",
      )
    },
  )
})

// ── egress 守卫: 出站前拦截, 绝不发起请求 ────────────────────────────────────────────────────────
test("egress 守卫: 协议/私网/端口/userinfo/非法 URL 一律拦, 不发 fetch", async () => {
  const cases: [string, string][] = [
    ["http://example.com", "blocked-protocol"], // 明文 http 对 agent 一律拒
    ["javascript:alert(1)", "blocked-protocol"],
    ["https://127.0.0.1/", "blocked-host"], // 环回
    ["https://10.1.2.3/", "blocked-host"], // 10/8
    ["https://192.168.1.1/", "blocked-host"], // 192.168/16
    ["https://169.254.169.254/latest/meta-data/", "blocked-host"], // 云元数据
    ["https://172.16.5.5/", "blocked-host"], // 172.16/12
    ["https://[::1]/", "blocked-host"], // IPv6 环回
    ["https://[fd00::1]/", "blocked-host"], // ULA
    ["https://[fe80::1]/", "blocked-host"], // link-local
    // IPv4-mapped IPv6: new URL 归一化成 16 进制 (::ffff:7f00:1 等), 必须按字节解回 IPv4 拦截 (红队确认的 SSRF 绕过)。
    ["https://[::ffff:127.0.0.1]/", "blocked-host"], // → ::ffff:7f00:1 环回
    ["https://[::ffff:169.254.169.254]/latest/meta-data/", "blocked-host"], // → 云元数据
    ["https://[::ffff:10.0.0.1]/", "blocked-host"], // → 私网 10/8
    ["https://[::ffff:192.168.1.1]/", "blocked-host"], // → 私网 192.168/16
    ["https://[::127.0.0.1]/", "blocked-host"], // IPv4-compatible (废弃) → ::7f00:1
    ["https://localhost/", "blocked-host"], // 名字面
    ["https://foo.internal/", "blocked-host"],
    ["https://user:pass@example.com/", "blocked-host"], // 带 userinfo
    ["https://example.com:8080/", "blocked-port"], // 非 443
    ["not a url", "invalid-url"],
  ]
  let called = false
  await withFetch(
    async () => {
      called = true
      return new Response("", { status: 200 })
    },
    async () => {
      for (const [url, want] of cases) {
        await assert.rejects(webFetch(url), (e) => reason(e) === want, `${url} 应 ${want}`)
      }
    },
  )
  assert.equal(called, false, "所有被拦 URL 都不应发起 fetch")
})

test("egress 守卫: 重定向到内网 → 逐跳复检拦下", async () => {
  await withFetch(
    async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } }),
    async () => {
      await assert.rejects(webFetch("https://example.com"), (e) => reason(e) === "blocked-host")
    },
  )
})

// ── webSearch: 级联 ────────────────────────────────────────────────────────────────────────
test("webSearch: DDG HTML → 解出结果 + 解开 uddg 重定向", async () => {
  const ddg = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fp&amp;rut=x">标题甲</a><a class="result__snippet" href="#">摘要甲</a></div>`
  await withFetch(html(ddg), async () => {
    const r = await webSearch("甲", 3)
    assert.equal(r.engine, "duckduckgo")
    assert.equal(r.results[0].url, "https://a.example/p")
    assert.equal(r.results[0].title, "标题甲")
    assert.equal(r.results[0].snippet, "摘要甲")
  })
})

test("webSearch: DDG 限流(202) → 级联到即时答案 JSON", async () => {
  await withFetch(
    async (input) => {
      const url = String(input)
      if (url.startsWith("https://html.duckduckgo.com")) return new Response("", { status: 202 })
      if (url.startsWith("https://api.duckduckgo.com")) {
        return new Response(
          JSON.stringify({
            Heading: "条目乙",
            AbstractText: "乙的摘要",
            AbstractURL: "https://b.example/wiki",
            RelatedTopics: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      return new Response("", { status: 500 })
    },
    async () => {
      const r = await webSearch("乙")
      assert.equal(r.engine, "duckduckgo-ia")
      assert.equal(r.results[0].url, "https://b.example/wiki")
      assert.equal(r.results[0].title, "条目乙")
    },
  )
})

test("webSearch: 全级联失败 → engine=none + 非致命 note + 兜底 serpUrl", async () => {
  await withFetch(
    async () => new Response("", { status: 500 }),
    async () => {
      const r = await webSearch("丙")
      assert.equal(r.engine, "none")
      assert.equal(r.results.length, 0)
      assert.ok(r.note && r.serpUrl?.startsWith("https://duckduckgo.com/?q="))
    },
  )
})

test("webSearch: 空查询 → empty-query", async () => {
  await assert.rejects(webSearch("   "), (e) => reason(e) === "empty-query")
})
