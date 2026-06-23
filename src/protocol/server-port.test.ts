// M-4 ServerPort 解耦 / 中立性测试 (node:test + tsx)。
//
// 中立性是 ideall 的核心对外主张 (战略方向 D): 「后端可换 / 可自建, wonita 只是默认与参考实现」。
// 本测试把这条主张落到可执行保证上, 三件事:
//   1. 编译期: 一个**纯内存、零 wonita / 零 wire DTO** 的 MemoryServerPort 能赋给 `ServerPort` —— 证明
//      任意第三方 / 自建 / 嵌入式节点都能仅凭 ideall 自有领域类型实现完整契约。
//   2. 运行期: registerServerPort() 覆盖后 getServerPort() 路由到它 —— 换后端的支点真的生效。
//   3. 缺省回退: 未注册时 getServerPort() 回退官方 HTTP 适配器 —— 保住同构 (SSR 预渲染期可用)。
//
// 「业务/protocol 不得 import wire DTO」由 eslint 静态强制 (见 eslint.config.mjs); 此测试守运行期可换性。
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  getServerPort,
  registerServerPort,
  type ServerPort,
  type Info,
  type Publication,
} from "./server-port"
// 缺省回退断言需引用参考适配器 —— protocol 规则允许依赖 @/components/lib/** 叶子 (见 eslint 配置)。
import { httpServerAdapter } from "@/components/lib/server/http-adapter"
// 经真实业务 facade 驱动写/鉴权路径, 证明消费方 (不止端口) 也不与 wonita 绑死 (读路径解耦见 info/data.test.ts)。
import { publish, deletePublication, getPeerPublications } from "@/components/lib/peer-api"
import { login } from "@/components/lib/auth/auth-api"

// ── 一个完全独立于 wonita 的内存后端 (中立性的可执行证明) ──────────────────────────────────────
// 仅用 @protocol/server-port 的领域类型, 不碰任何 wire DTO / HTTP / 官方端点。
function makeMemoryServerPort(): ServerPort {
  const info: Info = {
    url: "mem://a",
    title: "内存后端的一条信息",
    data: "正文",
    language: "zh",
    labels: [{ label: "ORG", name: "示例", period: 0, has_entry: false }],
    publisher: { domain: "mem.local", name: "内存源", period: 0 },
    collect_time: 1_700_000_000_000,
    publish_time: 1_700_000_000_000,
  }
  const publications: Publication[] = []
  let nextId = 1

  const port: ServerPort = {
    async queryInfo() {
      return { ok: true, data: [info] }
    },
    async queryInfoEvents() {
      return { ok: true, data: [{ lead: info, related: [], source_count: 1 }] }
    },
    async getRelatedInfo() {
      return [{ ...info, shared: 0, shared_entry: 0 }]
    },
    async getInfo() {
      return info
    },
    async getEntityDetail(label, name) {
      return {
        label,
        name,
        mention_count: 1,
        first_seen: info.collect_time,
        last_seen: info.collect_time,
        has_entry: false,
        co_entities: [],
        weekly: [],
      }
    },
    async getEntityStats() {
      return { ok: true, data: { per: {}, org: { 示例: 1 }, loc: {}, product: {}, event: {} } }
    },
    async getPublisherLocations() {
      return []
    },
    async getVisitorLocation() {
      return null
    },
    async listPeers() {
      return {
        ok: true,
        data: [{ id: 1, name: "内存 peer", publication_count: publications.length }],
      }
    },
    async getPeerPublications() {
      return { ok: true, data: publications }
    },
    async publish(token, draft) {
      // token 由调用方 (宿主) 持有并传入; 内存后端据此鉴权后落库。
      if (!token) return { ok: false, message: "未鉴权" }
      const pub: Publication = {
        id: nextId++,
        title: draft.title,
        url: draft.url ?? "",
        body: draft.body ?? "",
        created_at: 1_700_000_000_000,
      }
      publications.push(pub)
      return { ok: true, data: pub }
    },
    async deletePublication(token, id) {
      if (!token) return { ok: false, message: "未鉴权" }
      const i = publications.findIndex((p) => p.id === id)
      if (i >= 0) publications.splice(i, 1)
      return { ok: true, data: { ok: true } }
    },
    async getServerPublicKey() {
      return { ok: true, data: "deadbeef" }
    },
    async login() {
      return { ok: true, data: { token: "mem-token", token_type: "Bearer" } }
    },
    async register() {
      return { ok: true, data: { token: "mem-token", token_type: "Bearer" } }
    },
    async getMe() {
      return { ok: true, data: { id: 1, email: "me@mem.local", name: "内存用户", avatar: null } }
    },
    async updateProfile() {
      return { ok: true, data: { ok: true } }
    },
  }
  return port
}

test("中立性·缺省回退: 未注册时 getServerPort() = 官方 HTTP 适配器 (保同构, SSR 期可用)", (t) => {
  // 显式清覆盖再断言 —— 自给自足, 不依赖「恰好没人先注册」(与隔离模式/文件顺序/同文件前序 test 无关)。
  registerServerPort(null)
  t.after(() => registerServerPort(null))
  assert.equal(getServerPort(), httpServerAdapter)
})

test("中立性·可换后端: registerServerPort() 覆盖后 getServerPort() 路由到自建实现", (t) => {
  const original = getServerPort()
  t.after(() => registerServerPort(original)) // 还原, 避免泄漏到其它测试文件 (override 是模块级单例)

  const memory = makeMemoryServerPort()
  registerServerPort(memory)
  assert.equal(getServerPort(), memory)
  assert.notEqual(getServerPort(), httpServerAdapter)
})

test("中立性·端到端: 零 wonita 后端经真实业务 facade 驱动取数/鉴权/发布闭环 (含写/鉴权解耦)", async (t) => {
  const original = getServerPort()
  t.after(() => registerServerPort(original))

  const memory = makeMemoryServerPort()
  registerServerPort(memory)

  // 取数走自建后端 (read facade 解耦另见 info/data.test.ts)
  const infos = await getServerPort().queryInfo({})
  assert.equal(infos.ok && infos.data?.[0]?.url, "mem://a")

  // 鉴权: 经 auth-api facade 登录拿 token (token 由调用方持有); 证明鉴权路径全程走 getServerPort()
  const auth = await login({
    client_id: "c",
    client_secret: "k",
    email: "me@mem.local",
    encrypted_password: "00",
  })
  assert.ok(auth.ok && auth.data)
  const token = auth.ok && auth.data ? auth.data.token : ""
  assert.equal(token, "mem-token")

  // 发布闭环: 经 peer-api facade 发布 → 列表可见 → 删除; 证明写路径全程走 getServerPort()
  const pub = await publish(token, { title: "来自内存后端" })
  assert.ok(pub.ok && pub.data)
  const pubId = pub.ok && pub.data ? pub.data.id : -1
  const after = await getPeerPublications("1")
  assert.equal(after.ok && after.data?.some((p) => p.id === pubId), true)
  const del = await deletePublication(token, pubId)
  assert.equal(del.ok, true)
})
