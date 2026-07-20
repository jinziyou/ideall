import { afterEach, test } from "node:test"
import assert from "node:assert/strict"

import {
  articleIdV2,
  canonicalArticleUrl,
  httpServerAdapter,
  looksLikeMillis,
  normalizeCurrentUser,
} from "./http-adapter"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

type FakeResponse = { ok: boolean; status: number; text: () => Promise<string> }
type FetchCall = { input: string; init: RequestInit }

function jsonResponse(body: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

function emptyResponse(status = 204): FakeResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => "" }
}

function installFetch(
  handler: (call: FetchCall) => FakeResponse | Promise<FakeResponse>,
): FetchCall[] {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { input: String(input), init }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
  return calls
}

function meta(overrides: Partial<{ has_more: boolean; next_cursor: string | null }> = {}) {
  return { generated_at_ms: 1_700_000_000_000, has_more: false, ...overrides }
}

function envelope<T>(data: T, metaOverrides?: Parameters<typeof meta>[0]) {
  return { data, meta: meta(metaOverrides) }
}

function v2Article(index = 0) {
  return {
    article_id: `a:${String(index).padStart(64, "0")}`,
    revision_id: `r:${String(index).padStart(64, "0")}`,
    version_ms: 1_700_000_000_000 + index,
    canonical_url: `https://example.test/articles/${index}`,
    title: `Article ${index}`,
    body: `Body ${index}`,
    language: "zh",
    publisher_id: `p:${"2".repeat(64)}`,
    publisher_domain: "example.test",
    source_id: "source:test",
    source_category: "news",
    platform_type: "website",
    publisher_country: "CN",
    published_at_ms: 1_700_000_000_000 + index,
    collected_at_ms: 1_700_000_100_000 + index,
    topics: [],
    geo_scope: [],
    entities: [
      {
        entity_id: `e:${"3".repeat(64)}`,
        label: "ORG",
        qid: "Q42",
        canonical_name: "Example Org",
        surface: "示例组织",
        confidence: 0.9,
      },
    ],
    enclosures: [],
  }
}

test("normalizeCurrentUser: V2 claims 映射稳定 account_id 并在领域边界补 avatar", () => {
  assert.deepEqual(
    normalizeCurrentUser({
      account_id: `u:${"7".repeat(32)}`,
      email: "user@example.test",
      display_name: "User",
    }),
    {
      id: `u:${"7".repeat(32)}`,
      email: "user@example.test",
      name: "User",
      avatar: null,
    },
  )
})

test("articleIdV2: URL 规范化与 wonita 稳定 ID golden fixture 一致", async () => {
  const fixtures = [
    {
      input: "HTTPS://EXAMPLE.COM:443/article#fragment",
      canonical: "https://example.com/article",
      id: "a:632538290468e7a39c06323c9e3ae98f31072d641cbb37ea37917f56bbeb5539",
    },
    {
      input: " HTTPS://例子.测试:443/a?q=1#fragment ",
      canonical: "https://xn--fsqu00a.xn--0zwm56d/a?q=1",
      id: "a:11002792873b053b9f76952958586579714469863282ab37c97f48e809f47de5",
    },
    {
      input: "http://example.com",
      canonical: "http://example.com/",
      id: "a:2a1b402420ef46577471cdc7409b0fa2c6a204db316e59ade2d805435489a067",
    },
  ]
  for (const fixture of fixtures) {
    assert.equal(canonicalArticleUrl(fixture.input), fixture.canonical)
    assert.equal(await articleIdV2(fixture.input), fixture.id)
  }
  assert.throws(() => canonicalArticleUrl("ftp://example.com/file"), /http\(s\)/)
  assert.throws(() => canonicalArticleUrl("https://user:secret@example.com/"), /凭证/)
})

test("queryInfo: 通过公开 catalog 解析发布者/实体，匿名直连 V2 corpus 并映射 DTO", async () => {
  const publisherId = `p:${"2".repeat(64)}`
  const entityId = `e:${"3".repeat(64)}`
  const calls = installFetch(({ input }) => {
    const url = new URL(input)
    if (url.pathname === "/v2/data/catalog/publishers") {
      return jsonResponse(
        envelope([
          {
            publisher_id: publisherId,
            domain: "example.test",
            name: "Example",
            country: "CN",
            city: "",
            category: "news",
            latitude: null,
            longitude: null,
            article_count: 1,
            latest_published_at_ms: 1_700_000_000_000,
          },
        ]),
      )
    }
    if (url.pathname === "/v2/data/graph/entities") {
      return jsonResponse(
        envelope([
          {
            entity_id: entityId,
            label: "ORG",
            qid: "Q42",
            canonical_name: "Example Org",
            display_name: "示例组织",
            has_entry: true,
            wikipedia_url: "https://example.test/wiki",
            description: null,
            updated_at_ms: 1_700_000_000_000,
          },
        ]),
      )
    }
    assert.equal(url.pathname, "/v2/data/corpus/articles/query")
    return jsonResponse(envelope([v2Article()]))
  })

  const result = await httpServerAdapter.queryInfo({
    publisher_domain: "Example.Test.",
    entity_label_name: [["org", "示例组织"]],
    timestamp_from_to: [1_699_000_000_000, 1_701_000_000_000],
    page_size_offset: [20, 0],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.ok && result.data?.[0], {
    url: "https://example.test/articles/0",
    title: "Article 0",
    data: "Body 0",
    language: "zh",
    labels: [
      {
        label: "ORG",
        name: "示例组织",
        period: Date.UTC(2023, 10, 13),
        has_entry: false,
        wikipedia_url: null,
      },
    ],
    publisher: {
      domain: "example.test",
      name: "example.test",
      period: Date.UTC(2023, 10, 1),
    },
    collect_time: 1_700_000_100_000,
    publish_time: 1_700_000_000_000,
  })
  const queryCall = calls.at(-1)!
  assert.deepEqual(JSON.parse(String(queryCall.init.body)), {
    from_ms: 1_699_000_000_000,
    to_ms: 1_701_000_000_000,
    publisher_id: publisherId,
    entity_ids: [entityId],
    limit: 20,
  })
  assert.equal((queryCall.init.headers as Record<string, string>).Authorization, undefined)
  assert.equal(
    calls.every((call) => new URL(call.input).pathname.startsWith("/v2/data/")),
    true,
  )
})

test("queryInfo: 匿名 limit 固定为 50，通过 cursor 保留绝对 offset 语义", async () => {
  const calls = installFetch(({ init }) => {
    const body = JSON.parse(String(init.body)) as { cursor?: string }
    return body.cursor
      ? jsonResponse(envelope([v2Article(50), v2Article(51), v2Article(52), v2Article(53)]))
      : jsonResponse(
          envelope(
            Array.from({ length: 50 }, (_, index) => v2Article(index)),
            { has_more: true, next_cursor: "cursor-1" },
          ),
        )
  })

  const result = await httpServerAdapter.queryInfo({ page_size_offset: [3, 51] })
  assert.deepEqual(result.ok ? result.data?.map((item) => item.title) : [], [
    "Article 51",
    "Article 52",
    "Article 53",
  ])
  assert.equal(calls.length, 2)
  assert.deepEqual(
    calls.map((call) => JSON.parse(String(call.init.body))),
    [{ limit: 50 }, { limit: 50, cursor: "cursor-1" }],
  )
  assert.equal(
    calls.every(
      (call) => !("Authorization" in ((call.init.headers ?? {}) as Record<string, string>)),
    ),
    true,
  )
})

test("getEntityDetail: catalog 稳定 ID 解析后组合详情、周聚合与邻居", async () => {
  const entityId = `e:${"3".repeat(64)}`
  installFetch(({ input }) => {
    const url = new URL(input)
    if (url.pathname === "/v2/data/graph/entities") {
      return jsonResponse(
        envelope([
          {
            entity_id: entityId,
            label: "ORG",
            qid: "Q42",
            canonical_name: "Example Org",
            display_name: "示例组织",
            has_entry: true,
            wikipedia_url: "https://example.test/wiki/org",
            description: null,
            updated_at_ms: 1,
          },
        ]),
      )
    }
    if (url.pathname.endsWith("/neighbors")) {
      return jsonResponse(
        envelope([
          {
            entity: {
              entity_id: `e:${"4".repeat(64)}`,
              label: "LOC",
              qid: null,
              canonical_name: "Shanghai",
              display_name: "上海",
              has_entry: true,
              wikipedia_url: null,
              description: null,
              updated_at_ms: 1,
            },
            shared_articles: 8,
            score: 0.8,
          },
        ]),
      )
    }
    return jsonResponse(
      envelope({
        entity_id: entityId,
        label: "ORG",
        qid: "Q42",
        canonical_name: "Example Org",
        display_name: "示例组织",
        has_entry: true,
        wikipedia_url: "https://example.test/wiki/org",
        description: null,
        updated_at_ms: 1,
        mention_count: 12,
        first_seen_ms: 100,
        last_seen_ms: 200,
        weekly: [{ period_ms: 50, mention_count: 3 }],
      }),
    )
  })

  assert.deepEqual(await httpServerAdapter.getEntityDetail("org", "示例组织"), {
    label: "ORG",
    name: "Example Org",
    mention_count: 12,
    first_seen: 100,
    last_seen: 200,
    has_entry: true,
    wikipedia_url: "https://example.test/wiki/org",
    co_entities: [{ label: "LOC", name: "Shanghai", count: 8, has_entry: true }],
    weekly: [{ count: 3, period: 50 }],
  })
})

test("V2 App: auth/community/publication/profile 全部使用稳定字符串 ID 与 V2 DTO", async () => {
  const accountId = `u:${"1".repeat(32)}`
  const publicationId = `pub:${"2".repeat(32)}`
  const claims = { account_id: accountId, email: "me@example.test", display_name: "Me" }
  const publication = {
    publication_id: publicationId,
    owner_account_id: accountId,
    title: "Title",
    url: "",
    body: "Body",
    created_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
  }
  const calls = installFetch(({ input }) => {
    const path = new URL(input).pathname
    if (path.includes("/auth/handshake/")) {
      return jsonResponse(envelope({ public_key: "ab".repeat(32) }))
    }
    if (path.endsWith("/auth/login") || path.endsWith("/auth/register")) {
      return jsonResponse(envelope({ token: "token", token_type: "Bearer" }))
    }
    if (path.endsWith("/auth/session") || path.endsWith("/me/profile")) {
      return jsonResponse(envelope(claims))
    }
    if (path.endsWith("/community/accounts")) {
      return jsonResponse(
        envelope([
          {
            account_id: accountId,
            display_name: "Me",
            publication_count: 1,
            created_at_ms: 1,
          },
        ]),
      )
    }
    if (path.includes("/community/accounts/") && path.endsWith("/publications")) {
      return jsonResponse(envelope([publication]))
    }
    if (path.endsWith("/me/publications")) return jsonResponse(envelope(publication), 201)
    if (path.includes("/me/publications/")) return emptyResponse()
    throw new Error(`unexpected path: ${path}`)
  })

  assert.equal((await httpServerAdapter.getServerPublicKey("client/1")).ok, true)
  assert.equal(
    (
      await httpServerAdapter.login({
        client_id: "client",
        client_secret: "aa",
        email: "me@example.test",
        encrypted_password: "bb",
      })
    ).ok,
    true,
  )
  const me = await httpServerAdapter.getMe("token")
  assert.deepEqual(me.ok ? me.data : null, {
    id: accountId,
    email: "me@example.test",
    name: "Me",
    avatar: null,
  })
  const peers = await httpServerAdapter.listPeers()
  assert.deepEqual(peers.ok ? peers.data?.[0]?.id : undefined, accountId)
  const publications = await httpServerAdapter.getPeerPublications(accountId)
  assert.deepEqual(publications.ok ? publications.data?.[0]?.id : undefined, publicationId)
  const published = await httpServerAdapter.publish("token", { title: "Title", body: "Body" })
  assert.deepEqual(published.ok ? published.data?.id : undefined, publicationId)
  assert.equal((await httpServerAdapter.deletePublication("token", publicationId)).ok, true)
  const updated = await httpServerAdapter.updateProfile("token", { name: "  Me  " })
  assert.deepEqual(updated.ok ? updated.data?.id : undefined, accountId)

  assert.equal(
    calls.every((call) => new URL(call.input).pathname.startsWith("/v2/app/")),
    true,
  )
  assert.equal(
    calls.some((call) => call.input.includes("/v1/")),
    false,
  )
  const profileCall = calls.find((call) => new URL(call.input).pathname.endsWith("/me/profile"))!
  assert.deepEqual(JSON.parse(String(profileCall.init.body)), { display_name: "Me" })
  const deleteCall = calls.find(
    (call) => call.init.method === "DELETE" && call.input.includes("/me/publications/"),
  )!
  assert.match(deleteCall.input, /pub%3A/)
  assert.deepEqual(await httpServerAdapter.updateProfile("token", { name: "   " }), {
    ok: false,
    status: 400,
    message: "发布名称必须为 1–100 个字符",
  })
})

test("looksLikeMillis: 毫秒/秒与非有限值可区分", () => {
  assert.equal(looksLikeMillis(1_700_000_000_000), true)
  assert.equal(looksLikeMillis(0), true)
  assert.equal(looksLikeMillis(1_700_000_000), false)
  assert.equal(looksLikeMillis(Number.NaN), false)
  assert.equal(looksLikeMillis(Number.POSITIVE_INFINITY), false)
  assert.equal(looksLikeMillis(-1), false)
})
