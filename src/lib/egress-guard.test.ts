// egress 守卫的红队向量回归: SSRF (环回/内网/云元数据)、IPv6 字节解 (::ffff: 映射绕过)、协议/端口/userinfo 闸。
// 这些是 agent 出站的安全不变量; 抽到 egress-guard 后用单测隔离锁死 (此前埋在 web-search 内无法单独覆盖)。
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  WebError,
  isBlockedIpv4,
  isBlockedIpv6,
  isBlockedHostname,
  assertEgressAllowed,
} from "./egress-guard"

test("isBlockedIpv4: 拦环回/私网/link-local/CGNAT/元数据/广播", () => {
  for (const ip of [
    "0.0.0.0",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(isBlockedIpv4(ip), true, ip)
  }
})

test("isBlockedIpv4: 放行公网, 非法八位组判可疑", () => {
  assert.equal(isBlockedIpv4("8.8.8.8"), false)
  assert.equal(isBlockedIpv4("1.1.1.1"), false)
  assert.equal(isBlockedIpv4("172.32.0.1"), false) // 32 不在 16-31 段
  assert.equal(isBlockedIpv4("256.1.1.1"), true) // 非法八位组 → 拦
})

test("isBlockedIpv6: 拦 ::1/::/link-local/ULA 与内嵌 (mapped/16 进制形) 坏 IPv4", () => {
  for (const ip of [
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12::1",
    "::ffff:127.0.0.1", // mapped 文本形
    "::ffff:7f00:1", // mapped 16 进制形 (URL 序列化后, 文本正则会漏的绕过)
  ]) {
    assert.equal(isBlockedIpv6(ip), true, ip)
  }
})

test("isBlockedIpv6: 放行公网 v6, 解析失败判可疑", () => {
  assert.equal(isBlockedIpv6("2606:4700:4700::1111"), false) // cloudflare dns
  assert.equal(isBlockedIpv6("gg::1"), true) // 非法 → 拦
})

test("isBlockedHostname: 拦本地/内网名 + 云元数据名 (大小写无关)", () => {
  for (const h of [
    "localhost",
    "ip6-localhost",
    "x.localhost",
    "foo.local",
    "svc.internal",
    "metadata.google.internal",
    "LocalHost",
  ]) {
    assert.equal(isBlockedHostname(h), true, h)
  }
  assert.equal(isBlockedHostname("example.com"), false)
})

test("assertEgressAllowed: 放行公网 https(443)", () => {
  assert.equal(assertEgressAllowed("https://example.com/x?q=1").hostname, "example.com")
  assert.equal(assertEgressAllowed("https://example.com:443/y").hostname, "example.com")
})

test("assertEgressAllowed: 拒明文/userinfo/非443/私网/伪协议/非法 URL", () => {
  for (const url of [
    "http://example.com", // 明文
    "https://user:pass@example.com", // userinfo
    "https://example.com:8443", // 非 443 端口
    "https://127.0.0.1", // 环回
    "https://169.254.169.254/latest/meta-data", // 云元数据
    "https://localhost", // 本地名
    "https://[::1]", // v6 环回字面量
    "https://[::ffff:169.254.169.254]", // v6-mapped 元数据
    "ftp://example.com", // 非 https 协议
    "not a url", // 非法 URL
  ]) {
    assert.throws(() => assertEgressAllowed(url), WebError, url)
  }
})
