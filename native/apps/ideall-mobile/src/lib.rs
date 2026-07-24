//! Native iOS and Android entry points for ideall.

#[cfg(any(
    target_os = "ios",
    target_os = "android",
    feature = "mobile-ui-host-check"
))]
mod native_text;

#[cfg(target_os = "ios")]
mod ios_host;

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Java_com_jinziyou_ideall_IdeallNativeActivity_nativeOnTextInput(
    env: *mut std::ffi::c_void,
    activity: *mut std::ffi::c_void,
    value: *mut std::ffi::c_void,
    selection_start: i32,
    selection_end: i32,
    composing: u8,
) {
    // SAFETY: Android invokes this root-level JNI entry with references valid
    // for the duration of the call; `android_on_text_input` copies the string.
    unsafe {
        native_text::android_on_text_input(
            env,
            activity,
            value,
            selection_start,
            selection_end,
            composing,
        );
    }
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "C" fn Java_com_jinziyou_ideall_IdeallNativeActivity_nativeSetSafeAreaInsets(
    _env: *mut std::ffi::c_void,
    _activity: *mut std::ffi::c_void,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
) {
    native_text::set_android_safe_area_insets(left, top, right, bottom);
}

#[cfg(any(
    target_os = "ios",
    target_os = "android",
    feature = "mobile-ui-host-check",
    test
))]
mod editor;

#[cfg(any(
    target_os = "ios",
    target_os = "android",
    feature = "mobile-ui-host-check"
))]
mod mobile {
    use std::{cell::RefCell, path::PathBuf, time::Duration};

    use crate::{
        editor::{
            BlockFormatError as MobileBlockFormatError, BlockMove as MobileBlockMove,
            BlockStyle as MobileBlockStyle, apply_block_style as apply_mobile_block_style,
            apply_input_at_cursor as apply_mobile_input_at_cursor,
            apply_slash_command as apply_mobile_slash_command,
            cursor_line_index as mobile_cursor_line_index,
            enqueue_control_key as enqueue_mobile_control_key,
            line_with_cursor as mobile_line_with_cursor, move_block as move_mobile_block,
            native_edit_committed as mobile_native_edit_committed,
            slash_commands as mobile_slash_commands, slash_query as mobile_slash_query,
            text_line_ranges as mobile_text_line_ranges,
        },
        native_text,
    };
    use gpui_mobile::gpui::{
        App, Context, FocusHandle, IntoElement, KeyDownEvent, MouseButton, MouseDownEvent, Render,
        ScrollHandle, SharedString, Subscription, Task, Window, WindowOptions, div, point,
        prelude::*, px, rgb,
    };
    use gpui_mobile::{
        KeyboardType,
        components::{
            material::{text_input::TextInput, theme::MaterialTheme},
            platform_view_element::platform_view_element,
        },
        packages::webview::{WebViewHandle, WebViewSettings},
    };
    use ideall_application::{
        AgentAuditRecord, AgentModelSettings, AgentTranscriptMessage, AuditStatus, HOME_ROOT_ID,
        LocalWorkspace, ModelRole, NodeSummary, OpenAiCompatibleClient, SyncSettings,
    };
    use ideall_domain::{
        EnginePlatform, TabDescriptor, WorkspaceState, engine_runtime_capabilities, tab_key,
    };
    use ideall_protocol::{EngineAccess, FileRef, Node, NodeKind, SubscriptionType};
    use ideall_secrets::{SecretKey, SecretStore as _, SystemSecretStore};
    use ideall_sync::{is_valid_sync_code, normalize_sync_code};
    use ideall_sync_http::HttpSyncTransport;

    const INFO_PORTAL_URL: &str = "https://www.wonita.link/info";
    const COMMUNITY_PORTAL_URL: &str = "https://www.wonita.link/community";
    const DRAFT_AUTOSAVE_DELAY: Duration = Duration::from_millis(700);

    thread_local! {
        static PENDING_TEXT: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum FocusedField {
        Search,
        FeedKey,
        Title,
        Body,
        SyncServer,
        SyncCode,
        SyncToken,
        AgentBaseUrl,
        AgentModel,
        AgentKey,
        AgentPrompt,
    }

    struct MobileStartupFailure {
        message: String,
    }

    impl Render for MobileStartupFailure {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            let (safe_top, safe_bottom, safe_left, safe_right) = gpui_mobile::safe_area_insets();
            div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .pt(px(safe_top))
                .pb(px(safe_bottom))
                .pl(px(safe_left))
                .pr(px(safe_right))
                .bg(rgb(0xf5f7fa))
                .child(
                    div()
                        .m_6()
                        .max_w(px(560.))
                        .p_6()
                        .rounded_xl()
                        .border_1()
                        .border_color(rgb(0xe1b7b3))
                        .bg(rgb(0xffffff))
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(
                            div()
                                .text_xl()
                                .text_color(rgb(0x8f2f28))
                                .child("ideall 无法启动"),
                        )
                        .child(
                            div()
                                .text_sm()
                                .text_color(rgb(0x4b5563))
                                .whitespace_normal()
                                .child(self.message.clone()),
                        )
                        .child(
                            div()
                                .text_sm()
                                .text_color(rgb(0x6b7280))
                                .child("请检查设备存储空间与系统安全存储权限，然后重新打开应用。"),
                        ),
                )
        }
    }

    struct IdeallMobile {
        database_path: PathBuf,
        service: LocalWorkspace,
        workspace: WorkspaceState,
        secret_store: SystemSecretStore,
        items: Vec<NodeSummary>,
        selected_id: Option<String>,
        selected_kind: Option<NodeKind>,
        active_section: &'static str,
        show_trash: bool,
        search_query: String,
        feed_key_draft: String,
        draft_title: String,
        draft_body: String,
        sync_server_draft: String,
        sync_code_draft: String,
        sync_token_draft: String,
        agent_base_url_draft: String,
        agent_model_draft: String,
        agent_key_draft: String,
        agent_prompt_draft: String,
        sync_code_configured: bool,
        sync_token_configured: bool,
        sync_in_progress: bool,
        agent_key_configured: bool,
        agent_in_progress: bool,
        agent_thread_id: Option<String>,
        agent_transcript: Vec<AgentTranscriptMessage>,
        agent_audits: Vec<AgentAuditRecord>,
        agent_threads: Vec<NodeSummary>,
        agent_activity_loading: bool,
        embedded_browser: Option<WebViewHandle>,
        body_editable: bool,
        focus_handle: FocusHandle,
        body_scroll_handle: ScrollHandle,
        body_last_revealed_cursor: Option<usize>,
        focused_field: Option<FocusedField>,
        focused_selection_start: usize,
        focused_cursor: usize,
        native_input_composing: bool,
        observed_pending_chunks: usize,
        draft_revision: u64,
        autosave_task: Option<Task<()>>,
        dirty: bool,
        purge_armed: bool,
        status: String,
        _window_activation: Subscription,
    }

    impl IdeallMobile {
        fn new(
            database_path: PathBuf,
            service: LocalWorkspace,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) -> Self {
            let items = service.list_home().unwrap_or_default();
            let workspace = service.load_workspace_state().unwrap_or_default();
            let restore_id = workspace.active_id.as_deref().and_then(|active_id| {
                workspace
                    .tabs
                    .iter()
                    .find(|tab| tab_key(tab) == active_id)
                    .map(|tab| tab.file.file_id.clone())
            });
            let sync_server_draft = service
                .load_sync_settings()
                .unwrap_or_default()
                .server_base_url;
            let agent_settings = service.load_agent_model_settings().unwrap_or_default();
            let secret_store = SystemSecretStore;
            let agent_key_configured = secret_store
                .get(SecretKey::AgentCredential)
                .ok()
                .flatten()
                .is_some();
            let agent_thread_id = service
                .list_agent_threads(1)
                .ok()
                .and_then(|mut threads| threads.pop())
                .map(|thread| thread.id);
            let agent_transcript = agent_thread_id
                .as_deref()
                .and_then(|id| service.agent_transcript(id).ok())
                .unwrap_or_default();
            let window_activation =
                cx.observe_window_activation(window, Self::window_activation_changed);
            let mut this = Self {
                database_path,
                service,
                workspace,
                secret_store,
                items,
                selected_id: None,
                selected_kind: None,
                active_section: "我的",
                show_trash: false,
                search_query: String::new(),
                feed_key_draft: String::new(),
                draft_title: String::new(),
                draft_body: String::new(),
                sync_server_draft,
                sync_code_draft: String::new(),
                sync_token_draft: String::new(),
                agent_base_url_draft: agent_settings.base_url,
                agent_model_draft: agent_settings.model,
                agent_key_draft: String::new(),
                agent_prompt_draft: String::new(),
                sync_code_configured: false,
                sync_token_configured: false,
                sync_in_progress: false,
                agent_key_configured,
                agent_in_progress: false,
                agent_thread_id,
                agent_transcript,
                agent_audits: Vec::new(),
                agent_threads: Vec::new(),
                agent_activity_loading: false,
                embedded_browser: None,
                body_editable: false,
                focus_handle: cx.focus_handle(),
                body_scroll_handle: ScrollHandle::new(),
                body_last_revealed_cursor: None,
                focused_field: None,
                focused_selection_start: 0,
                focused_cursor: 0,
                native_input_composing: false,
                observed_pending_chunks: 0,
                draft_revision: 0,
                autosave_task: None,
                dirty: false,
                purge_armed: false,
                status: "所有内容保存在本机".into(),
                _window_activation: window_activation,
            };
            if let Some(id) = restore_id
                && let Ok(node) = this.service.node(&id)
            {
                let (text, editable, protected_blocks) = this.node_body(&node);
                this.draft_title = node.base().title.clone();
                this.selected_id = Some(id);
                this.selected_kind = Some(node.kind());
                this.draft_body = text;
                this.body_editable = editable;
                this.status = if protected_blocks > 0 {
                    format!("已恢复项目；{protected_blocks} 个未知富文本块以指纹占位保护")
                } else {
                    "已恢复最近打开的本地项目".into()
                };
            }
            this
        }

        fn refresh(&mut self) {
            let result = if self.show_trash {
                self.service.list_trash()
            } else if !self.search_query.trim().is_empty() {
                self.service.search(&self.search_query, 200)
            } else {
                self.service.list_home().map(|mut items| {
                    match self.active_section {
                        "活动" => items.sort_by(|left, right| {
                            right
                                .updated_at
                                .cmp(&left.updated_at)
                                .then_with(|| left.id.cmp(&right.id))
                        }),
                        "浏览" => items.retain(|item| {
                            matches!(item.kind, NodeKind::Bookmark | NodeKind::Feed)
                        }),
                        "应用" | "设置" => items.clear(),
                        _ => {}
                    }
                    items
                })
            };
            match result {
                Ok(items) => self.items = items,
                Err(error) => self.status = error.to_string(),
            }
        }

        fn creation_parent(&self) -> Option<String> {
            (self.selected_kind == Some(NodeKind::Folder))
                .then(|| self.selected_id.clone())
                .flatten()
        }

        fn create_note(&mut self, cx: &mut Context<Self>) {
            let parent = self.creation_parent();
            match self.service.create_note(parent.as_deref(), "无标题笔记") {
                Ok(node) => {
                    self.show_trash = false;
                    self.refresh();
                    self.open_node(node.base().id.clone(), cx);
                    self.focus_field(FocusedField::Body, KeyboardType::Default);
                }
                Err(error) => self.status = error.to_string(),
            }
            cx.notify();
        }

        fn create_folder(&mut self, cx: &mut Context<Self>) {
            let parent = self.creation_parent();
            match self.service.create_folder(parent.as_deref(), "新建文件夹") {
                Ok(node) => {
                    self.show_trash = false;
                    self.refresh();
                    self.open_node(node.base().id.clone(), cx);
                    self.focus_field(FocusedField::Title, KeyboardType::Default);
                }
                Err(error) => self.status = error.to_string(),
            }
            cx.notify();
        }

        fn create_bookmark(&mut self, cx: &mut Context<Self>) {
            let parent = self.creation_parent();
            match self.service.create_bookmark(
                parent.as_deref(),
                "新建书签",
                "https://example.com/",
            ) {
                Ok(node) => {
                    self.show_trash = false;
                    self.refresh();
                    self.open_node(node.base().id.clone(), cx);
                    self.focus_field(FocusedField::Title, KeyboardType::Default);
                    self.status = "请填写标题与 http(s) 地址".into();
                }
                Err(error) => self.status = error.to_string(),
            }
            cx.notify();
        }

        fn create_text_file(&mut self, cx: &mut Context<Self>) {
            let parent = self.creation_parent();
            match self.service.create_file(
                parent.as_deref(),
                "新建文本.txt",
                "text/plain",
                Vec::new(),
            ) {
                Ok(node) => {
                    self.show_trash = false;
                    self.refresh();
                    self.open_node(node.base().id.clone(), cx);
                    self.focus_field(FocusedField::Body, KeyboardType::Default);
                }
                Err(error) => self.status = error.to_string(),
            }
            cx.notify();
        }

        fn import_files(&mut self, cx: &mut Context<Self>) {
            self.stop_editing();
            let parent = self.creation_parent();
            self.status = "正在打开系统文件选择器……".into();
            cx.spawn(async move |view, cx| {
                let selection = cx
                    .background_executor()
                    .spawn(async { select_mobile_documents() })
                    .await;
                cx.update(|cx| {
                    let Some(view) = view.upgrade() else {
                        return;
                    };
                    view.update(cx, |this, cx| {
                        match selection {
                            Ok(files) if files.is_empty() => {
                                this.status = "已取消导入".into();
                            }
                            Ok(files) => {
                                let mut imported = 0_usize;
                                for file in files {
                                    let import_path = match materialize_mobile_document(
                                        &this.database_path,
                                        &file.path,
                                    ) {
                                        Ok(path) => path,
                                        Err(error) => {
                                            this.status = format!(
                                                "已导入 {imported} 个文件；{} 导入失败：{error}",
                                                file.name
                                            );
                                            this.refresh();
                                            cx.notify();
                                            return;
                                        }
                                    };
                                    match this.service.import_external_file(
                                        parent.as_deref(),
                                        &import_path,
                                        &file.name,
                                        256 * 1024 * 1024,
                                    ) {
                                        Ok(_) => imported += 1,
                                        Err(error) => {
                                            this.status = format!(
                                                "已导入 {imported} 个文件；{} 导入失败：{error}",
                                                file.name
                                            );
                                            this.refresh();
                                            cx.notify();
                                            return;
                                        }
                                    }
                                }
                                this.refresh();
                                this.status = format!("已导入 {imported} 个文件");
                            }
                            Err(error) => this.status = error,
                        }
                        cx.notify();
                    });
                })
            })
            .detach();
            cx.notify();
        }

        fn create_agent_draft(&mut self, cx: &mut Context<Self>) {
            self.stop_editing();
            match self.service.create_agent_note_via_mcp("Agent 草稿") {
                Ok(node) => {
                    self.refresh();
                    self.status = format!(
                        "Agent 已通过本地 MCP 创建空白笔记 {}；写操作审计已提交",
                        node.base().id
                    );
                }
                Err(error) => self.status = error.to_string(),
            }
            self.load_agent_activity(cx);
            cx.notify();
        }

        fn persist_agent_model_settings(&mut self) -> Result<(), String> {
            let saved = self
                .service
                .save_agent_model_settings(&AgentModelSettings {
                    base_url: self.agent_base_url_draft.clone(),
                    model: self.agent_model_draft.clone(),
                })
                .map_err(|error| error.to_string())?;
            self.agent_base_url_draft = saved.base_url.clone();
            self.agent_model_draft = saved.model.clone();
            if !self.agent_key_draft.trim().is_empty() {
                let key = self.agent_key_draft.trim();
                OpenAiCompatibleClient::new(&saved.base_url, &saved.model, key)
                    .map_err(|error| error.to_string())?;
                self.secret_store
                    .set(SecretKey::AgentCredential, key)
                    .map_err(|error| error.to_string())?;
                self.agent_key_draft.clear();
                self.agent_key_configured = true;
            }
            Ok(())
        }

        fn save_agent_model_settings(&mut self, cx: &mut Context<Self>) {
            self.stop_editing();
            self.status = match self.persist_agent_model_settings() {
                Ok(()) => "模型设置已保存；API Key 仅在系统安全存储中".into(),
                Err(error) => error,
            };
            cx.notify();
        }

        fn clear_agent_credential(&mut self, cx: &mut Context<Self>) {
            self.stop_editing();
            match self.secret_store.delete(SecretKey::AgentCredential) {
                Ok(_) => {
                    self.agent_key_draft.clear();
                    self.agent_key_configured = false;
                    self.status = "模型 API Key 已从系统安全存储清除".into();
                }
                Err(error) => self.status = error.to_string(),
            }
            cx.notify();
        }

        fn new_agent_thread(&mut self, cx: &mut Context<Self>) {
            if self.agent_in_progress {
                return;
            }
            self.stop_editing();
            self.agent_thread_id = None;
            self.agent_transcript.clear();
            self.agent_prompt_draft.clear();
            self.status = "已开始新对话；发送第一条消息后写入本地 SQLite".into();
            cx.notify();
        }

        fn load_agent_activity(&mut self, cx: &mut Context<Self>) {
            if self.agent_activity_loading {
                return;
            }
            let database_path = self.database_path.clone();
            let task = cx.background_executor().spawn(async move {
                let workspace =
                    LocalWorkspace::open(database_path).map_err(|error| error.to_string())?;
                let audits = workspace
                    .list_agent_audits(50)
                    .map_err(|error| error.to_string())?;
                let threads = workspace
                    .list_agent_threads(12)
                    .map_err(|error| error.to_string())?;
                Ok::<_, String>((audits, threads))
            });
            self.agent_activity_loading = true;
            cx.spawn(async move |view, cx| {
                let result = task.await;
                cx.update(|cx| {
                    let Some(view) = view.upgrade() else {
                        return;
                    };
                    view.update(cx, |this, cx| {
                        this.agent_activity_loading = false;
                        match result {
                            Ok((audits, threads)) => {
                                this.agent_audits = audits;
                                this.agent_threads = threads;
                            }
                            Err(error) => {
                                this.status = format!("加载 Agent 活动失败：{error}");
                            }
                        }
                        cx.notify();
                    });
                })
            })
            .detach();
        }

        fn select_agent_thread(&mut self, thread_id: String, cx: &mut Context<Self>) {
            if self.agent_in_progress {
                return;
            }
            self.stop_editing();
            match self.service.agent_transcript(&thread_id) {
                Ok(messages) => {
                    self.agent_thread_id = Some(thread_id);
                    self.agent_transcript = messages;
                    self.status = "已打开本地 Agent 对话".into();
                }
                Err(error) => self.status = error.to_string(),
            }
            cx.notify();
        }

        fn start_agent_turn(&mut self, cx: &mut Context<Self>) {
            if self.agent_in_progress {
                return;
            }
            self.stop_editing();
            if let Err(error) = self.persist_agent_model_settings() {
                self.status = error;
                cx.notify();
                return;
            }
            let prompt = self.agent_prompt_draft.clone();
            if prompt.trim().is_empty() {
                self.status = "请输入 Agent 消息".into();
                cx.notify();
                return;
            }
            let settings = match self.service.load_agent_model_settings() {
                Ok(settings) => settings,
                Err(error) => {
                    self.status = error.to_string();
                    cx.notify();
                    return;
                }
            };
            let key = match self.secret_store.get(SecretKey::AgentCredential) {
                Ok(Some(key)) => key,
                Ok(None) => {
                    self.status = "请先安全保存模型 API Key".into();
                    cx.notify();
                    return;
                }
                Err(error) => {
                    self.status = error.to_string();
                    cx.notify();
                    return;
                }
            };
            let database_path = self.database_path.clone();
            let thread_id = self.agent_thread_id.clone();
            let task = cx.background_executor().spawn(async move {
                let mut workspace =
                    LocalWorkspace::open(database_path).map_err(|error| error.to_string())?;
                let mut provider =
                    OpenAiCompatibleClient::new(&settings.base_url, &settings.model, &key)
                        .map_err(|error| error.to_string())?;
                workspace
                    .run_agent_turn(&mut provider, thread_id.as_deref(), &prompt)
                    .map_err(|error| error.to_string())
            });
            self.agent_in_progress = true;
            self.status = "Agent 正在本机直连模型服务……".into();
            cx.spawn(async move |view, cx| {
                let result = task.await;
                cx.update(|cx| {
                    let Some(view) = view.upgrade() else {
                        return;
                    };
                    view.update(cx, |this, cx| {
                        this.agent_in_progress = false;
                        match result {
                            Ok(result) => {
                                this.agent_thread_id = Some(result.thread_id.clone());
                                this.agent_transcript = this
                                    .service
                                    .agent_transcript(&result.thread_id)
                                    .unwrap_or_default();
                                this.agent_prompt_draft.clear();
                                this.refresh();
                                let failures = result.tools.iter().filter(|tool| !tool.ok).count();
                                this.status = if result.tools.is_empty() {
                                    "Agent 已回复；对话保存在本地 SQLite".into()
                                } else {
                                    format!(
                                        "Agent 已回复；执行 {} 个工具，{} 个失败；写操作均已审计",
                                        result.tools.len(),
                                        failures
                                    )
                                };
                            }
                            Err(error) => {
                                if this.agent_thread_id.is_none()
                                    && let Some(thread) = this
                                        .service
                                        .list_agent_threads(1)
                                        .ok()
                                        .and_then(|mut threads| threads.pop())
                                {
                                    this.agent_thread_id = Some(thread.id);
                                }
                                if let Some(thread_id) = this.agent_thread_id.as_deref() {
                                    this.agent_transcript = this
                                        .service
                                        .agent_transcript(thread_id)
                                        .unwrap_or_default();
                                }
                                this.status = error;
                            }
                        }
                        this.load_agent_activity(cx);
                        cx.notify();
                    });
                })
            })
            .detach();
            cx.notify();
        }

        fn create_feed(&mut self, cx: &mut Context<Self>) {
            self.stop_editing();
            let key = self.feed_key_draft.clone();
            match self
                .service
                .create_feed(key.trim(), SubscriptionType::Publisher, &key)
            {
                Ok(node) => {
                    self.feed_key_draft.clear();
                    self.refresh();
                    self.status = format!(
                        "已关注发布者 {}；可通过加密同步与旧客户端互通",
                        node.base().title
                    );
                }
                Err(error) => self.status = error.to_string(),
            }
            cx.notify();
        }

        fn open_node(&mut self, id: String, cx: &mut Context<Self>) {
            if self.dirty && self.selected_id.as_deref() == Some(id.as_str()) {
                return;
            }
            if self.selected_id.as_deref() != Some(id.as_str()) {
                self.detach_pending_autosave(cx);
            }
            self.stop_editing();
            self.embedded_browser = None;
            match self.service.node(&id) {
                Ok(node) => {
                    let (text, editable, protected_blocks) = self.node_body(&node);
                    let title = node.base().title.clone();
                    let kind = node.kind();
                    self.draft_title = node.base().title.clone();
                    self.selected_id = Some(id.clone());
                    self.selected_kind = Some(kind);
                    self.draft_body = text;
                    self.body_editable = editable;
                    self.dirty = false;
                    self.purge_armed = false;
                    self.status = if node.kind() == NodeKind::Note && protected_blocks > 0 {
                        format!(
                            "可编辑常用 Markdown 块；{protected_blocks} 个未知块以指纹占位保护，请勿修改占位行"
                        )
                    } else {
                        "本地内容".into()
                    };
                    self.workspace.tabs.clear();
                    self.workspace.active_id = None;
                    self.workspace.open(TabDescriptor {
                        file: FileRef::new("local.nodes", &id),
                        engine_id: mobile_engine_id(kind).into(),
                        title,
                        root_id: Some(HOME_ROOT_ID.into()),
                        navigation_path: Some(format!("/home/{id}")),
                    });
                    self.persist_workspace();
                }
                Err(error) => self.status = error.to_string(),
            }
            cx.notify();
        }

        fn node_body(&self, node: &Node) -> (String, bool, usize) {
            match node {
                Node::Note { base, .. } => self
                    .service
                    .plain_note(&base.id)
                    .map(|document| (document.text, document.editable, document.protected_blocks))
                    .unwrap_or_else(|error| (error.to_string(), false, 0)),
                Node::Bookmark { content, .. } => (content.url.clone(), true, 0),
                Node::File { base, blob_ref, .. } => self
                    .service
                    .text_file(&base.id)
                    .map(|document| (document.text, true, 0))
                    .unwrap_or_else(|_| {
                        (
                            format!(
                                "{} · {} 字节\nBlob：{}",
                                blob_ref.mime, blob_ref.size, blob_ref.key
                            ),
                            false,
                            0,
                        )
                    }),
                Node::Folder { .. } => ("文件夹".into(), false, 0),
                Node::Feed { content, .. } => (content.key.clone(), false, 0),
                Node::Thread { content, .. } => {
                    (format!("{} 条消息", content.messages.len()), false, 0)
                }
            }
        }

        fn focus_field(&mut self, field: FocusedField, keyboard_type: KeyboardType) {
            if field == FocusedField::Body && !self.body_editable {
                return;
            }
            let focus_changed = self.focused_field != Some(field);
            if focus_changed {
                PENDING_TEXT.with(|pending| pending.borrow_mut().clear());
                self.observed_pending_chunks = 0;
            }
            self.focused_field = Some(field);
            let text_len = match field {
                FocusedField::Search => self.search_query.len(),
                FocusedField::FeedKey => self.feed_key_draft.len(),
                FocusedField::Title => self.draft_title.len(),
                FocusedField::Body => self.draft_body.len(),
                FocusedField::SyncServer => self.sync_server_draft.len(),
                FocusedField::SyncCode => self.sync_code_draft.len(),
                FocusedField::SyncToken => self.sync_token_draft.len(),
                FocusedField::AgentBaseUrl => self.agent_base_url_draft.len(),
                FocusedField::AgentModel => self.agent_model_draft.len(),
                FocusedField::AgentKey => self.agent_key_draft.len(),
                FocusedField::AgentPrompt => self.agent_prompt_draft.len(),
            };
            if focus_changed {
                self.focused_selection_start = text_len;
                self.focused_cursor = text_len;
                self.native_input_composing = false;
            } else {
                self.focused_selection_start = self.focused_selection_start.min(text_len);
                self.focused_cursor = self.focused_cursor.min(text_len);
            }
            if field == FocusedField::Body {
                self.body_last_revealed_cursor = None;
            }
            gpui_mobile::set_text_input_callback(Some(Box::new(|text: &str| {
                PENDING_TEXT.with(|pending| pending.borrow_mut().push(text.to_owned()));
            })));
            if !self.show_native_text_input_for_field(field, keyboard_type) {
                gpui_mobile::show_keyboard_with_type(keyboard_type);
            }
            gpui_mobile::TEXT_INPUT_DIRTY.store(true, std::sync::atomic::Ordering::Release);
        }

        fn show_native_text_input_for_field(
            &self,
            field: FocusedField,
            keyboard_type: KeyboardType,
        ) -> bool {
            let (value, multiline, secure, label) = match field {
                FocusedField::Search => (self.search_query.as_str(), false, false, "搜索"),
                FocusedField::FeedKey => (self.feed_key_draft.as_str(), false, false, "发布者域名"),
                FocusedField::Title => (self.draft_title.as_str(), false, false, "标题"),
                FocusedField::Body => {
                    let label = if self.selected_kind == Some(NodeKind::Bookmark) {
                        "网址"
                    } else {
                        "正文"
                    };
                    (
                        self.draft_body.as_str(),
                        self.selected_kind != Some(NodeKind::Bookmark),
                        false,
                        label,
                    )
                }
                FocusedField::SyncServer => (
                    self.sync_server_draft.as_str(),
                    false,
                    false,
                    "同步服务端基址",
                ),
                FocusedField::SyncCode => (self.sync_code_draft.as_str(), false, true, "同步码"),
                FocusedField::SyncToken => {
                    (self.sync_token_draft.as_str(), false, true, "登录令牌")
                }
                FocusedField::AgentBaseUrl => (
                    self.agent_base_url_draft.as_str(),
                    false,
                    false,
                    "模型服务地址",
                ),
                FocusedField::AgentModel => {
                    (self.agent_model_draft.as_str(), false, false, "模型名称")
                }
                FocusedField::AgentKey => {
                    (self.agent_key_draft.as_str(), false, true, "模型 API Key")
                }
                FocusedField::AgentPrompt => {
                    (self.agent_prompt_draft.as_str(), true, false, "Agent 消息")
                }
            };
            native_text::show(
                value,
                self.focused_selection_start,
                self.focused_cursor,
                keyboard_type,
                multiline,
                secure,
                label,
            )
        }

        fn sync_native_text_input(&self) {
            let Some(field) = self.focused_field else {
                return;
            };
            let keyboard_type = match field {
                FocusedField::FeedKey | FocusedField::SyncServer | FocusedField::AgentBaseUrl => {
                    KeyboardType::URL
                }
                _ => KeyboardType::Default,
            };
            let _ = self.show_native_text_input_for_field(field, keyboard_type);
        }

        fn drain_keyboard(&mut self, cx: &mut Context<Self>) {
            let Some(field) = self.focused_field else {
                return;
            };
            let mut changed = false;
            let native_state = native_text::take_pending_text();
            let native_commit = if let Some(state) = native_state {
                let target = match field {
                    FocusedField::Search => &mut self.search_query,
                    FocusedField::FeedKey => &mut self.feed_key_draft,
                    FocusedField::Title => &mut self.draft_title,
                    FocusedField::Body => &mut self.draft_body,
                    FocusedField::SyncServer => &mut self.sync_server_draft,
                    FocusedField::SyncCode => &mut self.sync_code_draft,
                    FocusedField::SyncToken => &mut self.sync_token_draft,
                    FocusedField::AgentBaseUrl => &mut self.agent_base_url_draft,
                    FocusedField::AgentModel => &mut self.agent_model_draft,
                    FocusedField::AgentKey => &mut self.agent_key_draft,
                    FocusedField::AgentPrompt => &mut self.agent_prompt_draft,
                };
                changed = *target != state.value;
                if changed {
                    *target = state.value;
                }
                self.focused_selection_start = state.selection_start.min(target.len());
                self.focused_cursor = state.selection_end.min(target.len());
                while self.focused_selection_start > 0
                    && !target.is_char_boundary(self.focused_selection_start)
                {
                    self.focused_selection_start -= 1;
                }
                while self.focused_cursor > 0 && !target.is_char_boundary(self.focused_cursor) {
                    self.focused_cursor -= 1;
                }
                let committed = mobile_native_edit_committed(
                    changed,
                    self.native_input_composing,
                    state.composing,
                );
                self.native_input_composing = state.composing;
                PENDING_TEXT.with(|pending| pending.borrow_mut().clear());
                committed
            } else {
                PENDING_TEXT.with(|pending| {
                    for chunk in pending.borrow_mut().drain(..) {
                        let target = match field {
                            FocusedField::Search => &mut self.search_query,
                            FocusedField::FeedKey => &mut self.feed_key_draft,
                            FocusedField::Title => &mut self.draft_title,
                            FocusedField::Body => &mut self.draft_body,
                            FocusedField::SyncServer => &mut self.sync_server_draft,
                            FocusedField::SyncCode => &mut self.sync_code_draft,
                            FocusedField::SyncToken => &mut self.sync_token_draft,
                            FocusedField::AgentBaseUrl => &mut self.agent_base_url_draft,
                            FocusedField::AgentModel => &mut self.agent_model_draft,
                            FocusedField::AgentKey => &mut self.agent_key_draft,
                            FocusedField::AgentPrompt => &mut self.agent_prompt_draft,
                        };
                        changed |= apply_mobile_input_at_cursor(
                            target,
                            &mut self.focused_cursor,
                            &chunk,
                            matches!(field, FocusedField::Body | FocusedField::AgentPrompt),
                        );
                        self.focused_selection_start = self.focused_cursor;
                    }
                });
                changed
            };
            self.observed_pending_chunks = 0;
            if !changed && !native_commit {
                return;
            }
            if field == FocusedField::Search {
                self.show_trash = false;
                self.active_section = if self.search_query.trim().is_empty() {
                    "我的"
                } else {
                    "搜索"
                };
                self.refresh();
            } else if native_commit && matches!(field, FocusedField::Title | FocusedField::Body) {
                self.mark_draft_dirty(cx);
            }
        }

        fn mark_draft_dirty(&mut self, cx: &mut Context<Self>) {
            self.dirty = true;
            self.purge_armed = false;
            self.draft_revision = self.draft_revision.wrapping_add(1);
            self.schedule_draft_save(DRAFT_AUTOSAVE_DELAY, cx);
        }

        fn detach_pending_autosave(&mut self, cx: &mut Context<Self>) {
            if self.dirty {
                self.schedule_draft_save(Duration::ZERO, cx);
            }
            self.draft_revision = self.draft_revision.wrapping_add(1);
            if let Some(task) = self.autosave_task.take() {
                task.detach();
            }
        }

        fn schedule_draft_save(&mut self, delay: Duration, cx: &mut Context<Self>) {
            if !self.dirty {
                return;
            }
            let Some(id) = self.selected_id.clone() else {
                return;
            };
            let revision = self.draft_revision;
            let title = self.draft_title.clone();
            let body = self.body_editable.then(|| self.draft_body.clone());
            let database_path = self.database_path.clone();
            let timer = cx.background_executor().timer(delay);
            self.autosave_task = Some(cx.spawn(async move |view, cx| {
                timer.await;
                let save_task = cx.background_executor().spawn(async move {
                    let mut workspace =
                        LocalWorkspace::open(database_path).map_err(|error| error.to_string())?;
                    let node = workspace
                        .save_edits(&id, title, body.as_deref())
                        .map_err(|error| error.to_string())?;
                    Ok::<_, String>((id, NodeSummary::from(&node)))
                });
                let result = save_task.await;
                cx.update(|cx| {
                    let Some(view) = view.upgrade() else {
                        return;
                    };
                    view.update(cx, |this, cx| {
                        if this.draft_revision != revision {
                            if let Err(error) = &result {
                                this.status = format!("上一项草稿自动保存失败：{error}");
                                cx.notify();
                            }
                            return;
                        }
                        match result {
                            Ok((id, summary)) => {
                                if this.selected_id.as_deref() != Some(id.as_str()) {
                                    return;
                                }
                                if let Some(item) = this.items.iter_mut().find(|item| item.id == id)
                                {
                                    item.title = summary.title;
                                    item.updated_at = summary.updated_at;
                                }
                                this.dirty = false;
                                this.status = "已自动保存到本机".into();
                            }
                            Err(error) => {
                                this.status = format!("自动保存失败：{error}");
                            }
                        }
                        cx.notify();
                    });
                })
            }));
        }

        fn window_activation_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
            if window.is_window_active() {
                return;
            }
            self.drain_keyboard(cx);
            self.schedule_draft_save(Duration::ZERO, cx);
        }

        fn save(&mut self, cx: &mut Context<Self>) {
            match self.commit_draft() {
                Ok(()) => self.status = "已保存到本机".into(),
                Err(error) => self.status = error,
            }
            cx.notify();
        }

        fn format_note_block(&mut self, style: MobileBlockStyle, cx: &mut Context<Self>) {
            if self.show_trash || self.selected_kind != Some(NodeKind::Note) || !self.body_editable
            {
                self.status = "当前内容不可格式化".into();
                cx.notify();
                return;
            }
            if self.focused_field != Some(FocusedField::Body) {
                self.focus_field(FocusedField::Body, KeyboardType::Default);
            }
            match apply_mobile_block_style(&mut self.draft_body, &mut self.focused_cursor, style) {
                Ok(true) => {
                    self.focused_selection_start = self.focused_cursor;
                    self.mark_draft_dirty(cx);
                    self.status = "已格式化当前块；保存后写回 Plate 富文本".into();
                    self.sync_native_text_input();
                }
                Ok(false) => {
                    self.status = "当前块已经是该格式".into();
                }
                Err(MobileBlockFormatError::ProtectedBlock) => {
                    self.status = "受保护的未知富文本块不能修改".into();
                }
                Err(MobileBlockFormatError::CodeBlock) => {
                    self.status = "代码围栏内部保持原样；请在普通文本块上应用格式".into();
                }
            }
            gpui_mobile::TEXT_INPUT_DIRTY.store(true, std::sync::atomic::Ordering::Release);
            cx.notify();
        }

        fn run_note_slash_command(&mut self, style: MobileBlockStyle, cx: &mut Context<Self>) {
            if self.focused_field != Some(FocusedField::Body)
                || self.show_trash
                || self.selected_kind != Some(NodeKind::Note)
                || !self.body_editable
            {
                self.status = "请先在笔记正文的新行输入 /".into();
                cx.notify();
                return;
            }
            match apply_mobile_slash_command(&mut self.draft_body, &mut self.focused_cursor, style)
            {
                Ok(true) => {
                    self.focused_selection_start = self.focused_cursor;
                    self.mark_draft_dirty(cx);
                    self.status = "已插入富文本块；保存后写回 Plate".into();
                    self.sync_native_text_input();
                }
                Ok(false) => {
                    self.status = "斜杠命令已经失效，请重新输入 /".into();
                }
                Err(MobileBlockFormatError::ProtectedBlock) => {
                    self.status = "受保护的未知富文本块不能修改".into();
                }
                Err(MobileBlockFormatError::CodeBlock) => {
                    self.status = "代码围栏内部不执行斜杠命令".into();
                }
            }
            gpui_mobile::TEXT_INPUT_DIRTY.store(true, std::sync::atomic::Ordering::Release);
            cx.notify();
        }

        fn move_note_block(&mut self, direction: MobileBlockMove, cx: &mut Context<Self>) {
            if self.show_trash || self.selected_kind != Some(NodeKind::Note) || !self.body_editable
            {
                self.status = "当前内容不可重排".into();
                cx.notify();
                return;
            }
            if self.focused_field != Some(FocusedField::Body) {
                self.focus_field(FocusedField::Body, KeyboardType::Default);
            }
            match move_mobile_block(&mut self.draft_body, &mut self.focused_cursor, direction) {
                Some(true) => {
                    self.focused_selection_start = self.focused_cursor;
                    self.mark_draft_dirty(cx);
                    self.status = "已移动当前块；保存后同步 Plate 块顺序".into();
                    self.sync_native_text_input();
                }
                Some(false) => {
                    self.status = match direction {
                        MobileBlockMove::Up => "当前块已经在最前面",
                        MobileBlockMove::Down => "当前块已经在最后面",
                    }
                    .into();
                }
                None => {
                    self.status = "正文含未闭合代码围栏，修复后才能重排块".into();
                }
            }
            gpui_mobile::TEXT_INPUT_DIRTY.store(true, std::sync::atomic::Ordering::Release);
            cx.notify();
        }

        fn open_bookmark_external(&mut self, cx: &mut Context<Self>) {
            if let Err(error) = self.commit_draft() {
                self.status = error;
                cx.notify();
                return;
            }
            let Some(id) = self.selected_id.clone() else {
                return;
            };
            match self.service.node(&id) {
                Ok(Node::Bookmark { content, .. }) => {
                    match gpui_mobile::packages::url_launcher::launch_url(&content.url) {
                        Ok(true) => self.status = "已交给系统浏览器打开".into(),
                        Ok(false) => self.status = "系统中没有可打开该网址的应用".into(),
                        Err(error) => self.status = error,
                    }
                }
                Ok(_) => self.status = "当前项目不是书签".into(),
                Err(error) => self.status = error.to_string(),
            }
            cx.notify();
        }

        fn open_bookmark_embedded(&mut self, cx: &mut Context<Self>) {
            if let Err(error) = self.commit_draft() {
                self.status = error;
                cx.notify();
                return;
            }
            let Some(id) = self.selected_id.clone() else {
                return;
            };
            let url = match self.service.node(&id) {
                Ok(Node::Bookmark { content, .. }) => content.url,
                Ok(_) => {
                    self.status = "当前项目不是书签".into();
                    cx.notify();
                    return;
                }
                Err(error) => {
                    self.status = error.to_string();
                    cx.notify();
                    return;
                }
            };
            self.stop_editing();
            match gpui_mobile::packages::webview::load_url(
                &url,
                &WebViewSettings {
                    javascript_enabled: true,
                    user_agent: Some("ideall/0.2".into()),
                    zoom_enabled: true,
                    dom_storage_enabled: true,
                    top_offset: 0.0,
                },
            ) {
                Ok(handle) => {
                    self.embedded_browser = Some(handle);
                    self.status = "已在应用内系统 WebView 打开".into();
                }
                Err(error) => self.status = error,
            }
            cx.notify();
        }

        fn open_portal(&mut self, url: &'static str, cx: &mut Context<Self>) {
            self.stop_editing();
            self.embedded_browser = None;
            match gpui_mobile::packages::webview::load_url(
                url,
                &WebViewSettings {
                    javascript_enabled: true,
                    user_agent: Some("ideall/0.2".into()),
                    zoom_enabled: true,
                    dom_storage_enabled: true,
                    top_offset: 0.0,
                },
            ) {
                Ok(handle) => {
                    self.embedded_browser = Some(handle);
                    self.status = "已在隔离系统 WebView 中打开；未注入本地文件或密钥能力".into();
                }
                Err(error) => self.status = error,
            }
            cx.notify();
        }

        fn refresh_sync_secret_status(&mut self) {
            match self.secret_store.get(SecretKey::SyncCode) {
                Ok(value) => self.sync_code_configured = value.is_some(),
                Err(error) => self.status = error.to_string(),
            }
            match self.secret_store.get(SecretKey::SyncBearerToken) {
                Ok(value) => self.sync_token_configured = value.is_some(),
                Err(error) => self.status = error.to_string(),
            }
        }

        fn persist_sync_settings(&mut self) -> Result<(), String> {
            let saved = self
                .service
                .save_sync_settings(&SyncSettings {
                    server_base_url: self.sync_server_draft.clone(),
                })
                .map_err(|error| error.to_string())?;
            self.sync_server_draft = saved.server_base_url;

            if !self.sync_code_draft.trim().is_empty() {
                if !is_valid_sync_code(&self.sync_code_draft) {
                    return Err("同步码必须恰好包含 32 位十六进制字符".into());
                }
                self.secret_store
                    .set(
                        SecretKey::SyncCode,
                        &normalize_sync_code(&self.sync_code_draft),
                    )
                    .map_err(|error| error.to_string())?;
                self.sync_code_draft.clear();
                self.sync_code_configured = true;
            }
            if !self.sync_token_draft.trim().is_empty() {
                if !self
                    .sync_token_draft
                    .trim()
                    .bytes()
                    .all(|byte| byte.is_ascii_graphic())
                {
                    return Err("Bearer Token 只能包含可打印 ASCII 字符".into());
                }
                self.secret_store
                    .set(SecretKey::SyncBearerToken, self.sync_token_draft.trim())
                    .map_err(|error| error.to_string())?;
                self.sync_token_draft.clear();
                self.sync_token_configured = true;
            }
            Ok(())
        }

        fn save_sync_settings(&mut self, cx: &mut Context<Self>) {
            self.stop_editing();
            self.status = match self.persist_sync_settings() {
                Ok(()) => "同步设置已安全保存".into(),
                Err(error) => error,
            };
            cx.notify();
        }

        fn clear_sync_credentials(&mut self, cx: &mut Context<Self>) {
            self.stop_editing();
            let result = self
                .secret_store
                .delete(SecretKey::SyncCode)
                .and_then(|_| self.secret_store.delete(SecretKey::SyncBearerToken));
            match result {
                Ok(_) => {
                    self.sync_code_draft.clear();
                    self.sync_token_draft.clear();
                    self.sync_code_configured = false;
                    self.sync_token_configured = false;
                    self.status = "同步凭据已从系统安全存储清除".into();
                }
                Err(error) => self.status = error.to_string(),
            }
            cx.notify();
        }

        fn start_notes_sync(&mut self, cx: &mut Context<Self>) {
            if self.sync_in_progress {
                return;
            }
            self.stop_editing();
            if let Err(error) = self.persist_sync_settings() {
                self.status = error;
                cx.notify();
                return;
            }
            let settings = match self.service.load_sync_settings() {
                Ok(settings) => settings,
                Err(error) => {
                    self.status = error.to_string();
                    cx.notify();
                    return;
                }
            };
            let code = match self.secret_store.get(SecretKey::SyncCode) {
                Ok(Some(value)) => value,
                Ok(None) => {
                    self.status = "请先保存同步码".into();
                    cx.notify();
                    return;
                }
                Err(error) => {
                    self.status = error.to_string();
                    cx.notify();
                    return;
                }
            };
            let token = match self.secret_store.get(SecretKey::SyncBearerToken) {
                Ok(Some(value)) => value,
                Ok(None) => {
                    self.status = "请先保存登录 Bearer Token".into();
                    cx.notify();
                    return;
                }
                Err(error) => {
                    self.status = error.to_string();
                    cx.notify();
                    return;
                }
            };
            let database_path = self.database_path.clone();
            let task = cx.background_executor().spawn(async move {
                let mut workspace =
                    LocalWorkspace::open(database_path).map_err(|error| error.to_string())?;
                let mut transport = HttpSyncTransport::new(&settings.server_base_url, &token)
                    .map_err(|error| error.to_string())?;
                let subscriptions = workspace
                    .sync_subscriptions(&code, &mut transport)
                    .map_err(|error| error.to_string())?;
                let notes = workspace
                    .sync_notes(&code, &mut transport)
                    .map_err(|error| error.to_string())?;
                let bookmarks = workspace
                    .sync_bookmarks(&code, &mut transport)
                    .map_err(|error| error.to_string())?;
                Ok::<_, String>((subscriptions, notes, bookmarks))
            });
            self.sync_in_progress = true;
            self.status = "正在同步关注、笔记与书签三个加密域……".into();
            cx.spawn(async move |view, cx| {
                let result = task.await;
                cx.update(|cx| {
                    let Some(view) = view.upgrade() else {
                        return;
                    };
                    view.update(cx, |this, cx| {
                        this.sync_in_progress = false;
                        match result {
                            Ok((subscriptions, notes, bookmarks)) => {
                                this.refresh();
                                this.status = format!(
                                    "同步完成：关注 {}、笔记 {}、书签 {} 条；新增 {} 条",
                                    subscriptions.total,
                                    notes.total,
                                    bookmarks.total,
                                    subscriptions.added + notes.added + bookmarks.added
                                );
                            }
                            Err(error) => this.status = error,
                        }
                        cx.notify();
                    });
                })
            })
            .detach();
            cx.notify();
        }

        fn commit_draft(&mut self) -> Result<(), String> {
            if !self.dirty || self.show_trash {
                return Ok(());
            }
            self.autosave_task.take();
            let Some(id) = self.selected_id.clone() else {
                return Ok(());
            };
            let body = self.body_editable.then_some(self.draft_body.as_str());
            self.service
                .save_edits(&id, self.draft_title.clone(), body)
                .map_err(|error| error.to_string())?;
            self.dirty = false;
            self.refresh();
            Ok(())
        }

        fn move_to_trash(&mut self, cx: &mut Context<Self>) {
            if let Err(error) = self.commit_draft() {
                self.status = error;
                cx.notify();
                return;
            }
            let Some(id) = self.selected_id.clone() else {
                return;
            };
            match self.service.move_to_trash(&id) {
                Ok(true) => {
                    self.close_detail(cx);
                    self.status = "已移到回收站".into();
                }
                Ok(false) => self.status = "项目已经删除".into(),
                Err(error) => self.status = error.to_string(),
            }
            self.refresh();
            cx.notify();
        }

        fn restore(&mut self, cx: &mut Context<Self>) {
            let Some(id) = self.selected_id.clone() else {
                return;
            };
            match self.service.restore(&id) {
                Ok(true) => {
                    self.close_detail(cx);
                    self.status = "已从回收站恢复".into();
                }
                Ok(false) => self.status = "未找到回收站快照".into(),
                Err(error) => self.status = error.to_string(),
            }
            self.refresh();
            cx.notify();
        }

        fn purge(&mut self, cx: &mut Context<Self>) {
            if !self.purge_armed {
                self.purge_armed = true;
                self.status = "再次点击“永久删除”确认；此操作无法撤销".into();
                cx.notify();
                return;
            }
            let Some(id) = self.selected_id.clone() else {
                return;
            };
            match self.service.purge(&id) {
                Ok(true) => {
                    self.close_detail(cx);
                    self.status = "已永久删除".into();
                }
                Ok(false) => self.status = "项目已不在回收站".into(),
                Err(error) => self.status = error.to_string(),
            }
            self.refresh();
            cx.notify();
        }

        fn select_section(&mut self, section: &'static str, cx: &mut Context<Self>) {
            if let Err(error) = self.commit_draft() {
                self.status = error;
                cx.notify();
                return;
            }
            self.stop_editing();
            self.selected_id = None;
            self.embedded_browser = None;
            self.selected_kind = None;
            self.draft_title.clear();
            self.draft_body.clear();
            self.body_editable = false;
            self.dirty = false;
            self.purge_armed = false;
            self.workspace.tabs.clear();
            self.workspace.active_id = None;
            self.persist_workspace();
            self.show_trash = section == "回收站";
            self.search_query.clear();
            self.active_section = section;
            self.refresh();
            if section == "设置" {
                if let Ok(settings) = self.service.load_sync_settings() {
                    self.sync_server_draft = settings.server_base_url;
                }
                self.refresh_sync_secret_status();
            }
            if section == "应用" {
                match self.secret_store.get(SecretKey::AgentCredential) {
                    Ok(value) => self.agent_key_configured = value.is_some(),
                    Err(error) => self.status = error.to_string(),
                }
                self.load_agent_activity(cx);
            }
            self.status = match section {
                "活动" => "按最近修改排序",
                "浏览" => "本地书签与关注源",
                "应用" => "原生 Agent 可直连模型，并通过授权 MCP 使用本地工具",
                "设置" => "同步凭据仅保存在系统安全存储中",
                "回收站" => "可恢复或永久删除",
                _ => "所有内容保存在本机",
            }
            .into();
            cx.notify();
        }

        fn close_detail(&mut self, cx: &mut Context<Self>) {
            if let Err(error) = self.commit_draft() {
                self.status = error;
                cx.notify();
                return;
            }
            self.stop_editing();
            self.embedded_browser = None;
            self.selected_id = None;
            self.selected_kind = None;
            self.draft_title.clear();
            self.draft_body.clear();
            self.body_editable = false;
            self.dirty = false;
            self.purge_armed = false;
            self.workspace.tabs.clear();
            self.workspace.active_id = None;
            self.persist_workspace();
            cx.notify();
        }

        fn persist_workspace(&mut self) {
            if let Err(error) = self.service.save_workspace_state(&self.workspace) {
                self.status = error.to_string();
            }
        }

        fn stop_editing(&mut self) {
            self.focused_field = None;
            self.focused_selection_start = 0;
            self.focused_cursor = 0;
            self.native_input_composing = false;
            self.body_last_revealed_cursor = None;
            self.observed_pending_chunks = 0;
            PENDING_TEXT.with(|pending| pending.borrow_mut().clear());
            native_text::clear_pending_text();
            native_text::hide();
            gpui_mobile::hide_keyboard();
            gpui_mobile::set_text_input_callback(None);
        }

        fn handle_control_key(&mut self, event: &KeyDownEvent) {
            if self.focused_field.is_none() {
                return;
            }
            let queued = PENDING_TEXT.with(|pending| {
                enqueue_mobile_control_key(
                    &mut pending.borrow_mut(),
                    &mut self.observed_pending_chunks,
                    &event.keystroke.key,
                )
            });
            if queued {
                gpui_mobile::TEXT_INPUT_DIRTY.store(true, std::sync::atomic::Ordering::Release);
            }
        }
    }

    impl Render for IdeallMobile {
        fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            self.drain_keyboard(cx);
            let (safe_top, safe_bottom, safe_left, safe_right) = gpui_mobile::safe_area_insets();
            let theme = MaterialTheme::light();
            let items = self.items.clone();
            let selected_id = self.selected_id.clone();
            let has_selection = selected_id.is_some();
            let embedded_browser = self
                .embedded_browser
                .as_ref()
                .and_then(WebViewHandle::platform_view_handle);
            let show_embedded_browser = embedded_browser.is_some();
            let show_settings = !has_selection && self.active_section == "设置";
            let show_apps = !has_selection && self.active_section == "应用";
            let show_browse = !has_selection && self.active_section == "浏览";
            let can_create = !self.show_trash && self.active_section == "我的";
            let engine_capabilities = engine_runtime_capabilities(EnginePlatform::current_mobile());
            let agent_audits = self.agent_audits.clone();
            let agent_threads = self.agent_threads.clone();
            let agent_transcript = self.agent_transcript.clone();
            let can_save = self.dirty && !self.show_trash;
            let show_note_toolbar = has_selection
                && !self.show_trash
                && self.selected_kind == Some(NodeKind::Note)
                && self.body_editable;
            let search_focused = self.focused_field == Some(FocusedField::Search);
            let title_focused = self.focused_field == Some(FocusedField::Title);
            let body_focused = self.focused_field == Some(FocusedField::Body);
            if body_focused && self.body_last_revealed_cursor != Some(self.focused_cursor) {
                self.body_scroll_handle
                    .scroll_to_item(mobile_cursor_line_index(
                        &self.draft_body,
                        self.focused_cursor,
                    ));
                self.body_last_revealed_cursor = Some(self.focused_cursor);
            }
            let slash_commands = if show_note_toolbar && body_focused {
                mobile_slash_query(&self.draft_body, self.focused_cursor)
                    .map(mobile_slash_commands)
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            let show_slash_menu = !slash_commands.is_empty();
            let empty_message = match self.active_section {
                "搜索" => "没有匹配的本地内容",
                "回收站" => "回收站为空",
                "活动" => "还没有本地活动",
                "浏览" => "还没有书签或关注源",
                "应用" => "平台 Engine capability 已就绪",
                "设置" => "本地设置已就绪",
                _ => "点击“+ 笔记”开始",
            };
            let focused_cursor = |field: FocusedField, text_len: usize| {
                if self.focused_field == Some(field) {
                    self.focused_cursor.min(text_len)
                } else {
                    text_len
                }
            };
            let root_focus = self.focus_handle.clone();

            let search_input = TextInput::<IdeallMobile>::new("mobile-search", theme)
                .label("搜索")
                .value(&self.search_query)
                .placeholder("标题与正文")
                .focused(search_focused)
                .cursor(focused_cursor(
                    FocusedField::Search,
                    self.search_query.len(),
                ))
                .on_tap(|this, _, _, _| {
                    this.focus_field(FocusedField::Search, KeyboardType::Default);
                })
                .render(cx);
            let feed_key_input = TextInput::<IdeallMobile>::new("mobile-feed-key", theme)
                .label("发布者域名")
                .value(&self.feed_key_draft)
                .placeholder("例如 example.com")
                .focused(self.focused_field == Some(FocusedField::FeedKey))
                .cursor(focused_cursor(
                    FocusedField::FeedKey,
                    self.feed_key_draft.len(),
                ))
                .on_tap(|this, _, _, _| {
                    this.focus_field(FocusedField::FeedKey, KeyboardType::URL);
                })
                .render(cx);
            let title_input = TextInput::<IdeallMobile>::new("mobile-title", theme)
                .label("标题")
                .value(&self.draft_title)
                .placeholder("标题")
                .focused(title_focused)
                .cursor(focused_cursor(FocusedField::Title, self.draft_title.len()))
                .on_tap(|this, _, _, _| {
                    this.focus_field(FocusedField::Title, KeyboardType::Default);
                })
                .render(cx);
            let use_multiline_body =
                matches!(self.selected_kind, Some(NodeKind::Note | NodeKind::File));
            let body_input = if use_multiline_body {
                let body_scroll_handle = self.body_scroll_handle.clone();
                let cursor_line = mobile_cursor_line_index(&self.draft_body, self.focused_cursor);
                let line_elements = mobile_text_line_ranges(&self.draft_body)
                    .into_iter()
                    .enumerate()
                    .map(|(line_index, range)| {
                        let line_start = range.start;
                        let line = self.draft_body[range.clone()].to_owned();
                        let display = if body_focused && line_index == cursor_line {
                            mobile_line_with_cursor(
                                &line,
                                self.focused_cursor.saturating_sub(line_start),
                            )
                        } else if line.is_empty() {
                            "\u{200b}".to_owned()
                        } else {
                            line.clone()
                        };
                        let hit_test_line = line;
                        let hit_test_scroll = body_scroll_handle.clone();
                        div()
                            .w_full()
                            .min_h(px(30.))
                            .px_3()
                            .py_1()
                            .text_sm()
                            .line_height(px(22.))
                            .whitespace_normal()
                            .when(body_focused && line_index == cursor_line, |line| {
                                line.bg(rgb(0xf4f7fb))
                            })
                            .when(self.body_editable && !self.show_trash, |line| {
                                line.cursor_text().on_mouse_down(
                                    MouseButton::Left,
                                    cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                                        this.focus_field(FocusedField::Body, KeyboardType::Default);
                                        let offset = hit_test_scroll
                                            .bounds_for_item(line_index)
                                            .map(|bounds| {
                                                let text_origin =
                                                    bounds.origin + point(px(12.), px(4.));
                                                let local_position = point(
                                                    event.position.x - text_origin.x,
                                                    event.position.y - text_origin.y,
                                                );
                                                let wrap_width =
                                                    (bounds.size.width - px(24.)).max(px(1.));
                                                let text_style = window.text_style();
                                                window
                                                    .text_system()
                                                    .shape_text(
                                                        SharedString::from(hit_test_line.clone()),
                                                        px(14.),
                                                        &[text_style.to_run(hit_test_line.len())],
                                                        Some(wrap_width),
                                                        None,
                                                    )
                                                    .ok()
                                                    .and_then(|mut lines| lines.pop())
                                                    .map(|layout| {
                                                        layout
                                                            .closest_index_for_position(
                                                                local_position,
                                                                px(22.),
                                                            )
                                                            .unwrap_or_else(|index| index)
                                                    })
                                                    .unwrap_or_default()
                                            })
                                            .unwrap_or(hit_test_line.len())
                                            .min(hit_test_line.len());
                                        this.focused_cursor = line_start + offset;
                                        this.focused_selection_start = this.focused_cursor;
                                        this.body_last_revealed_cursor = None;
                                        native_text::update_selection(
                                            this.focused_cursor,
                                            this.focused_cursor,
                                        );
                                        hit_test_scroll.scroll_to_item(line_index);
                                        cx.notify();
                                    }),
                                )
                            })
                            .child(display)
                    });
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(div().text_xs().text_color(rgb(0x5f6672)).child("正文"))
                    .child(
                        div()
                            .id("mobile-body-scroll")
                            .h(px(260.))
                            .min_h(px(180.))
                            .w_full()
                            .overflow_y_scroll()
                            .track_scroll(&body_scroll_handle)
                            .rounded_lg()
                            .border_1()
                            .border_color(rgb(if body_focused { 0x315f9f } else { 0xcbd2dc }))
                            .bg(rgb(if self.body_editable {
                                0xffffff
                            } else {
                                0xf4f5f7
                            }))
                            .children(line_elements),
                    )
                    .into_any_element()
            } else {
                let mut body_builder = TextInput::<IdeallMobile>::new("mobile-body", theme)
                    .label(if self.selected_kind == Some(NodeKind::Bookmark) {
                        "网址"
                    } else {
                        "正文"
                    })
                    .value(&self.draft_body)
                    .placeholder("从这里开始记录……")
                    .focused(body_focused)
                    .cursor(focused_cursor(FocusedField::Body, self.draft_body.len()));
                if self.body_editable && !self.show_trash {
                    let keyboard_type = if self.selected_kind == Some(NodeKind::Bookmark) {
                        KeyboardType::URL
                    } else {
                        KeyboardType::Default
                    };
                    body_builder = body_builder.on_tap(move |this, _, _, _| {
                        this.focus_field(FocusedField::Body, keyboard_type);
                    });
                }
                body_builder.render(cx).into_any_element()
            };
            let sync_server_input = TextInput::<IdeallMobile>::new("mobile-sync-server", theme)
                .label("服务端基址")
                .value(&self.sync_server_draft)
                .placeholder("https://api.wonita.link")
                .focused(self.focused_field == Some(FocusedField::SyncServer))
                .cursor(focused_cursor(
                    FocusedField::SyncServer,
                    self.sync_server_draft.len(),
                ))
                .on_tap(|this, _, _, _| {
                    this.focus_field(FocusedField::SyncServer, KeyboardType::URL);
                })
                .render(cx);
            let masked_code = "*".repeat(self.sync_code_draft.len());
            let sync_code_input = TextInput::<IdeallMobile>::new("mobile-sync-code", theme)
                .label("同步码")
                .value(&masked_code)
                .placeholder("32 位十六进制；留空保持不变")
                .focused(self.focused_field == Some(FocusedField::SyncCode))
                .cursor(focused_cursor(FocusedField::SyncCode, masked_code.len()))
                .on_tap(|this, _, _, _| {
                    this.focus_field(FocusedField::SyncCode, KeyboardType::Default);
                })
                .render(cx);
            let masked_token = "*".repeat(self.sync_token_draft.len());
            let sync_token_input = TextInput::<IdeallMobile>::new("mobile-sync-token", theme)
                .label("登录 Bearer Token")
                .value(&masked_token)
                .placeholder("留空保持不变")
                .focused(self.focused_field == Some(FocusedField::SyncToken))
                .cursor(focused_cursor(FocusedField::SyncToken, masked_token.len()))
                .on_tap(|this, _, _, _| {
                    this.focus_field(FocusedField::SyncToken, KeyboardType::Default);
                })
                .render(cx);
            let agent_base_url_input =
                TextInput::<IdeallMobile>::new("mobile-agent-base-url", theme)
                    .label("模型 API 基址")
                    .value(&self.agent_base_url_draft)
                    .placeholder("https://api.deepseek.com/v1/")
                    .focused(self.focused_field == Some(FocusedField::AgentBaseUrl))
                    .cursor(focused_cursor(
                        FocusedField::AgentBaseUrl,
                        self.agent_base_url_draft.len(),
                    ))
                    .on_tap(|this, _, _, _| {
                        this.focus_field(FocusedField::AgentBaseUrl, KeyboardType::URL);
                    })
                    .render(cx);
            let agent_model_input = TextInput::<IdeallMobile>::new("mobile-agent-model", theme)
                .label("模型名称")
                .value(&self.agent_model_draft)
                .placeholder("deepseek-chat")
                .focused(self.focused_field == Some(FocusedField::AgentModel))
                .cursor(focused_cursor(
                    FocusedField::AgentModel,
                    self.agent_model_draft.len(),
                ))
                .on_tap(|this, _, _, _| {
                    this.focus_field(FocusedField::AgentModel, KeyboardType::Default);
                })
                .render(cx);
            let masked_agent_key = "*".repeat(self.agent_key_draft.len());
            let agent_key_input = TextInput::<IdeallMobile>::new("mobile-agent-key", theme)
                .label("API Key")
                .value(&masked_agent_key)
                .placeholder("留空保持不变")
                .focused(self.focused_field == Some(FocusedField::AgentKey))
                .cursor(focused_cursor(
                    FocusedField::AgentKey,
                    masked_agent_key.len(),
                ))
                .on_tap(|this, _, _, _| {
                    this.focus_field(FocusedField::AgentKey, KeyboardType::Default);
                })
                .render(cx);
            let agent_prompt_input = TextInput::<IdeallMobile>::new("mobile-agent-prompt", theme)
                .label("消息")
                .value(&self.agent_prompt_draft)
                .placeholder("向本地 Agent 提问或调用工具……")
                .focused(self.focused_field == Some(FocusedField::AgentPrompt))
                .cursor(focused_cursor(
                    FocusedField::AgentPrompt,
                    self.agent_prompt_draft.len(),
                ))
                .on_tap(|this, _, _, _| {
                    this.focus_field(FocusedField::AgentPrompt, KeyboardType::Default);
                })
                .render(cx);
            let note_toolbar = [
                (
                    "mobile-format-paragraph",
                    "正文",
                    MobileBlockStyle::Paragraph,
                ),
                ("mobile-format-h1", "标题 1", MobileBlockStyle::Heading1),
                ("mobile-format-h2", "标题 2", MobileBlockStyle::Heading2),
                ("mobile-format-quote", "引用", MobileBlockStyle::Quote),
                ("mobile-format-bullet", "项目", MobileBlockStyle::Bullet),
                ("mobile-format-ordered", "编号", MobileBlockStyle::Ordered),
                ("mobile-format-todo", "任务", MobileBlockStyle::Todo),
                ("mobile-format-code", "代码", MobileBlockStyle::Code),
                ("mobile-format-rule", "分隔线", MobileBlockStyle::Rule),
            ]
            .into_iter()
            .fold(
                div()
                    .id("mobile-note-format-toolbar")
                    .flex()
                    .flex_wrap()
                    .gap_2(),
                |toolbar, (id, label, style)| {
                    toolbar.child(
                        div()
                            .id(id)
                            .px_3()
                            .py_2()
                            .rounded_full()
                            .bg(rgb(0xe8eef8))
                            .text_sm()
                            .cursor_pointer()
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(move |this, _, _, cx| {
                                    this.format_note_block(style, cx);
                                }),
                            )
                            .child(label),
                    )
                },
            )
            .child(
                div()
                    .id("mobile-move-block-up")
                    .px_3()
                    .py_2()
                    .rounded_full()
                    .bg(rgb(0xfff4db))
                    .text_sm()
                    .cursor_pointer()
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, _, _, cx| {
                            this.move_note_block(MobileBlockMove::Up, cx);
                        }),
                    )
                    .child("↑ 当前块"),
            )
            .child(
                div()
                    .id("mobile-move-block-down")
                    .px_3()
                    .py_2()
                    .rounded_full()
                    .bg(rgb(0xfff4db))
                    .text_sm()
                    .cursor_pointer()
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, _, _, cx| {
                            this.move_note_block(MobileBlockMove::Down, cx);
                        }),
                    )
                    .child("↓ 当前块"),
            );
            let note_slash_menu = slash_commands.into_iter().fold(
                div()
                    .id("mobile-note-slash-menu")
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .p_2()
                    .rounded_md()
                    .border_1()
                    .border_color(rgb(0xc7d4e7))
                    .bg(rgb(0xf7faff)),
                |menu, (id, label, style)| {
                    menu.child(
                        div()
                            .id(format!("mobile-slash-{id}"))
                            .px_3()
                            .py_2()
                            .rounded_full()
                            .bg(rgb(0xffffff))
                            .text_sm()
                            .cursor_pointer()
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(move |this, _, _, cx| {
                                    this.run_note_slash_command(style, cx);
                                }),
                            )
                            .child(label),
                    )
                },
            );

            div()
                .size_full()
                .track_focus(&self.focus_handle)
                .on_mouse_down(
                    MouseButton::Left,
                    move |_, window, cx| window.focus(&root_focus, cx),
                )
                .on_key_down(cx.listener(|this, event, _, cx| {
                    this.handle_control_key(event);
                    cx.notify();
                }))
                .flex()
                .flex_col()
                .bg(rgb(0xf5f7fa))
                .text_color(rgb(0x1f2937))
                .pt(px(safe_top))
                .pr(px(safe_right))
                .pb(px(safe_bottom))
                .pl(px(safe_left))
                .child(
                    div()
                        .id("mobile-header")
                        .h(px(52.0))
                        .flex()
                        .items_center()
                        .px_4()
                        .border_b_1()
                        .border_color(rgb(0xdde3ea))
                        .bg(rgb(0xffffff))
                        .child(if has_selection || show_embedded_browser {
                            "‹  返回"
                        } else {
                            self.active_section
                        })
                        .when(has_selection || show_embedded_browser, |bar| {
                            bar.cursor_pointer().on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|this, _, _, cx| this.close_detail(cx)),
                            )
                        })
                        .when(!has_selection && !show_embedded_browser && can_create, |bar| {
                            bar.child(
                                div()
                                    .ml_auto()
                                    .id("mobile-new-note")
                                    .px_3()
                                    .py_2()
                                    .rounded_full()
                                    .bg(rgb(0xe8eef8))
                                    .cursor_pointer()
                                    .on_mouse_down(
                                        MouseButton::Left,
                                        cx.listener(|this, _, _, cx| this.create_note(cx)),
                                    )
                                    .child("+ 笔记"),
                            )
                        }),
                )
                .child(
                    div()
                        .flex_1()
                        .min_h_0()
                        .flex()
                        .flex_col()
                        .p_4()
                        .gap_3()
                        .when(
                            !has_selection
                                && !show_settings
                                && !show_apps
                                && !show_embedded_browser,
                            |content| {
                            content
                                .child(search_input)
                                .when(show_browse, |content| {
                                    content.child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap_2()
                                            .child(feed_key_input)
                                            .child(
                                                div()
                                                    .id("mobile-create-feed")
                                                    .px_4()
                                                    .py_3()
                                                    .rounded_full()
                                                    .bg(rgb(0x315f9f))
                                                    .text_color(rgb(0xffffff))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.create_feed(cx);
                                                        }),
                                                    )
                                                    .child("+ 关注发布者"),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .gap_2()
                                            .child(
                                                div()
                                                    .id("mobile-open-info")
                                                    .px_4()
                                                    .py_3()
                                                    .rounded_full()
                                                    .bg(rgb(0xe8eef8))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.open_portal(INFO_PORTAL_URL, cx);
                                                        }),
                                                    )
                                                    .child("资讯"),
                                            )
                                            .child(
                                                div()
                                                    .id("mobile-open-community")
                                                    .px_4()
                                                    .py_3()
                                                    .rounded_full()
                                                    .bg(rgb(0xe8eef8))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.open_portal(
                                                                COMMUNITY_PORTAL_URL,
                                                                cx,
                                                            );
                                                        }),
                                                    )
                                                    .child("社区"),
                                            ),
                                    )
                                })
                                .when(can_create, |content| {
                                    content.child(
                                        div()
                                            .flex()
                                            .flex_wrap()
                                            .gap_2()
                                            .child(
                                                div()
                                                    .id("mobile-create-folder")
                                                    .px_3()
                                                    .py_2()
                                                    .rounded_full()
                                                    .bg(rgb(0xe8eef8))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.create_folder(cx);
                                                        }),
                                                    )
                                                    .child("+ 文件夹"),
                                            )
                                            .child(
                                                div()
                                                    .id("mobile-create-bookmark")
                                                    .px_3()
                                                    .py_2()
                                                    .rounded_full()
                                                    .bg(rgb(0xe8eef8))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.create_bookmark(cx);
                                                        }),
                                                    )
                                                    .child("+ 书签"),
                                            )
                                            .child(
                                                div()
                                                    .id("mobile-create-file")
                                                    .px_3()
                                                    .py_2()
                                                    .rounded_full()
                                                    .bg(rgb(0xe8eef8))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.create_text_file(cx);
                                                        }),
                                                    )
                                                    .child("+ 空文件"),
                                            )
                                            .child(
                                                div()
                                                    .id("mobile-import-file")
                                                    .px_3()
                                                    .py_2()
                                                    .rounded_full()
                                                    .bg(rgb(0xe8eef8))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.import_files(cx);
                                                        }),
                                                    )
                                                    .child("导入"),
                                            )
                                            .child(
                                                div()
                                                    .id("mobile-show-trash")
                                                    .px_3()
                                                    .py_2()
                                                    .rounded_full()
                                                    .bg(rgb(0xf0f1f3))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.select_section("回收站", cx);
                                                        }),
                                                    )
                                                    .child("回收站"),
                                            ),
                                    )
                                })
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(rgb(0x6b7280))
                                        .child(self.status.clone()),
                                )
                                .child(
                                    div()
                                        .id("mobile-list")
                                        .flex_1()
                                        .min_h_0()
                                        .flex()
                                        .flex_col()
                                        .gap_2()
                                        .overflow_y_scroll()
                                        .when(items.is_empty(), |list| {
                                            list.child(
                                                div()
                                                    .p_4()
                                                    .text_color(rgb(0x6b7280))
                                                    .child(empty_message),
                                            )
                                        })
                                        .children(items.into_iter().map(|item| {
                                            let id = item.id.clone();
                                            div()
                                                .id(format!("mobile-node-{id}"))
                                                .flex()
                                                .items_center()
                                                .gap_3()
                                                .px_3()
                                                .pl(px(12.0 + item.depth as f32 * 14.0))
                                                .py_3()
                                                .rounded_lg()
                                                .bg(rgb(0xffffff))
                                                .cursor_pointer()
                                                .on_mouse_down(
                                                    MouseButton::Left,
                                                    cx.listener(move |this, _, _, cx| {
                                                        this.open_node(id.clone(), cx);
                                                    }),
                                                )
                                                .child(kind_icon(item.kind))
                                                .child(item.title)
                                        })),
                                )
                        },
                        )
                        .when(show_apps, |content| {
                            content.child(
                                div()
                                    .id("mobile-apps-panel")
                                    .flex_1()
                                    .min_h_0()
                                    .flex()
                                    .flex_col()
                                    .gap_3()
                                    .overflow_y_scroll()
                                    .child(div().text_xl().child("Agent 与原生 Engine"))
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(rgb(0x6b7280))
                                            .child("BYOK 由本机直连模型；默认工具可读取节点元数据并创建笔记，但不能读取既有笔记正文或 Blob。"),
                                    )
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(rgb(0x9f2f28))
                                            .child("移动端 capability：不支持启动外部 ACP 子进程；请使用上方 BYOK 模型会话。"),
                                    )
                                    .child(div().text_lg().child("模型连接（OpenAI-compatible）"))
                                    .child(agent_base_url_input)
                                    .child(agent_model_input)
                                    .child(div().text_sm().child(format!(
                                        "API Key：{}",
                                        if self.agent_key_configured {
                                            "已安全配置"
                                        } else {
                                            "未配置"
                                        }
                                    )))
                                    .child(agent_key_input)
                                    .child(
                                        div()
                                            .flex()
                                            .flex_wrap()
                                            .gap_2()
                                            .child(
                                                div()
                                                    .id("mobile-agent-save-settings")
                                                    .px_4()
                                                    .py_3()
                                                    .rounded_full()
                                                    .bg(rgb(0xe8eef8))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.save_agent_model_settings(cx);
                                                        }),
                                                    )
                                                    .child("安全保存"),
                                            )
                                            .child(
                                                div()
                                                    .id("mobile-agent-clear-key")
                                                    .px_4()
                                                    .py_3()
                                                    .rounded_full()
                                                    .bg(rgb(0xffe9e7))
                                                    .text_color(rgb(0x9f2f28))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.clear_agent_credential(cx);
                                                        }),
                                                    )
                                                    .child("清除 Key"),
                                            )
                                            .child(
                                                div()
                                                    .id("mobile-agent-create-draft")
                                                    .px_4()
                                                    .py_3()
                                                    .rounded_full()
                                                    .bg(rgb(0xf3f4f6))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.create_agent_draft(cx);
                                                        }),
                                                    )
                                                    .child("MCP 冒烟：创建草稿"),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .justify_between()
                                            .child(div().text_lg().child("本地对话"))
                                            .child(
                                                div()
                                                    .id("mobile-agent-new-thread")
                                                    .px_4()
                                                    .py_2()
                                                    .rounded_full()
                                                    .bg(rgb(0xe8eef8))
                                                    .when(!self.agent_in_progress, |button| {
                                                        button.cursor_pointer().on_mouse_down(
                                                            MouseButton::Left,
                                                            cx.listener(|this, _, _, cx| {
                                                                this.new_agent_thread(cx);
                                                            }),
                                                        )
                                                    })
                                                    .child("新对话"),
                                            ),
                                    )
                                    .when(agent_threads.is_empty(), |threads| {
                                        threads.child(
                                            div()
                                                .text_sm()
                                                .text_color(rgb(0x6b7280))
                                                .child("尚无 Agent 对话"),
                                        )
                                    })
                                    .child(
                                        div()
                                            .flex()
                                            .flex_wrap()
                                            .gap_2()
                                            .children(agent_threads.into_iter().map(|thread| {
                                                let id = thread.id.clone();
                                                let selected = self.agent_thread_id.as_deref()
                                                    == Some(thread.id.as_str());
                                                div()
                                                    .id(format!("mobile-agent-thread-{}", thread.id))
                                                    .px_3()
                                                    .py_2()
                                                    .rounded_full()
                                                    .bg(rgb(if selected { 0x315f9f } else { 0xf3f4f6 }))
                                                    .text_color(rgb(if selected { 0xffffff } else { 0x1f2937 }))
                                                    .when(!self.agent_in_progress, |button| {
                                                        button.cursor_pointer().on_mouse_down(
                                                            MouseButton::Left,
                                                            cx.listener(move |this, _, _, cx| {
                                                                this.select_agent_thread(id.clone(), cx);
                                                            }),
                                                        )
                                                    })
                                                    .child(thread.title)
                                            })),
                                    )
                                    .when(agent_transcript.is_empty(), |messages| {
                                        messages.child(
                                            div()
                                                .p_3()
                                                .rounded_lg()
                                                .bg(rgb(0xffffff))
                                                .text_color(rgb(0x6b7280))
                                                .child("输入消息开始对话"),
                                        )
                                    })
                                    .children(agent_transcript.into_iter().map(|message| {
                                        div()
                                            .p_3()
                                            .rounded_lg()
                                            .border_1()
                                            .border_color(rgb(0xdde3ea))
                                            .bg(rgb(match message.role {
                                                ModelRole::User => 0xe8eef8,
                                                ModelRole::Assistant => 0xffffff,
                                                ModelRole::Tool => 0xf3f4f6,
                                                ModelRole::System => 0xfffbeb,
                                            }))
                                            .child(
                                                div()
                                                    .text_sm()
                                                    .text_color(rgb(0x6b7280))
                                                    .child(agent_role_label(message.role)),
                                            )
                                            .child(message.content)
                                    }))
                                    .child(agent_prompt_input)
                                    .child(
                                        div()
                                            .id("mobile-agent-send")
                                            .px_4()
                                            .py_3()
                                            .rounded_full()
                                            .bg(rgb(if self.agent_in_progress {
                                                0xaab4c2
                                            } else {
                                                0x315f9f
                                            }))
                                            .text_color(rgb(0xffffff))
                                            .when(!self.agent_in_progress, |button| {
                                                button.cursor_pointer().on_mouse_down(
                                                    MouseButton::Left,
                                                    cx.listener(|this, _, _, cx| {
                                                        this.start_agent_turn(cx);
                                                    }),
                                                )
                                            })
                                            .child(if self.agent_in_progress {
                                                "Agent 处理中……"
                                            } else {
                                                "发送给 Agent"
                                            }),
                                    )
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(rgb(0x6b7280))
                                            .child(self.status.clone()),
                                    )
                                    .child(
                                        div()
                                            .text_lg()
                                            .child(format!(
                                                "平台 Engine 能力（{}）",
                                                engine_capabilities.len()
                                            )),
                                    )
                                    .children(engine_capabilities.into_iter().map(|capability| {
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap_1()
                                            .px_3()
                                            .py_2()
                                            .rounded_lg()
                                            .border_1()
                                            .border_color(rgb(0xdde3ea))
                                            .bg(rgb(0xffffff))
                                            .child(
                                                div()
                                                    .flex()
                                                    .justify_between()
                                                    .child(format!(
                                                        "{} · {}",
                                                        capability.label, capability.engine_id
                                                    ))
                                                    .child(
                                                        div()
                                                            .text_sm()
                                                            .text_color(rgb(
                                                                if capability.kind.is_available() {
                                                                    0x315f9f
                                                                } else {
                                                                    0x9f2f28
                                                                },
                                                            ))
                                                            .child(format!(
                                                                "{} / {}",
                                                                capability.kind.label(),
                                                                engine_access_label(
                                                                    capability.access
                                                                )
                                                            )),
                                                    ),
                                            )
                                            .child(
                                                div()
                                                    .text_sm()
                                                    .text_color(rgb(0x6b7280))
                                                    .child(capability.detail),
                                            )
                                    }))
                                    .child(div().text_lg().child("最近写操作审计"))
                                    .when(agent_audits.is_empty(), |audits| {
                                        audits.child(
                                            div()
                                                .p_3()
                                                .rounded_lg()
                                                .bg(rgb(0xffffff))
                                                .text_color(rgb(0x6b7280))
                                                .child("尚无 Agent 写操作"),
                                        )
                                    })
                                    .children(agent_audits.into_iter().map(|audit| {
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap_1()
                                            .p_3()
                                            .rounded_lg()
                                            .border_1()
                                            .border_color(rgb(0xdde3ea))
                                            .bg(rgb(0xffffff))
                                            .child(
                                                div()
                                                    .flex()
                                                    .justify_between()
                                                    .child(audit.title)
                                                    .child(audit_status_label(audit.status)),
                                            )
                                            .child(
                                                div()
                                                    .text_sm()
                                                    .text_color(rgb(0x6b7280))
                                                    .child(format!(
                                                        "{} · {}",
                                                        audit.operation, audit.summary
                                                    )),
                                            )
                                    })),
                            )
                        })
                        .when(show_settings, |content| {
                            content
                                .child(div().text_xl().child("端到端加密同步"))
                                .child(
                                    div().text_sm().text_color(rgb(0x6b7280)).child(
                                        "服务端只保存密文；同步码与 Token 由系统安全存储保护。",
                                    ),
                                )
                                .child(sync_server_input)
                                .child(div().text_sm().child(format!(
                                    "同步码：{}",
                                    if self.sync_code_configured {
                                        "已配置"
                                    } else {
                                        "未配置"
                                    }
                                )))
                                .child(sync_code_input)
                                .child(div().text_sm().child(format!(
                                    "登录 Token：{}",
                                    if self.sync_token_configured {
                                        "已配置"
                                    } else {
                                        "未配置"
                                    }
                                )))
                                .child(sync_token_input)
                                .child(
                                    div()
                                        .flex()
                                        .flex_wrap()
                                        .gap_2()
                                        .child(
                                            div()
                                                .id("mobile-save-sync-settings")
                                                .px_4()
                                                .py_3()
                                                .rounded_full()
                                                .bg(rgb(0xe8eef8))
                                                .cursor_pointer()
                                                .on_mouse_down(
                                                    MouseButton::Left,
                                                    cx.listener(|this, _, _, cx| {
                                                        this.save_sync_settings(cx);
                                                    }),
                                                )
                                                .child("安全保存"),
                                        )
                                        .child(
                                            div()
                                                .id("mobile-sync-notes")
                                                .px_4()
                                                .py_3()
                                                .rounded_full()
                                                .bg(rgb(if self.sync_in_progress {
                                                    0xaab4c2
                                                } else {
                                                    0x315f9f
                                                }))
                                                .text_color(rgb(0xffffff))
                                                .when(!self.sync_in_progress, |button| {
                                                    button.cursor_pointer().on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.start_notes_sync(cx);
                                                        }),
                                                    )
                                                })
                                                .child(if self.sync_in_progress {
                                                    "同步中……"
                                                } else {
                                                    "立即同步全部"
                                                }),
                                        )
                                        .child(
                                            div()
                                                .id("mobile-clear-sync-secrets")
                                                .px_4()
                                                .py_3()
                                                .rounded_full()
                                                .bg(rgb(0xffe9e7))
                                                .text_color(rgb(0x9f2f28))
                                                .cursor_pointer()
                                                .on_mouse_down(
                                                    MouseButton::Left,
                                                    cx.listener(|this, _, _, cx| {
                                                        this.clear_sync_credentials(cx);
                                                    }),
                                                )
                                                .child("清除凭据"),
                                        ),
                                )
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(rgb(0x6b7280))
                                        .child(self.status.clone()),
                                )
                        })
                        .when(show_embedded_browser, |content| {
                            content.child(
                                platform_view_element(embedded_browser.clone().unwrap())
                                    .flex_1()
                                    .min_h_0()
                                    .size_full(),
                            )
                        })
                        .when(has_selection && !show_embedded_browser, |content| {
                            content
                                .child(title_input)
                                .when(show_note_toolbar, |content| content.child(note_toolbar))
                                .when(show_slash_menu, |content| content.child(note_slash_menu))
                                .child(body_input)
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(rgb(0x6b7280))
                                        .child(self.status.clone()),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .gap_3()
                                        .child(
                                            div()
                                                .id("mobile-save")
                                                .px_4()
                                                .py_3()
                                                .rounded_full()
                                                .bg(rgb(if can_save { 0x315f9f } else { 0xaab4c2 }))
                                                .text_color(rgb(0xffffff))
                                                .when(can_save, |button| {
                                                    button.cursor_pointer().on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| this.save(cx)),
                                                    )
                                                })
                                                .child(if self.dirty {
                                                    "保存"
                                                } else {
                                                    "已保存"
                                                }),
                                        )
                                        .when(
                                            !self.show_trash
                                                && self.selected_kind == Some(NodeKind::Bookmark),
                                            |actions| {
                                                actions
                                                    .child(
                                                        div()
                                                            .id("mobile-open-bookmark")
                                                            .px_4()
                                                            .py_3()
                                                            .rounded_full()
                                                            .bg(rgb(0xe8eef8))
                                                            .cursor_pointer()
                                                            .on_mouse_down(
                                                                MouseButton::Left,
                                                                cx.listener(|this, _, _, cx| {
                                                                    this.open_bookmark_external(cx);
                                                                }),
                                                            )
                                                            .child("浏览器打开"),
                                                    )
                                                    .child(
                                                        div()
                                                            .id("mobile-embed-bookmark")
                                                            .px_4()
                                                            .py_3()
                                                            .rounded_full()
                                                            .bg(rgb(0xe8eef8))
                                                            .cursor_pointer()
                                                            .on_mouse_down(
                                                                MouseButton::Left,
                                                                cx.listener(|this, _, _, cx| {
                                                                    this.open_bookmark_embedded(cx);
                                                                }),
                                                            )
                                                            .child("应用内打开"),
                                                    )
                                            },
                                        )
                                        .when(!self.show_trash, |actions| {
                                            actions.child(
                                                div()
                                                    .id("mobile-trash")
                                                    .px_4()
                                                    .py_3()
                                                    .rounded_full()
                                                    .bg(rgb(0xffe9e7))
                                                    .text_color(rgb(0x9f2f28))
                                                    .cursor_pointer()
                                                    .on_mouse_down(
                                                        MouseButton::Left,
                                                        cx.listener(|this, _, _, cx| {
                                                            this.move_to_trash(cx);
                                                        }),
                                                    )
                                                    .child("删除"),
                                            )
                                        })
                                        .when(self.show_trash, |actions| {
                                            actions
                                                .child(
                                                    div()
                                                        .id("mobile-restore")
                                                        .px_4()
                                                        .py_3()
                                                        .rounded_full()
                                                        .bg(rgb(0xe8eef8))
                                                        .cursor_pointer()
                                                        .on_mouse_down(
                                                            MouseButton::Left,
                                                            cx.listener(|this, _, _, cx| {
                                                                this.restore(cx);
                                                            }),
                                                        )
                                                        .child("恢复"),
                                                )
                                                .child(
                                                    div()
                                                        .id("mobile-purge")
                                                        .px_4()
                                                        .py_3()
                                                        .rounded_full()
                                                        .bg(rgb(if self.purge_armed {
                                                            0xc4372f
                                                        } else {
                                                            0xffe9e7
                                                        }))
                                                        .text_color(rgb(if self.purge_armed {
                                                            0xffffff
                                                        } else {
                                                            0x9f2f28
                                                        }))
                                                        .cursor_pointer()
                                                        .on_mouse_down(
                                                            MouseButton::Left,
                                                            cx.listener(|this, _, _, cx| {
                                                                this.purge(cx);
                                                            }),
                                                        )
                                                        .child("永久删除"),
                                                )
                                        }),
                                )
                        }),
                )
                .child(
                    div()
                        .h(px(56.0))
                        .flex()
                        .items_center()
                        .justify_around()
                        .border_t_1()
                        .border_color(rgb(0xdde3ea))
                        .bg(rgb(0xffffff))
                        .children(["我的", "活动", "浏览", "应用", "设置"].map(|section| {
                            let selected = self.active_section == section && !self.show_trash;
                            div()
                                .id(format!("mobile-section-{section}"))
                                .px_2()
                                .py_2()
                                .rounded_md()
                                .when(selected, |item| item.bg(rgb(0xe8eef8)))
                                .cursor_pointer()
                                .on_mouse_down(
                                    MouseButton::Left,
                                    cx.listener(move |this, _, _, cx| {
                                        this.select_section(section, cx);
                                    }),
                                )
                                .child(section)
                        })),
                )
        }
    }

    #[cfg(target_os = "ios")]
    fn select_mobile_documents() -> Result<Vec<SelectedMobileDocument>, String> {
        use std::ffi::CStr;

        // SAFETY: the Objective-C bridge returns either null or a malloc-owned,
        // NUL-terminated JSON string and requires the paired free function.
        let pointer =
            crate::ios_host::pick_files().ok_or_else(|| "iOS 文件选择桥接尚未初始化".to_owned())?;
        if pointer.is_null() {
            return Ok(Vec::new());
        }
        // SAFETY: pointer validity is guaranteed by ideall_pick_files until it
        // is passed to ideall_free_string below.
        let raw = unsafe { CStr::from_ptr(pointer) }
            .to_string_lossy()
            .into_owned();
        // SAFETY: this is exactly the pointer returned above and is freed once.
        unsafe { crate::ios_host::free_string(pointer) };
        let values: Vec<serde_json::Value> =
            serde_json::from_str(&raw).map_err(|_| "系统文件选择结果无效".to_owned())?;
        values
            .into_iter()
            .map(|value| {
                let path = value
                    .get("path")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| "系统文件地址无效".to_owned())?;
                let name = value
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| "系统文件名无效".to_owned())?;
                Ok(SelectedMobileDocument {
                    path: path.to_owned(),
                    name: name.to_owned(),
                })
            })
            .collect()
    }

    #[cfg(not(target_os = "ios"))]
    fn select_mobile_documents() -> Result<Vec<SelectedMobileDocument>, String> {
        let options = gpui_mobile::packages::file_selector::OpenFileOptions::default();
        gpui_mobile::packages::file_selector::open_files(&options).map(|files| {
            files
                .into_iter()
                .map(|file| SelectedMobileDocument {
                    path: file.path,
                    name: file.name,
                })
                .collect()
        })
    }

    struct SelectedMobileDocument {
        path: String,
        name: String,
    }

    #[cfg(target_os = "ios")]
    fn materialize_mobile_document(
        database_path: &std::path::Path,
        source: &str,
    ) -> Result<String, String> {
        use std::ffi::CString;

        let directory = database_path
            .parent()
            .ok_or_else(|| "移动数据目录不可用".to_owned())?;
        let destination = directory.join("selected-document.cache");
        let source = CString::new(source).map_err(|_| "文件地址包含无效字符".to_owned())?;
        let destination_text = destination
            .to_str()
            .ok_or_else(|| "导入缓存路径不是 UTF-8".to_owned())?;
        let destination_c =
            CString::new(destination_text).map_err(|_| "导入缓存路径包含无效字符".to_owned())?;
        let status = crate::ios_host::copy_security_scoped_file(
            source.as_ptr(),
            destination_c.as_ptr(),
            256 * 1024 * 1024,
        )
        .ok_or_else(|| "iOS 文件访问桥接尚未初始化".to_owned())?;
        if status != 0 {
            return Err(match status {
                1 => "文件地址无效",
                2 => "无法获得所选文件的读取权限",
                3 => "文件超过 256 MiB 导入上限",
                _ => "复制所选文件失败",
            }
            .into());
        }
        Ok(destination_text.to_owned())
    }

    #[cfg(not(target_os = "ios"))]
    fn materialize_mobile_document(
        _database_path: &std::path::Path,
        source: &str,
    ) -> Result<String, String> {
        Ok(source.to_owned())
    }

    fn kind_icon(kind: NodeKind) -> &'static str {
        match kind {
            NodeKind::Folder => "▸",
            NodeKind::Note => "N",
            NodeKind::Bookmark => "↗",
            NodeKind::File => "F",
            NodeKind::Feed => "◎",
            NodeKind::Thread => "#",
        }
    }

    fn engine_access_label(access: EngineAccess) -> &'static str {
        match access {
            EngineAccess::ReadOnly => "只读",
            EngineAccess::ReadWrite => "读写",
        }
    }

    fn mobile_engine_id(kind: NodeKind) -> &'static str {
        match kind {
            NodeKind::Folder => "ideall.directory",
            NodeKind::Note => "ideall.note",
            NodeKind::Bookmark => "ideall.bookmark",
            NodeKind::File => "ideall.preview",
            NodeKind::Feed => "ideall.feed",
            NodeKind::Thread => "ideall.thread",
        }
    }

    fn audit_status_label(status: AuditStatus) -> &'static str {
        match status {
            AuditStatus::Pending => "执行中",
            AuditStatus::Committed => "已提交",
            AuditStatus::Failed => "失败",
            AuditStatus::Rejected => "已拒绝",
            AuditStatus::Undone => "已撤销",
        }
    }

    fn agent_role_label(role: ModelRole) -> &'static str {
        match role {
            ModelRole::System => "系统",
            ModelRole::User => "你",
            ModelRole::Assistant => "Agent",
            ModelRole::Tool => "工具",
        }
    }

    pub fn open_main_window(cx: &mut App) {
        let initialized = (|| {
            ideall_secrets::initialize_platform()
                .map_err(|error| format!("无法初始化系统安全存储：{error}"))?;
            let support = gpui_mobile::packages::path_provider::support_directory()
                .map_err(|error| format!("无法确定应用数据目录：{error}"))?;
            std::fs::create_dir_all(&support)
                .map_err(|error| format!("无法创建应用数据目录：{error}"))?;
            let database_path = support.join("ideall.db");
            let service = LocalWorkspace::open(&database_path)
                .map_err(|error| format!("无法打开本地数据库：{error}"))?;
            Ok::<_, String>((database_path, service))
        })();

        let window_result = match initialized {
            Ok((database_path, service)) => cx
                .open_window(WindowOptions::default(), |window, cx| {
                    let view = cx.new(|cx| IdeallMobile::new(database_path, service, window, cx));
                    let focus_handle = view.read(cx).focus_handle.clone();
                    window.focus(&focus_handle, cx);
                    view
                })
                .map(|_| ()),
            Err(message) => cx
                .open_window(WindowOptions::default(), |_window, cx| {
                    cx.new(|_| MobileStartupFailure { message })
                })
                .map(|_| ()),
        };
        if let Err(error) = window_result {
            log::error!("failed to open ideall mobile window: {error}");
        }
        cx.activate(true);
    }
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
fn android_main(app: android_activity::AndroidApp) {
    use gpui_mobile::gpui::Application;

    android_logger::init_once(
        android_logger::Config::default()
            .with_max_level(log::LevelFilter::Info)
            .with_tag("ideall"),
    );
    gpui_mobile::android::jni::install_panic_hook();
    let platform = gpui_mobile::android::jni::init_platform(&app);
    let shared_platform =
        gpui_mobile::android::platform::SharedPlatform::new(platform.clone()).into_rc();
    Application::with_platform(shared_platform).run(mobile::open_main_window);
    gpui_mobile::android::jni::clear_platform(&platform);
}

#[cfg(target_os = "ios")]
#[unsafe(no_mangle)]
pub extern "C" fn gpui_ios_register_app() {
    gpui_mobile::ios::ffi::set_app_callback(Box::new(mobile::open_main_window));
}

/// Exposes the real mobile composition root to host-only compile checks.
#[cfg(all(
    not(any(target_os = "ios", target_os = "android")),
    feature = "mobile-ui-host-check"
))]
pub fn mobile_ui_host_check_entry() -> fn(&mut gpui_mobile::gpui::App) {
    mobile::open_main_window
}

/// Lets host checks prove that the crate stays platform-gated without pretending to run mobile UI.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn mobile_targets_only() -> &'static str {
    "ideall-mobile requires an iOS or Android target"
}

#[cfg(test)]
mod tests {
    use super::editor::{
        BlockFormatError as MobileBlockFormatError, BlockMove as MobileBlockMove,
        BlockStyle as MobileBlockStyle, apply_block_style as apply_mobile_block_style,
        apply_input as apply_mobile_input, apply_input_at_cursor as apply_mobile_input_at_cursor,
        apply_slash_command as apply_mobile_slash_command,
        control_sequence as mobile_control_sequence, cursor_line_index as mobile_cursor_line_index,
        enqueue_control_key as enqueue_mobile_control_key,
        line_with_cursor as mobile_line_with_cursor, move_block as move_mobile_block,
        native_edit_committed as mobile_native_edit_committed,
        slash_commands as mobile_slash_commands, slash_query as mobile_slash_query,
        text_line_ranges as mobile_text_line_ranges,
    };

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    #[test]
    fn host_build_explains_platform_requirement() {
        assert!(super::mobile_targets_only().contains("iOS or Android"));
    }

    #[test]
    fn mobile_input_accepts_committed_cjk_and_normalizes_multiline_text() {
        let mut text = "开".to_owned();
        assert!(apply_mobile_input(&mut text, "始记录", true));
        assert!(apply_mobile_input(&mut text, "\r\n第二行\r第三行", true));
        assert_eq!(text, "开始记录\n第二行\n第三行");
    }

    #[test]
    fn mobile_backspace_removes_a_complete_emoji_grapheme() {
        let mut text = "A👨‍👩‍👧‍👦".to_owned();
        assert!(apply_mobile_input(&mut text, "\u{8}", false));
        assert_eq!(text, "A");
        assert!(apply_mobile_input(&mut text, "\u{8}", false));
        assert!(text.is_empty());
        assert!(!apply_mobile_input(&mut text, "\u{8}", false));
    }

    #[test]
    fn mobile_single_line_input_filters_newlines_without_dropping_unicode() {
        let mut text = String::new();
        assert!(apply_mobile_input(&mut text, "模型\r\n名称🙂", false));
        assert_eq!(text, "模型名称🙂");
    }

    #[test]
    fn mobile_multiline_layout_keeps_empty_and_trailing_lines() {
        let empty = mobile_text_line_ranges("");
        assert_eq!(empty.len(), 1);
        assert_eq!(empty[0], 0..0);
        let single = mobile_text_line_ranges("第一行");
        assert_eq!(single.len(), 1);
        assert_eq!(single[0], 0.."第一行".len());
        assert_eq!(
            mobile_text_line_ranges("甲\n\n乙\n"),
            [0.."甲".len(), 4..4, 5..8, 9..9]
        );
    }

    #[test]
    fn mobile_multiline_cursor_uses_visual_line_boundaries() {
        let text = "甲\n🙂\n";
        assert_eq!(mobile_cursor_line_index(text, 0), 0);
        assert_eq!(mobile_cursor_line_index(text, "甲".len()), 0);
        assert_eq!(mobile_cursor_line_index(text, "甲\n".len()), 1);
        assert_eq!(mobile_cursor_line_index(text, "甲\n🙂\n".len()), 2);
    }

    #[test]
    fn mobile_cursor_marker_never_splits_utf8() {
        assert_eq!(mobile_line_with_cursor("甲🙂乙", 3), "甲▏🙂乙");
        assert_eq!(mobile_line_with_cursor("甲🙂乙", 5), "甲▏🙂乙");
        assert_eq!(mobile_line_with_cursor("甲🙂乙", usize::MAX), "甲🙂乙▏");
    }

    #[test]
    fn mobile_native_ime_only_persists_committed_composition() {
        assert!(!mobile_native_edit_committed(true, false, true));
        assert!(!mobile_native_edit_committed(false, true, true));
        assert!(mobile_native_edit_committed(false, true, false));
        assert!(mobile_native_edit_committed(true, false, false));
        assert!(!mobile_native_edit_committed(false, false, false));
    }

    #[test]
    fn mobile_cursor_navigation_inserts_and_deletes_whole_graphemes() {
        let mut text = "A👨‍👩‍👧‍👦B".to_owned();
        let mut cursor = text.len();
        assert!(!apply_mobile_input_at_cursor(
            &mut text,
            &mut cursor,
            "\u{1b}[D",
            false,
        ));
        assert!(apply_mobile_input_at_cursor(
            &mut text,
            &mut cursor,
            "\u{8}",
            false,
        ));
        assert_eq!(text, "AB");
        assert_eq!(cursor, 1);
        assert!(apply_mobile_input_at_cursor(
            &mut text,
            &mut cursor,
            "中",
            false,
        ));
        assert_eq!(text, "A中B");
    }

    #[test]
    fn mobile_forward_delete_and_home_end_are_bounded() {
        let mut text = "甲🙂乙".to_owned();
        let mut cursor = text.len();
        assert!(!apply_mobile_input_at_cursor(
            &mut text,
            &mut cursor,
            "\u{1b}[H",
            false,
        ));
        assert!(apply_mobile_input_at_cursor(
            &mut text,
            &mut cursor,
            "\u{1b}[3~",
            false,
        ));
        assert_eq!(text, "🙂乙");
        assert!(!apply_mobile_input_at_cursor(
            &mut text,
            &mut cursor,
            "\u{1b}[F",
            false,
        ));
        assert!(!apply_mobile_input_at_cursor(
            &mut text,
            &mut cursor,
            "\u{7f}",
            false,
        ));
    }

    #[test]
    fn mobile_hardware_control_keys_fill_platform_callback_gaps_without_duplicates() {
        assert_eq!(mobile_control_sequence("backspace"), Some("\u{8}"));
        assert_eq!(mobile_control_sequence("delete"), Some("\u{1b}[3~"));
        assert_eq!(mobile_control_sequence("enter"), Some("\n"));
        assert_eq!(mobile_control_sequence("a"), None);

        let mut pending = vec!["\u{8}".to_owned()];
        let mut observed = 0;
        assert!(!enqueue_mobile_control_key(
            &mut pending,
            &mut observed,
            "backspace"
        ));
        assert_eq!(pending, ["\u{8}"]);

        assert!(enqueue_mobile_control_key(
            &mut pending,
            &mut observed,
            "backspace"
        ));
        assert_eq!(pending, ["\u{8}", "\u{8}"]);

        pending.clear();
        observed = 0;
        assert!(enqueue_mobile_control_key(
            &mut pending,
            &mut observed,
            "delete"
        ));
        assert_eq!(pending, ["\u{1b}[3~"]);
    }

    #[test]
    fn mobile_block_toolbar_formats_the_line_at_the_cursor() {
        let mut text = "第一段\n  - 现有项目\n末段".to_owned();
        let mut cursor = text.find("现有").unwrap() + "现".len();
        assert_eq!(
            apply_mobile_block_style(&mut text, &mut cursor, MobileBlockStyle::Todo),
            Ok(true)
        );
        assert_eq!(text, "第一段\n  - [ ] 现有项目\n末段");
        assert_eq!(&text[cursor..], "有项目\n末段");

        assert_eq!(
            apply_mobile_block_style(&mut text, &mut cursor, MobileBlockStyle::Heading2),
            Ok(true)
        );
        assert_eq!(text, "第一段\n## 现有项目\n末段");
        assert_eq!(&text[cursor..], "有项目\n末段");

        assert_eq!(
            apply_mobile_block_style(&mut text, &mut cursor, MobileBlockStyle::Paragraph),
            Ok(true)
        );
        assert_eq!(text, "第一段\n现有项目\n末段");
        assert_eq!(&text[cursor..], "有项目\n末段");

        assert_eq!(
            apply_mobile_block_style(&mut text, &mut cursor, MobileBlockStyle::Bullet),
            Ok(true)
        );
        assert_eq!(text, "第一段\n- 现有项目\n末段");
        assert_eq!(
            apply_mobile_block_style(&mut text, &mut cursor, MobileBlockStyle::Ordered),
            Ok(true)
        );
        assert_eq!(text, "第一段\n1. 现有项目\n末段");
    }

    #[test]
    fn mobile_block_toolbar_wraps_code_and_inserts_rules() {
        let mut text = "alpha\nbeta".to_owned();
        let mut cursor = 2;
        assert_eq!(
            apply_mobile_block_style(&mut text, &mut cursor, MobileBlockStyle::Code),
            Ok(true)
        );
        assert_eq!(text, "```\nalpha\n```\nbeta");
        assert_eq!(&text[cursor..], "pha\n```\nbeta");

        cursor = text.len();
        assert_eq!(
            apply_mobile_block_style(&mut text, &mut cursor, MobileBlockStyle::Rule),
            Ok(true)
        );
        assert_eq!(text, "```\nalpha\n```\n---");
        assert_eq!(cursor, text.len());
    }

    #[test]
    fn mobile_block_toolbar_refuses_protected_and_code_fence_lines() {
        let mut protected = "before\n⟦ideall:受保护块:1:img:abcd⟧\nafter".to_owned();
        let mut cursor = protected.find("img").unwrap();
        assert_eq!(
            apply_mobile_block_style(&mut protected, &mut cursor, MobileBlockStyle::Heading1),
            Err(MobileBlockFormatError::ProtectedBlock)
        );
        assert_eq!(protected, "before\n⟦ideall:受保护块:1:img:abcd⟧\nafter");

        let mut code = "```\nlet value = 1;\n```".to_owned();
        cursor = code.find("value").unwrap();
        assert_eq!(
            apply_mobile_block_style(&mut code, &mut cursor, MobileBlockStyle::Quote),
            Err(MobileBlockFormatError::CodeBlock)
        );
        assert_eq!(code, "```\nlet value = 1;\n```");
    }

    #[test]
    fn mobile_slash_menu_filters_and_applies_commands_at_the_cursor() {
        let commands = mobile_slash_commands("h");
        assert!(commands.iter().any(|(id, _, _)| *id == "heading-1"));
        assert!(commands.iter().any(|(id, _, _)| *id == "heading-2"));
        assert!(!commands.iter().any(|(id, _, _)| *id == "todo"));

        let mut text = "前一段\n/h2\n后一段".to_owned();
        let mut cursor = text.find("/h2").unwrap() + 3;
        assert_eq!(mobile_slash_query(&text, cursor), Some("h2"));
        assert_eq!(
            apply_mobile_slash_command(&mut text, &mut cursor, MobileBlockStyle::Heading2),
            Ok(true)
        );
        assert_eq!(text, "前一段\n## \n后一段");
        assert_eq!(&text[cursor..], "\n后一段");

        let mut code = "/code".to_owned();
        cursor = code.len();
        assert_eq!(
            apply_mobile_slash_command(&mut code, &mut cursor, MobileBlockStyle::Code),
            Ok(true)
        );
        assert_eq!(code, "```\n\n```");
        assert_eq!(cursor, "```\n".len());
        assert_eq!(mobile_slash_query("not /command", 12), None);
    }

    #[test]
    fn mobile_block_reordering_moves_multiline_and_protected_blocks_atomically() {
        let mut text =
            "第一段\n> 引用一\n> 引用二\n```\nline one\nline two\n```\n⟦ideall:受保护块:4:img:abcd⟧"
                .to_owned();
        let mut cursor = text.find("line two").unwrap() + "line ".len();
        assert_eq!(
            move_mobile_block(&mut text, &mut cursor, MobileBlockMove::Up),
            Some(true)
        );
        assert_eq!(
            text,
            "第一段\n```\nline one\nline two\n```\n> 引用一\n> 引用二\n⟦ideall:受保护块:4:img:abcd⟧"
        );
        assert_eq!(
            &text[cursor..],
            "two\n```\n> 引用一\n> 引用二\n⟦ideall:受保护块:4:img:abcd⟧"
        );

        cursor = text.find("受保护").unwrap();
        assert_eq!(
            move_mobile_block(&mut text, &mut cursor, MobileBlockMove::Up),
            Some(true)
        );
        assert_eq!(
            text,
            "第一段\n```\nline one\nline two\n```\n⟦ideall:受保护块:4:img:abcd⟧\n> 引用一\n> 引用二"
        );
        assert_eq!(
            move_mobile_block(&mut text, &mut cursor, MobileBlockMove::Down),
            Some(true)
        );
        assert!(text.ends_with("⟦ideall:受保护块:4:img:abcd⟧"));

        let mut unclosed = "before\n```\ncode".to_owned();
        cursor = unclosed.len();
        assert_eq!(
            move_mobile_block(&mut unclosed, &mut cursor, MobileBlockMove::Up),
            None
        );
    }
}
