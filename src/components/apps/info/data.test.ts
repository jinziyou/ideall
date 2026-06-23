// M-4 配套: 消费方解耦验证 (node:test + tsx)。
// 证明真实的 info 取数 facade (data.ts) 全程经 getServerPort() 路由, 故能在被替换的任意后端上运行 ——
// 中立性不止停在端口层, 业务消费方确实不与 wonita 绑死。port 层完整契约/缺省回退证明见 protocol/server-port.test.ts。
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  getServerPort,
  registerServerPort,
  type ServerPort,
  type Info,
} from "@protocol/server-port"
import { fetchLatestInfo, getInfo, getEntityDetail } from "./data"

const MEM_INFO: Info = {
  url: "mem://info",
  title: "来自被替换后端",
  data: "",
  language: "zh",
  labels: [],
  publisher: { domain: "mem.local", name: "内存源", period: 0 },
  collect_time: 1_700_000_000_000,
  publish_time: 1_700_000_000_000,
}

// 只实现 info facade 会触达的方法, 其余以 notUsed 占位 (本测试不应触达)。
// 直接 `: ServerPort` 注解使对象字面量受编译期契约门约束 —— 将来 ServerPort 新增方法 / notUsed 写错即编译失败,
// 守住「消费方按完整契约对接任意后端」这条本测试要证的保证 (勿改回 as 转型, 那会吞掉该校验)。
function makeInfoBackend(): ServerPort {
  const notUsed = () => {
    throw new Error("info facade 不应调用此方法")
  }
  const backend: ServerPort = {
    queryInfo: async () => ({ ok: true, data: [MEM_INFO] }),
    getInfo: async () => MEM_INFO,
    getEntityDetail: async (label: string, name: string) => ({
      label,
      name,
      mention_count: 7,
      first_seen: MEM_INFO.collect_time,
      last_seen: MEM_INFO.collect_time,
      has_entry: false,
      co_entities: [],
      weekly: [],
    }),
    getRelatedInfo: notUsed,
    listPeers: notUsed,
    getPeerPublications: notUsed,
    publish: notUsed,
    deletePublication: notUsed,
    getServerPublicKey: notUsed,
    login: notUsed,
    register: notUsed,
    getMe: notUsed,
    updateProfile: notUsed,
  }
  return backend
}

test("info/data.ts 经 ServerPort 取数 → 在被替换的后端上返回其数据 (消费方解耦)", async (t) => {
  const original = getServerPort()
  t.after(() => registerServerPort(original)) // 还原模块级单例, 避免泄漏

  registerServerPort(makeInfoBackend())

  const latest = await fetchLatestInfo({})
  assert.equal(latest.ok && latest.data?.[0]?.title, "来自被替换后端")

  const one = await getInfo("mem://info")
  assert.equal(one?.url, "mem://info")

  const entity = await getEntityDetail("ORG", "示例")
  assert.equal(entity?.mention_count, 7)
})
