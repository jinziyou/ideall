import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const VERSION_RE =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const VERSION_FILES = [
  {
    path: "package.json",
    pattern: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    path: "src-tauri/tauri.conf.json",
    pattern: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    path: "src-tauri/Cargo.toml",
    pattern: /(^version\s*=\s*")([^"]+)(")/m,
  },
  {
    path: "src-tauri/Cargo.lock",
    pattern: /(name = "ideall"\r?\nversion = ")([^"]+)(")/,
  },
]

export function validateProjectVersion(version, label = "版本号") {
  if (typeof version !== "string" || !VERSION_RE.test(version)) {
    throw new Error(
      `${label}不是受支持的 SemVer（期望 x.y.z 或 x.y.z-prerelease）: ${version ?? ""}`,
    )
  }
  return version
}

function findSingleVersion(file, contents, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
  const matches = [...contents.matchAll(new RegExp(pattern.source, flags))]
  if (matches.length !== 1) {
    throw new Error(`${file}: 期望且只允许一个项目版本字段，实际找到 ${matches.length} 个`)
  }

  const version = matches[0][2]
  validateProjectVersion(version, `${file} 中的版本号`)
  return version
}

/**
 * 一次性读取并验证所有版本文件。调用方应在产生任何写入前完成本步骤，避免文件结构漂移时部分更新。
 */
export function loadProjectVersionState(root = PROJECT_ROOT) {
  return VERSION_FILES.map((definition) => {
    const absolutePath = path.join(root, definition.path)
    const contents = readFileSync(absolutePath, "utf8")
    const version = findSingleVersion(definition.path, contents, definition.pattern)
    return { ...definition, absolutePath, contents, version }
  })
}

/** 校验四处版本完全一致；传 expected 时同时校验发版 tag 的目标版本。 */
export function assertProjectVersions(entries, expected) {
  if (!entries.length) throw new Error("没有配置项目版本文件")

  const versions = new Set(entries.map((entry) => entry.version))
  if (versions.size !== 1) {
    const details = entries.map((entry) => `${entry.path}=${entry.version}`).join(" / ")
    throw new Error(`项目版本不一致: ${details}`)
  }

  const actual = entries[0].version
  if (expected !== undefined) {
    validateProjectVersion(expected, "期望版本号")
    if (actual !== expected) {
      throw new Error(`项目版本 ${actual} 与期望版本 ${expected} 不一致`)
    }
  }
  return actual
}

/** 在内存中生成全部更新内容；这里成功后调用方才可以开始落盘。 */
export function prepareProjectVersionUpdate(entries, nextVersion) {
  validateProjectVersion(nextVersion, "目标版本号")
  return entries.map((entry) => {
    const contents = entry.contents.replace(
      entry.pattern,
      (_match, prefix, _current, suffix) => `${prefix}${nextVersion}${suffix}`,
    )
    return { ...entry, nextVersion, nextContents: contents }
  })
}
