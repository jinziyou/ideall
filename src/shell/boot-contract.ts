import { sameFileRef, type FileRef } from "@protocol/file-system"
import { ideallRootFileSystem } from "@/filesystem/builtin"
import {
  NAVIGATION_FILE_SYSTEM_ID,
  assertNavigationContract,
  navigationFileSystem,
} from "@/filesystem/navigation-file-system"
import { getFileSystem } from "@/filesystem/registry"
import { resourceFileSystem } from "@/filesystem/resource-file-system"

export type BootContractFailureCode =
  | "BOOT_PROVIDER_MISSING"
  | "BOOT_PROVIDER_ROOT_MISMATCH"
  | "BOOT_PROVIDER_CAPABILITY_MISSING"
  | "BOOT_NAVIGATION_INVALID"

export class BootContractError extends Error {
  override name = "BootContractError"

  constructor(
    readonly code: BootContractFailureCode,
    message: string,
  ) {
    super(message)
  }
}

type ProviderLookup = typeof getFileSystem

function assertProvider(lookup: ProviderLookup, fileSystemId: string, root: FileRef): void {
  const provider = lookup(fileSystemId)
  if (!provider) {
    throw new BootContractError("BOOT_PROVIDER_MISSING", `文件系统未注册: ${fileSystemId}`)
  }
  if (!sameFileRef(provider.descriptor.root, root)) {
    throw new BootContractError(
      "BOOT_PROVIDER_ROOT_MISMATCH",
      `文件系统根引用不匹配: ${fileSystemId}`,
    )
  }
  if (!provider.descriptor.capabilities?.includes("read-directory")) {
    throw new BootContractError(
      "BOOT_PROVIDER_CAPABILITY_MISSING",
      `文件系统缺少目录读取能力: ${fileSystemId}`,
    )
  }
}

/** Shell 首次渲染前必须成立的最小契约；失败会触发 BootGate 的可读诊断页。 */
export function assertShellBootContract(lookup: ProviderLookup = getFileSystem): void {
  try {
    assertNavigationContract()
  } catch (error) {
    throw new BootContractError(
      "BOOT_NAVIGATION_INVALID",
      error instanceof Error ? error.message : "导航定义无效",
    )
  }
  assertProvider(
    lookup,
    navigationFileSystem.descriptor.fileSystemId,
    navigationFileSystem.descriptor.root,
  )
  assertProvider(
    lookup,
    ideallRootFileSystem.descriptor.fileSystemId,
    ideallRootFileSystem.descriptor.root,
  )
  assertProvider(
    lookup,
    resourceFileSystem.descriptor.fileSystemId,
    resourceFileSystem.descriptor.root,
  )
  if (!lookup(NAVIGATION_FILE_SYSTEM_ID)) {
    throw new BootContractError("BOOT_PROVIDER_MISSING", "导航文件系统未注册")
  }
}

export type BootFailureDiagnostic = Readonly<{
  code: BootContractFailureCode | "BOOT_REGISTRATION_FAILED"
  title: string
  detail: string
}>

function boundedBootMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const redacted = raw
    .replace(
      /(authorization|cookie)\s*[:=]\s*(?:(?:Bearer|Basic)\s+)?[^\r\n,;]+/gi,
      "$1=[redacted]",
    )
    .replace(
      /(token|secret|api[-_]?key|authorization|cookie|password|credential)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [redacted]")
  return redacted.length > 512 ? `${redacted.slice(0, 511)}…` : redacted
}

export function describeBootFailure(error: unknown): BootFailureDiagnostic {
  return {
    code: error instanceof BootContractError ? error.code : "BOOT_REGISTRATION_FAILED",
    title: error instanceof BootContractError ? "启动契约未满足" : "应用启动失败",
    detail: boundedBootMessage(error),
  }
}
