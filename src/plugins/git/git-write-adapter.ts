import type { FileRef } from "@protocol/file-system"
import { GIT_FILE_SYSTEM_ID, GIT_ROOT_REF } from "@/filesystem/builtin-app-roots"
import { withFileWriteLock } from "@/filesystem/write-lock"
import { createPluginMutationInvalidationChannel } from "@/plugins/shared/plugin-mutation-channel"
import { importGitReposJson, loadGitRepos, type GitRepoMount } from "./git-repos-store"

type GitReposImporter = (raw: string) => Promise<{ repos: number }>
type GitReposLoader = () => GitRepoMount[]

const gitImportInvalidations = createPluginMutationInvalidationChannel(GIT_FILE_SYSTEM_ID)

export const subscribeGitImportInvalidation = gitImportInvalidations.subscribe

export function gitRepoFileRef(mountId: string): FileRef {
  return { fileSystemId: GIT_FILE_SYSTEM_ID, fileId: `repo:${encodeURIComponent(mountId)}` }
}

/** 挂载列表的统一写屏障；选择目录等交互应在进入该临界区前完成。 */
export function withGitMountListWriteLock<T>(operation: () => T | Promise<T>): Promise<T> {
  return withFileWriteLock(GIT_ROOT_REF, operation)
}

function withCurrentRepoWriteLocks<T>(
  repos: readonly GitRepoMount[],
  operation: () => T | Promise<T>,
): Promise<T> {
  const refs = [...repos]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((repo) => gitRepoFileRef(repo.id))
  const acquire = (index: number): Promise<T> =>
    index >= refs.length
      ? Promise.resolve(operation())
      : withFileWriteLock(refs[index], () => acquire(index + 1))
  return acquire(0)
}

/**
 * 数据端口会替换整个挂载列表。先固定 root，再固定当前全部 repo，确保已开始或正在等待的
 * repo action/子文件写完成或在导入后重新解析为 not-found，不能命中已卸载 FileRef。
 */
export async function importGitReposJsonWithWriteLocks(
  raw: string,
  importRepos: GitReposImporter = importGitReposJson,
  loadRepos: GitReposLoader = loadGitRepos,
): Promise<{ repos: number }> {
  const result = await withGitMountListWriteLock(() =>
    withCurrentRepoWriteLocks(loadRepos(), () => importRepos(raw)),
  )
  gitImportInvalidations.publish()
  return result
}
