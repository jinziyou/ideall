#!/usr/bin/env node
// Clash TUN + fake-ip: WSL 从 Windows DNS 拿到 198.18.x, WebKit 直连超时。
// 经 8.8.8.8 解析真实 IP 写入 /etc/hosts (需 root)。TUN 与系统代理可并存, 本脚本不依赖 HTTP 代理口。
//
// 用法: pnpm wsl:hosts          # 打印将写入的内容 + sudo 提示
//       pnpm wsl:hosts --apply  # sudo 写入 /etc/hosts (会替换旧块)
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { fileURLToPath } from "node:url"

const SCRIPT_PATH = fileURLToPath(import.meta.url)

const DOMAINS = ["www.wonita.link", "wonita.link", "api.wonita.link"]
const MARK_START = "# ideall-wsl-wonita-hosts-start"
const MARK_END = "# ideall-wsl-wonita-hosts-end"
const HOSTS = "/etc/hosts"

function isWsl() {
  try {
    return /microsoft/i.test(fs.readFileSync("/proc/version", "utf8"))
  } catch {
    return false
  }
}

function resolveA(name) {
  if (has("dig")) {
    const r = spawnSync("dig", ["+short", "A", name, "@8.8.8.8"], { encoding: "utf8" })
    return [
      ...new Set(
        r.stdout
          .trim()
          .split(/\s+/)
          .filter((s) => /^\d+\.\d+\.\d+\.\d+$/.test(s)),
      ),
    ]
  }
  const r = spawnSync("nslookup", [name, "8.8.8.8"], { encoding: "utf8" })
  const ips = []
  for (const line of r.stdout.split("\n")) {
    const m = line.match(/Address:\s*(\d+\.\d+\.\d+\.\d+)/)
    if (m && m[1] !== "8.8.8.8") ips.push(m[1])
  }
  return [...new Set(ips)]
}

function has(bin) {
  return spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0
}

function systemResolve(name) {
  const r = spawnSync("getent", ["hosts", name], { encoding: "utf8" })
  const m = r.stdout.trim().match(/^(\S+)/)
  return m?.[1] ?? null
}

function isFakeIp(ip) {
  if (!ip) return false
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4) return false
  // Clash fake-ip 池常见 198.18.0.0/15
  return parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19
}

function sudoApplyCmd() {
  return `sudo ${process.execPath} ${SCRIPT_PATH} --apply`
}

function buildBlock() {
  const lines = [MARK_START]
  const seen = new Set()
  for (const domain of DOMAINS) {
    const ips = resolveA(domain)
    if (ips.length === 0) {
      console.error(`[wsl:hosts] 无法经 8.8.8.8 解析 ${domain}`)
      process.exit(1)
    }
    for (const ip of ips) {
      const key = `${ip}\t${domain}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`${ip}\t${domain}`)
    }
  }
  lines.push(MARK_END)
  return lines.join("\n") + "\n"
}

function stripOldHosts(content) {
  const start = content.indexOf(MARK_START)
  if (start === -1) return content
  const end = content.indexOf(MARK_END, start)
  if (end === -1) return content
  return (content.slice(0, start) + content.slice(end + MARK_END.length)).replace(/\n{3,}/g, "\n\n")
}

function main() {
  const apply = process.argv.includes("--apply")

  if (!isWsl()) {
    console.log("[wsl:hosts] 非 WSL, 跳过。")
    return
  }

  const sample = systemResolve("www.wonita.link")
  if (sample && !isFakeIp(sample) && !apply) {
    console.log(`[wsl:hosts] www.wonita.link 已是真实 IP (${sample}), 无需改 hosts。`)
    return
  }

  const block = buildBlock()
  console.log("[wsl:hosts] 将写入 /etc/hosts:\n")
  console.log(block)

  if (!apply) {
    console.log(`执行写入: ${sudoApplyCmd()}`)
    return
  }

  if (process.getuid?.() !== 0) {
    console.error(`[wsl:hosts] --apply 需要 root (sudo 下无 pnpm, 请用 node):\n  ${sudoApplyCmd()}`)
    process.exit(1)
  }

  const prev = fs.readFileSync(HOSTS, "utf8")
  const next = stripOldHosts(prev).trimEnd() + "\n\n" + block
  fs.writeFileSync(HOSTS, next)
  console.log("[wsl:hosts] 已更新 /etc/hosts。重启 app:dev 后再试「资讯」。")
}

main()
