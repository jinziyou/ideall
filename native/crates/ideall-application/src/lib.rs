//! UI-independent use cases for the native clients.

mod note_document;
mod workspace;

pub use ideall_agent::{
    AgentAuditRecord, AuditStatus, ModelRole, OpenAiCompatibleClient, ToolEffect, ToolRisk,
};
pub use workspace::{
    AgentModelSettings, AgentToolRun, AgentTranscriptMessage, AgentTurnResult, ApplicationError,
    ExternalAcpSettings, HOME_ROOT_ID, LocalWorkspace, NodeSummary, PlainNoteDocument,
    SyncSettings, TextFileDocument,
};
