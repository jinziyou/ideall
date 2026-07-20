import {
  importPluginDataPackage,
  previewPluginDataImport,
  restorePluginDataBackup,
  type PluginDataImportBackup,
  type PluginDataImportPreview,
} from "@/plugins/shared/plugin-data-manager"
import {
  importWorkspaceArchiveJson,
  isWorkspaceArchiveRaw,
  previewWorkspaceArchiveImport,
  restoreWorkspaceArchiveBackup,
  type WorkspaceArchiveImportPreview,
} from "@/plugins/shared/workspace-archive"

export type CodeDataImportPreview = PluginDataImportPreview | WorkspaceArchiveImportPreview

export async function previewCodeDataImport(
  raw: string,
  filename: string,
): Promise<CodeDataImportPreview> {
  return isWorkspaceArchiveRaw(raw)
    ? previewWorkspaceArchiveImport(raw, filename)
    : previewPluginDataImport(raw, filename)
}

/** archive 与普通插件包保持各自的原子导入/备份实现，仅统一页面所需结果。 */
export async function importCodeData(raw: string, filename: string) {
  const archive = isWorkspaceArchiveRaw(raw)
  const execution = archive
    ? await importWorkspaceArchiveJson(raw, filename)
    : await importPluginDataPackage(raw, filename)
  return {
    archive,
    backup: execution.backup,
    result: execution.result,
  }
}

/** 回滚类型由备份自身的原始包判定，避免依赖已清空的导入预览。 */
export async function restoreCodeDataBackup(backup: PluginDataImportBackup) {
  const archive = isWorkspaceArchiveRaw(backup.raw)
  const execution = archive
    ? await restoreWorkspaceArchiveBackup(backup)
    : await restorePluginDataBackup(backup)
  return { archive, result: execution.result }
}
