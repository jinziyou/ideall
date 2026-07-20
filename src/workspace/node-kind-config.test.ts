import { test } from "node:test"
import assert from "node:assert/strict"
import { NODE_KINDS } from "@protocol/node"
import { NODE_KIND_MODULE, moduleForNodeKind } from "./node-kind-config"

test("node kind config: 覆盖全部协议 NodeKind 并归属 home", () => {
  assert.deepEqual(Object.keys(NODE_KIND_MODULE).sort(), [...NODE_KINDS].sort())
  assert.deepEqual(
    NODE_KINDS.map((kind) => moduleForNodeKind(kind)),
    NODE_KINDS.map(() => "home"),
  )
})
