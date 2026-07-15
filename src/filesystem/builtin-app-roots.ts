import type { FileRef } from "@protocol/file-system"

/**
 * 内置 App 文件系统的稳定根身份。该文件只放协议常量，供 provider、导航和旧快照迁移
 * 共享；不要在这里引入具体存储或 UI 实现。
 */
export const AUDIO_FILE_SYSTEM_ID = "app.audio-library"
export const AGENT_CONFIG_FILE_SYSTEM_ID = "app.agent-config"
export const DATABASE_FILE_SYSTEM_ID = "app.database"
export const GIT_FILE_SYSTEM_ID = "app.git-repositories"
export const INSTALLED_APPS_FILE_SYSTEM_ID = "third-party.installed-apps"
export const SETTINGS_FILE_SYSTEM_ID = "app.settings"
export const AGENT_CONFIG_ROOT_MEDIA_TYPE = "application/vnd.ideall.agent-config+json"
export const AGENT_SETTINGS_MEDIA_TYPE = "application/vnd.ideall.agent-settings+json"
export const AGENT_WORKSPACES_MEDIA_TYPE = "application/vnd.ideall.agent-workspaces+json"
export const AGENT_TASKS_MEDIA_TYPE = "application/vnd.ideall.agent-tasks+json"
export const INSTALLED_APPS_ROOT_MEDIA_TYPE = "application/vnd.ideall.installed-apps+json"
export const SETTINGS_ROOT_MEDIA_TYPE = "application/vnd.ideall.settings+json"

export const AGENT_CONFIG_ROOT_REF: FileRef = {
  fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID,
  fileId: "root",
}

export const AGENT_SETTINGS_FILE_REF: FileRef = {
  fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID,
  fileId: "config:settings",
}

export const AGENT_WORKSPACES_FILE_REF: FileRef = {
  fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID,
  fileId: "config:workspaces",
}

export const AGENT_TASKS_FILE_REF: FileRef = {
  fileSystemId: AGENT_CONFIG_FILE_SYSTEM_ID,
  fileId: "config:tasks",
}

export const AUDIO_LIBRARY_ROOT_REF: FileRef = {
  fileSystemId: AUDIO_FILE_SYSTEM_ID,
  fileId: "root",
}

export const DATABASE_ROOT_REF: FileRef = {
  fileSystemId: DATABASE_FILE_SYSTEM_ID,
  fileId: "root",
}

export const GIT_ROOT_REF: FileRef = {
  fileSystemId: GIT_FILE_SYSTEM_ID,
  fileId: "root",
}

export const INSTALLED_APPS_ROOT_REF: FileRef = {
  fileSystemId: INSTALLED_APPS_FILE_SYSTEM_ID,
  fileId: "root",
}

export const SETTINGS_ROOT_REF: FileRef = {
  fileSystemId: SETTINGS_FILE_SYSTEM_ID,
  fileId: "root",
}
