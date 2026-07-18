import type { FileRef } from "@protocol/file-system"

/**
 * 内置 App 文件系统的稳定根身份。该文件只放协议常量，供 provider、导航和旧快照迁移
 * 共享；不要在这里引入具体存储或 UI 实现。
 */
export const AUDIO_FILE_SYSTEM_ID = "app.audio-library"
export const AGENT_CONFIG_FILE_SYSTEM_ID = "app.agent-config"
export const AGENT_AUDIT_FILE_SYSTEM_ID = "app.agent-write-audit"
export const AGENT_AUDIT_APPEND_ACTION = "audit.append"
export const AGENT_AUDIT_COMPLETE_ACTION = "audit.complete"
export const AGENT_AUDIT_WRITE_PERMISSION = "agent.audit:write"
export const DATABASE_FILE_SYSTEM_ID = "app.database"
export const DISPLAY_FILE_SYSTEM_ID = "app.display"
export const ENGINES_FILE_SYSTEM_ID = "app.engines"
export const GIT_FILE_SYSTEM_ID = "app.git-repositories"
export const INSTALLED_APPS_FILE_SYSTEM_ID = "third-party.installed-apps"
export const SETTINGS_FILE_SYSTEM_ID = "app.settings"
export const AGENT_CONFIG_ROOT_MEDIA_TYPE = "application/vnd.ideall.agent-config+json"
export const AGENT_SETTINGS_MEDIA_TYPE = "application/vnd.ideall.agent-settings+json"
export const AGENT_WORKSPACES_MEDIA_TYPE = "application/vnd.ideall.agent-workspaces+json"
export const AGENT_TASKS_MEDIA_TYPE = "application/vnd.ideall.agent-tasks+json"
export const AGENT_AUDIT_MEDIA_TYPE = "application/vnd.ideall.agent-write-audit+json"
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

export const AGENT_AUDIT_FILE_REF: FileRef = {
  fileSystemId: AGENT_AUDIT_FILE_SYSTEM_ID,
  fileId: "audit.json",
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

export const DISPLAY_ROOT_REF: FileRef = {
  fileSystemId: DISPLAY_FILE_SYSTEM_ID,
  fileId: "root",
}

/** Engine 关联（mimeapps.list 形状）的投影文件：三个工作区 scope 的默认/屏蔽关联。 */
export const DISPLAY_ENGINES_FILE_REF: FileRef = {
  fileSystemId: DISPLAY_FILE_SYSTEM_ID,
  fileId: "engines",
}

/** Engine 描述符只读投影（Desktop Entry 系统层类比）的合成根。 */
export const ENGINES_ROOT_REF: FileRef = {
  fileSystemId: ENGINES_FILE_SYSTEM_ID,
  fileId: "root",
}
