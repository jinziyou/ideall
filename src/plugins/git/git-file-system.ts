import {
  DIRECTORY_MEDIA_TYPE,
  fileRefKey,
  sameFileRef,
  type FileRef,
  type IdeallFile,
} from "@protocol/file-system"
import type {
  DirectoryPage,
  FileAction,
  FileReadResult,
  FileSystemProvider,
} from "@/filesystem/types"
import { FileSystemError } from "@/filesystem/types"
import { loadGitRepos, removeGitRepo, saveGitRepos } from "./git-repos-store"

export const GIT_FILE_SYSTEM_ID = "app.git-repositories"
const ROOT_REF: FileRef = { fileSystemId: GIT_FILE_SYSTEM_ID, fileId: "root" }

function repoRef(path: string): FileRef {
  return { fileSystemId: GIT_FILE_SYSTEM_ID, fileId: `repo:${encodeURIComponent(path)}` }
}

function repoPath(ref: FileRef): string | null {
  if (ref.fileSystemId !== GIT_FILE_SYSTEM_ID || !ref.fileId.startsWith("repo:")) return null
  try {
    return decodeURIComponent(ref.fileId.slice("repo:".length)) || null
  } catch {
    return null
  }
}

function repoFile(path: string): IdeallFile {
  const name =
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path
  return {
    ref: repoRef(path),
    kind: "directory",
    name,
    mediaType: DIRECTORY_MEDIA_TYPE,
    capabilities: ["read-directory", "read", "delete", "actions"],
    source: { kind: "local", id: "git", label: "Git 仓库" },
    properties: { git: true, path, explicitGrant: true },
  }
}

function requireRepo(ref: FileRef): string {
  const path = repoPath(ref)
  if (!path || !loadGitRepos().includes(path)) {
    throw new FileSystemError("not-found", `Git repository not found: ${fileRefKey(ref)}`, ref)
  }
  return path
}

export const gitFileSystem: FileSystemProvider = {
  descriptor: {
    fileSystemId: GIT_FILE_SYSTEM_ID,
    name: "Git 仓库",
    root: ROOT_REF,
    source: { kind: "local", id: "git", label: "Git 仓库" },
    capabilities: ["read-directory", "read", "delete", "actions"],
  },
  async stat(ref) {
    if (sameFileRef(ref, ROOT_REF)) {
      return {
        ref,
        kind: "directory",
        name: "Git 仓库",
        mediaType: DIRECTORY_MEDIA_TYPE,
        capabilities: ["read-directory", "actions"],
        source: this.descriptor.source,
        properties: { explicitGrant: true },
      }
    }
    return repoFile(requireRepo(ref))
  },
  async readDirectory(ref): Promise<DirectoryPage> {
    if (!sameFileRef(ref, ROOT_REF)) {
      requireRepo(ref)
      // 现阶段只挂载用户授权的仓库根；真实 OS 子文件待受限 Tauri FS provider 提供。
      return { entries: [] }
    }
    const repos = loadGitRepos()
    return {
      entries: repos.map((path, index) => ({
        entryId: path,
        parent: ROOT_REF,
        target: repoRef(path),
        name: repoFile(path).name,
        kind: "mount",
        sortKey: String(index).padStart(4, "0"),
      })),
    }
  },
  async read(ref): Promise<FileReadResult> {
    const path = requireRepo(ref)
    return { data: { path }, mediaType: "application/vnd.ideall.git+json" }
  },
  async write(ref) {
    throw new FileSystemError("unsupported", "Git repository content uses guarded Git actions", ref)
  },
  async actions(ref): Promise<FileAction[]> {
    if (sameFileRef(ref, ROOT_REF)) return [{ id: "open", label: "打开" }]
    requireRepo(ref)
    return [
      { id: "open", label: "打开" },
      { id: "delete", label: "移除挂载", destructive: true, requires: ["delete"] },
    ]
  },
  async invoke(ref, action) {
    if (action === "open") return { ref }
    if (action === "delete") {
      const path = requireRepo(ref)
      saveGitRepos(removeGitRepo(loadGitRepos(), path))
      return { ref, deleted: true }
    }
    throw new FileSystemError("unsupported", `Unsupported Git action: ${action}`, ref)
  },
}

let mounted = false

export function registerGitFileSystem(mount: (provider: FileSystemProvider) => void): void {
  if (mounted) return
  mount(gitFileSystem)
  mounted = true
}
