use std::path::PathBuf;

use directories::ProjectDirs;
use gpui::{
    App, Application, Context, Entity, IntoElement, PathPromptOptions, PromptButton, PromptLevel,
    Render, SharedString, Subscription, Window, WindowOptions, div, prelude::*, px, rgb,
};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use gpui_component::webview::WebView;
use gpui_component::{
    Disableable as _, Root, Selectable as _, Sizable as _,
    button::{Button, ButtonVariants as _},
    input::{Input, InputEvent, InputState},
    scroll::ScrollableElement as _,
    text::TextView,
};
use ideall_acp::{AcpToolStatus, ExternalAcpConfig, command_exists, run_external_acp};
use ideall_application::{
    AgentModelSettings, AgentToolRun, AgentTranscriptMessage, AuditStatus, ExternalAcpSettings,
    HOME_ROOT_ID, LocalWorkspace, ModelRole, NodeSummary, OpenAiCompatibleClient, SyncSettings,
};
use ideall_domain::{
    EnginePlatform, EnginePreferences, EngineRuntimeKind, TabDescriptor, WorkspaceState,
    builtin_engines, engine_runtime_capabilities, list_matching_engines, resolve_default_engine,
    tab_key,
};
use ideall_protocol::{EngineAccess, EngineDescriptor, FileRef, Node, NodeKind, SubscriptionType};
use ideall_secrets::{SecretKey, SecretStore as _, SystemSecretStore};
use ideall_sync::{is_valid_sync_code, normalize_sync_code};
use ideall_sync_http::HttpSyncTransport;
use ideall_updater::{AvailableUpdate, UpdateStatus, updater_from_environment};

const INFO_PORTAL_URL: &str = "https://www.wonita.link/info";
const COMMUNITY_PORTAL_URL: &str = "https://www.wonita.link/community";

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
struct WebView;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl Render for WebView {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}

struct IdeallDesktop {
    database_path: PathBuf,
    service: LocalWorkspace,
    secret_store: SystemSecretStore,
    engines: Vec<EngineDescriptor>,
    engine_preferences: EnginePreferences,
    workspace: WorkspaceState,
    items: Vec<NodeSummary>,
    selected_id: Option<String>,
    selected_kind: Option<NodeKind>,
    active_section: SharedString,
    show_trash: bool,
    search_query: String,
    search_input: Entity<InputState>,
    feed_key_input: Entity<InputState>,
    title_input: Entity<InputState>,
    body_input: Entity<InputState>,
    code_input: Entity<InputState>,
    active_engine_id: Option<String>,
    embedded_browser: Option<Entity<WebView>>,
    sync_server_input: Entity<InputState>,
    sync_code_input: Entity<InputState>,
    sync_token_input: Entity<InputState>,
    agent_base_url_input: Entity<InputState>,
    agent_model_input: Entity<InputState>,
    agent_key_input: Entity<InputState>,
    agent_prompt_input: Entity<InputState>,
    acp_program_input: Entity<InputState>,
    acp_args_input: Entity<InputState>,
    acp_cwd_input: Entity<InputState>,
    sync_code_configured: bool,
    sync_token_configured: bool,
    sync_in_progress: bool,
    update_in_progress: bool,
    available_update: Option<AvailableUpdate>,
    update_status: Option<SharedString>,
    agent_key_configured: bool,
    agent_in_progress: bool,
    agent_thread_id: Option<String>,
    agent_transcript: Vec<AgentTranscriptMessage>,
    body_editable: bool,
    dirty: bool,
    status: Option<SharedString>,
    _subscriptions: Vec<Subscription>,
}

impl IdeallDesktop {
    fn new(
        database_path: PathBuf,
        service: LocalWorkspace,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let search_input = cx.new(|cx| InputState::new(window, cx).placeholder("搜索标题与正文"));
        let feed_key_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("发布者域名，例如 example.com"));
        let title_input = cx.new(|cx| InputState::new(window, cx).placeholder("标题"));
        let body_input = cx.new(|cx| {
            InputState::new(window, cx)
                .multi_line(true)
                .rows(12)
                .placeholder("从这里开始记录……")
        });
        let code_input = cx.new(|cx| {
            InputState::new(window, cx)
                .code_editor("markdown")
                .placeholder("文件内容")
        });
        let sync_server = service.load_sync_settings().unwrap_or_default();
        let sync_server_input = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(sync_server.server_base_url)
                .placeholder("https://api.wonita.link")
        });
        let sync_code_input = cx.new(|cx| {
            InputState::new(window, cx)
                .masked(true)
                .placeholder("32 位十六进制同步码；留空保持不变")
        });
        let sync_token_input = cx.new(|cx| {
            InputState::new(window, cx)
                .masked(true)
                .placeholder("登录 Bearer Token；留空保持不变")
        });
        let agent_settings = service.load_agent_model_settings().unwrap_or_default();
        let agent_base_url_input = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(agent_settings.base_url)
                .placeholder("https://api.deepseek.com/v1/")
        });
        let agent_model_input = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(agent_settings.model)
                .placeholder("deepseek-chat")
        });
        let agent_key_input = cx.new(|cx| {
            InputState::new(window, cx)
                .masked(true)
                .placeholder("API Key；留空保持不变")
        });
        let agent_prompt_input = cx.new(|cx| {
            InputState::new(window, cx)
                .multi_line(true)
                .rows(4)
                .placeholder("向本地 Agent 提问，或让它调用已授权工具……")
        });
        let acp_settings = service.load_external_acp_settings().unwrap_or_default();
        let acp_program_input = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(acp_settings.program)
                .placeholder("例如 codex-acp、gemini 或 node")
        });
        let acp_args_input = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(acp_settings.args)
                .placeholder("例如 acp；按 argv 引号规则解析，不经 shell")
        });
        let acp_cwd_input = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(acp_settings.cwd)
                .placeholder("绝对工作目录；留空使用 ideall 当前目录")
        });
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
        let title_subscription = cx.subscribe(&title_input, |this, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                this.dirty = true;
                cx.notify();
            }
        });
        let body_subscription = cx.subscribe(&body_input, |this, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                this.dirty = true;
                cx.notify();
            }
        });
        let code_subscription = cx.subscribe(&code_input, |this, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                this.dirty = true;
                cx.notify();
            }
        });
        let search_subscription =
            cx.subscribe(&search_input, |this, input, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) {
                    this.search_query = input.read(cx).value().to_string();
                    this.show_trash = false;
                    this.active_section = if this.search_query.trim().is_empty() {
                        "我的".into()
                    } else {
                        "搜索".into()
                    };
                    this.refresh_items();
                    cx.notify();
                }
            });
        let items = service.list_home().unwrap_or_default();
        let workspace = service.load_workspace_state().unwrap_or_default();
        let engine_preferences = service.load_engine_preferences().unwrap_or_default();
        let mut this = Self {
            database_path,
            service,
            secret_store,
            engines: builtin_engines(),
            engine_preferences,
            workspace,
            items,
            selected_id: None,
            selected_kind: None,
            active_section: "我的".into(),
            show_trash: false,
            search_query: String::new(),
            search_input,
            feed_key_input,
            title_input,
            body_input,
            code_input,
            active_engine_id: None,
            embedded_browser: None,
            sync_server_input,
            sync_code_input,
            sync_token_input,
            agent_base_url_input,
            agent_model_input,
            agent_key_input,
            agent_prompt_input,
            acp_program_input,
            acp_args_input,
            acp_cwd_input,
            sync_code_configured: false,
            sync_token_configured: false,
            sync_in_progress: false,
            update_in_progress: false,
            available_update: None,
            update_status: None,
            agent_key_configured,
            agent_in_progress: false,
            agent_thread_id,
            agent_transcript,
            body_editable: false,
            dirty: false,
            status: None,
            _subscriptions: vec![
                title_subscription,
                body_subscription,
                code_subscription,
                search_subscription,
            ],
        };
        let active_tab = this.workspace.active_id.as_deref().and_then(|active_id| {
            this.workspace
                .tabs
                .iter()
                .find(|tab| tab_key(tab) == active_id)
                .map(|tab| (tab.file.file_id.clone(), tab.engine_id.clone()))
        });
        if let Some((id, engine_id)) = active_tab {
            this.load_node_into_editor(&id, window, cx);
            this.activate_engine(&engine_id, &id, window, cx);
        }
        this
    }

    fn refresh_items(&mut self) {
        let result = if self.show_trash {
            self.service.list_trash()
        } else if !self.search_query.trim().is_empty() {
            self.service.search(&self.search_query, 200)
        } else {
            self.service.list_home().map(|mut items| {
                match self.active_section.as_ref() {
                    "活动" => items.sort_by(|left, right| {
                        right
                            .updated_at
                            .cmp(&left.updated_at)
                            .then_with(|| left.id.cmp(&right.id))
                    }),
                    "浏览" => items
                        .retain(|item| matches!(item.kind, NodeKind::Bookmark | NodeKind::Feed)),
                    "应用" | "设置" => items.clear(),
                    _ => {}
                }
                items
            })
        };
        match result {
            Ok(items) => self.items = items,
            Err(error) => self.status = Some(error.to_string().into()),
        }
    }

    fn create_note(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let parent = self.creation_parent();
        match self.service.create_note(parent.as_deref(), "无标题笔记") {
            Ok(node) => {
                self.show_trash = false;
                self.refresh_items();
                self.open_node(node.base().id.clone(), window, cx);
                self.status = Some("已创建本地笔记".into());
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn create_folder(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let parent = self.creation_parent();
        match self.service.create_folder(parent.as_deref(), "新建文件夹") {
            Ok(node) => {
                self.show_trash = false;
                self.refresh_items();
                self.open_node(node.base().id.clone(), window, cx);
                self.status = Some("已创建文件夹".into());
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn create_bookmark(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let parent = self.creation_parent();
        match self
            .service
            .create_bookmark(parent.as_deref(), "新建书签", "https://example.com/")
        {
            Ok(node) => {
                self.show_trash = false;
                self.refresh_items();
                self.open_node(node.base().id.clone(), window, cx);
                self.status = Some("请修改书签标题与网址后保存".into());
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn create_text_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let parent = self.creation_parent();
        match self
            .service
            .create_file(parent.as_deref(), "新建文本.txt", "text/plain", Vec::new())
        {
            Ok(node) => {
                self.show_trash = false;
                self.refresh_items();
                self.open_node(node.base().id.clone(), window, cx);
                self.status = Some("已创建本地文件与 Blob".into());
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn create_feed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let key = self.feed_key_input.read(cx).value().to_string();
        match self
            .service
            .create_feed(key.trim(), SubscriptionType::Publisher, &key)
        {
            Ok(node) => {
                self.feed_key_input
                    .update(cx, |input, cx| input.set_value("", window, cx));
                self.refresh_items();
                self.status = Some(
                    format!(
                        "已关注发布者 {}；可通过加密同步与旧客户端互通",
                        node.base().title
                    )
                    .into(),
                );
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn import_files(&mut self, cx: &mut Context<Self>) {
        let parent = self.creation_parent();
        let receiver = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some("导入到 ideall".into()),
        });
        cx.spawn(async move |view, cx| {
            let selection = receiver.await;
            cx.update(|cx| {
                let Some(view) = view.upgrade() else {
                    return;
                };
                view.update(cx, |this, cx| match selection {
                    Ok(Ok(Some(paths))) => {
                        let mut imported = 0_usize;
                        for path in paths {
                            match this.service.import_file(
                                parent.as_deref(),
                                path,
                                256 * 1024 * 1024,
                            ) {
                                Ok(_) => imported += 1,
                                Err(error) => {
                                    this.status = Some(error.to_string().into());
                                    this.refresh_items();
                                    cx.notify();
                                    return;
                                }
                            }
                        }
                        this.refresh_items();
                        this.status = Some(format!("已导入 {imported} 个文件").into());
                        cx.notify();
                    }
                    Ok(Ok(None)) => {}
                    Ok(Err(error)) => {
                        this.status = Some(error.to_string().into());
                        cx.notify();
                    }
                    Err(_) => {
                        this.status = Some("文件选择器意外关闭".into());
                        cx.notify();
                    }
                });
            })
        })
        .detach();
    }

    fn creation_parent(&self) -> Option<String> {
        (self.selected_kind == Some(NodeKind::Folder))
            .then(|| self.selected_id.clone())
            .flatten()
    }

    fn load_node_into_editor(
        &mut self,
        id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<(NodeKind, String)> {
        match self.service.node(id) {
            Ok(node) => {
                let title = node.base().title.clone();
                let (body, editable, protected_blocks) = self.node_body(&node);
                self.title_input
                    .update(cx, |input, cx| input.set_value(title.clone(), window, cx));
                self.body_input
                    .update(cx, |input, cx| input.set_value(body.clone(), window, cx));
                self.code_input.update(cx, |input, cx| {
                    input.set_highlighter(code_language_for_node(&self.service, id), cx);
                    input.set_value(body, window, cx);
                });
                self.selected_kind = Some(node.kind());
                self.selected_id = Some(id.to_owned());
                self.body_editable = editable;
                self.dirty = false;
                self.status = if node.kind() == NodeKind::Note && protected_blocks > 0 {
                    Some(
                        format!(
                            "可编辑常用 Markdown 块；{protected_blocks} 个未知富文本块以指纹占位保护，请勿修改占位行"
                        )
                        .into(),
                    )
                } else if node.kind() == NodeKind::File && !editable {
                    Some("此二进制类型在 ideall 中只读；可导出临时副本并用系统应用打开".into())
                } else {
                    None
                };
                Some((node.kind(), title))
            }
            Err(error) => {
                self.status = Some(error.to_string().into());
                None
            }
        }
    }

    fn open_node(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        if let Some((kind, title)) = self.load_node_into_editor(&id, window, cx)
            && !self.show_trash
        {
            let engine_id = self
                .service
                .file_metadata(&id)
                .ok()
                .and_then(|file| {
                    resolve_default_engine(&self.engines, &file, &self.engine_preferences)
                })
                .map(|resolution| resolution.candidate.descriptor.engine_id)
                .unwrap_or_else(|| engine_id(kind).into());
            self.activate_engine(&engine_id, &id, window, cx);
            self.workspace.open(TabDescriptor {
                file: FileRef::new("local.nodes", &id),
                engine_id,
                title,
                root_id: Some(HOME_ROOT_ID.into()),
                navigation_path: Some(format!("/home/{id}")),
            });
            self.persist_workspace();
        }
        cx.notify();
    }

    fn activate_engine(
        &mut self,
        engine_id: &str,
        id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.active_engine_id = Some(engine_id.to_owned());
        self.embedded_browser = None;
        if engine_id != "ideall.browser" {
            return;
        }
        let url = match self.service.node(id) {
            Ok(Node::Bookmark { content, .. }) => content.url,
            _ => return,
        };
        match create_embedded_browser(&url, window, cx) {
            Ok(browser) => {
                self.embedded_browser = Some(browser);
                self.status = Some("已在隔离的系统 WebView 中打开书签".into());
            }
            Err(error) => self.status = Some(error.into()),
        }
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
                            "文件类型：{}\n大小：{} 字节\nBlob：{}",
                            blob_ref.mime, blob_ref.size, blob_ref.key
                        ),
                        false,
                        0,
                    )
                }),
            Node::Folder { .. } => ("文件夹中的项目将在这里显示。".into(), false, 0),
            Node::Feed { content, .. } => (format!("关注源：{}", content.key), false, 0),
            Node::Thread { content, .. } => (
                format!("{} 条本地会话消息", content.messages.len()),
                false,
                0,
            ),
        }
    }

    fn save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        let title = self.title_input.read(cx).value().to_string();
        let body = if self.active_engine_id.as_deref() == Some("ideall.code") {
            self.code_input.read(cx).value().to_string()
        } else {
            self.body_input.read(cx).value().to_string()
        };
        let result =
            self.service
                .save_edits(&id, title, self.body_editable.then_some(body.as_str()));
        match result {
            Ok(_) => {
                self.refresh_items();
                self.open_node(id, window, cx);
                self.status = Some("已保存到本地 SQLite".into());
                self.dirty = false;
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn open_bookmark_external(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        if self.selected_kind != Some(NodeKind::Bookmark) {
            return;
        }

        if self.dirty {
            let title = self.title_input.read(cx).value().to_string();
            let url = self.body_input.read(cx).value().to_string();
            if let Err(error) = self.service.save_edits(&id, title, Some(&url)) {
                self.status = Some(error.to_string().into());
                cx.notify();
                return;
            }
            self.dirty = false;
            self.refresh_items();
            self.load_node_into_editor(&id, window, cx);
        }

        match self.service.node(&id) {
            Ok(Node::Bookmark { content, .. }) => {
                cx.open_url(&content.url);
                self.status = Some("已交给系统浏览器打开".into());
            }
            Ok(_) => self.status = Some("当前项目不是书签".into()),
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn open_portal(
        &mut self,
        engine_id: &'static str,
        url: &'static str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.clear_selection(window, cx);
        self.active_engine_id = Some(engine_id.into());
        match create_embedded_browser(url, window, cx) {
            Ok(browser) => {
                self.embedded_browser = Some(browser);
                self.status =
                    Some("已在隔离的系统 WebView 中打开；未注入本地文件或密钥能力".into());
            }
            Err(error) => {
                cx.open_url(url);
                self.status = Some(format!("{error}；已交给系统浏览器").into());
            }
        }
        cx.notify();
    }

    fn open_file_with_system(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        let node = match self.service.node(&id) {
            Ok(node @ Node::File { .. }) => node,
            Ok(_) => {
                self.status = Some("当前项目不是文件".into());
                cx.notify();
                return;
            }
            Err(error) => {
                self.status = Some(error.to_string().into());
                cx.notify();
                return;
            }
        };
        let name = std::path::Path::new(&node.base().title)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("ideall-export.bin");
        let directory = self
            .database_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("viewer-cache")
            .join(&id);
        let target = directory.join(name);
        match self.service.export_file(&id, &target) {
            Ok(size) => {
                cx.open_with_system(&target);
                self.status = Some(format!("已导出 {size} 字节临时副本并交给系统应用").into());
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn move_selected_to_trash(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        match self.service.move_to_trash(&id) {
            Ok(true) => {
                let tab_ids = self
                    .workspace
                    .tabs
                    .iter()
                    .filter(|tab| tab.file.file_id == id)
                    .map(tab_key)
                    .collect::<Vec<_>>();
                for tab_id in tab_ids {
                    self.workspace.close(&tab_id);
                }
                self.persist_workspace();
                self.clear_selection(window, cx);
                self.refresh_items();
                self.status = Some("已移到回收站".into());
            }
            Ok(false) => self.status = Some("项目已不在当前列表".into()),
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn restore_selected(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        match self.service.restore(&id) {
            Ok(true) => {
                self.clear_selection(window, cx);
                self.refresh_items();
                self.status = Some("已从回收站恢复".into());
            }
            Ok(false) => self.status = Some("未找到回收站快照".into()),
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn purge_selected(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        match self.service.purge(&id) {
            Ok(true) => {
                self.clear_selection(window, cx);
                self.refresh_items();
                self.status = Some("已永久删除；此操作无法撤销".into());
            }
            Ok(false) => self.status = Some("项目已不在回收站".into()),
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn confirm_purge(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let receiver = window.prompt(
            PromptLevel::Critical,
            "永久删除这个项目？",
            Some("本地节点和关联 Blob 都会删除，此操作无法撤销。"),
            &[PromptButton::cancel("取消"), PromptButton::ok("永久删除")],
            cx,
        );
        cx.spawn_in(window, async move |view, cx| {
            if receiver.await == Ok(1) {
                let _ = view.update_in(cx, |this, window, cx| {
                    this.purge_selected(window, cx);
                });
            }
        })
        .detach();
    }

    fn show_files(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.show_trash = false;
        self.search_query.clear();
        self.search_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.active_section = "我的".into();
        self.clear_selection(window, cx);
        self.refresh_items();
        cx.notify();
    }

    fn select_section(
        &mut self,
        section: &'static str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if section == "我的" {
            self.show_files(window, cx);
            return;
        }
        self.show_trash = false;
        self.search_query.clear();
        self.search_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.active_section = section.into();
        self.clear_selection(window, cx);
        self.refresh_items();
        self.status = match section {
            "活动" => Some("按最近修改排序的本地活动".into()),
            "浏览" => Some("本地书签与关注源".into()),
            "应用" => {
                match self.secret_store.get(SecretKey::AgentCredential) {
                    Ok(value) => self.agent_key_configured = value.is_some(),
                    Err(error) => self.status = Some(error.to_string().into()),
                }
                Some("原生 Agent 可直连 OpenAI-compatible 模型，并通过授权 MCP 使用本地工具".into())
            }
            "设置" => {
                self.refresh_sync_secret_status();
                Some("同步凭据仅保存在系统安全存储中".into())
            }
            _ => None,
        };
        cx.notify();
    }

    fn create_agent_draft(&mut self, cx: &mut Context<Self>) {
        match self.service.create_agent_note_via_mcp("Agent 草稿") {
            Ok(node) => {
                self.refresh_items();
                self.status = Some(
                    format!(
                        "Agent 已通过本地 MCP 创建空白笔记 {}；写操作审计已提交",
                        node.base().id
                    )
                    .into(),
                );
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn persist_agent_model_settings(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        let settings = AgentModelSettings {
            base_url: self.agent_base_url_input.read(cx).value().to_string(),
            model: self.agent_model_input.read(cx).value().to_string(),
        };
        let saved = self
            .service
            .save_agent_model_settings(&settings)
            .map_err(|error| error.to_string())?;
        self.agent_base_url_input.update(cx, |input, cx| {
            input.set_value(saved.base_url.clone(), window, cx);
        });
        self.agent_model_input.update(cx, |input, cx| {
            input.set_value(saved.model.clone(), window, cx);
        });

        let key = self.agent_key_input.read(cx).value().to_string();
        if !key.trim().is_empty() {
            let key = key.trim();
            OpenAiCompatibleClient::new(&saved.base_url, &saved.model, key)
                .map_err(|error| error.to_string())?;
            self.secret_store
                .set(SecretKey::AgentCredential, key)
                .map_err(|error| error.to_string())?;
            self.agent_key_configured = true;
            self.agent_key_input
                .update(cx, |input, cx| input.set_value("", window, cx));
        }
        Ok(())
    }

    fn save_agent_model_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.status = match self.persist_agent_model_settings(window, cx) {
            Ok(()) => Some("模型设置已保存；API Key 仅在系统安全存储中".into()),
            Err(error) => Some(error.into()),
        };
        cx.notify();
    }

    fn clear_agent_credential(&mut self, cx: &mut Context<Self>) {
        match self.secret_store.delete(SecretKey::AgentCredential) {
            Ok(_) => {
                self.agent_key_configured = false;
                self.status = Some("模型 API Key 已从系统安全存储清除".into());
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn new_agent_thread(&mut self, cx: &mut Context<Self>) {
        if self.agent_in_progress {
            return;
        }
        self.agent_thread_id = None;
        self.agent_transcript.clear();
        self.status = Some("已开始新对话；发送第一条消息后写入本地 SQLite".into());
        cx.notify();
    }

    fn select_agent_thread(&mut self, thread_id: String, cx: &mut Context<Self>) {
        if self.agent_in_progress {
            return;
        }
        match self.service.agent_transcript(&thread_id) {
            Ok(messages) => {
                self.agent_thread_id = Some(thread_id);
                self.agent_transcript = messages;
                self.status = Some("已打开本地 Agent 对话".into());
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn start_agent_turn(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.agent_in_progress {
            return;
        }
        if let Err(error) = self.persist_agent_model_settings(window, cx) {
            self.status = Some(error.into());
            cx.notify();
            return;
        }
        let prompt = self.agent_prompt_input.read(cx).value().to_string();
        if prompt.trim().is_empty() {
            self.status = Some("请输入 Agent 消息".into());
            cx.notify();
            return;
        }
        let settings = match self.service.load_agent_model_settings() {
            Ok(settings) => settings,
            Err(error) => {
                self.status = Some(error.to_string().into());
                cx.notify();
                return;
            }
        };
        let key = match self.secret_store.get(SecretKey::AgentCredential) {
            Ok(Some(key)) => key,
            Ok(None) => {
                self.status = Some("请先安全保存模型 API Key".into());
                cx.notify();
                return;
            }
            Err(error) => {
                self.status = Some(error.to_string().into());
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
        self.status = Some("Agent 正在本机直连模型服务……".into());
        cx.spawn_in(window, async move |view, cx| {
            let result = task.await;
            let _ = view.update_in(cx, |this, window, cx| {
                this.agent_in_progress = false;
                match result {
                    Ok(result) => {
                        this.agent_thread_id = Some(result.thread_id.clone());
                        this.agent_transcript = this
                            .service
                            .agent_transcript(&result.thread_id)
                            .unwrap_or_default();
                        this.agent_prompt_input
                            .update(cx, |input, cx| input.set_value("", window, cx));
                        this.refresh_items();
                        let failures = result.tools.iter().filter(|tool| !tool.ok).count();
                        this.status = Some(if result.tools.is_empty() {
                            "Agent 已回复；对话保存在本地 SQLite".into()
                        } else {
                            format!(
                                "Agent 已回复；执行 {} 个工具，{} 个失败；写操作均已审计",
                                result.tools.len(),
                                failures
                            )
                            .into()
                        });
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
                            this.agent_transcript =
                                this.service.agent_transcript(thread_id).unwrap_or_default();
                        }
                        this.status = Some(error.into());
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn persist_external_acp_settings(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<ExternalAcpSettings, String> {
        let saved = self
            .service
            .save_external_acp_settings(&ExternalAcpSettings {
                program: self.acp_program_input.read(cx).value().to_string(),
                args: self.acp_args_input.read(cx).value().to_string(),
                cwd: self.acp_cwd_input.read(cx).value().to_string(),
            })
            .map_err(|error| error.to_string())?;
        self.acp_program_input.update(cx, |input, cx| {
            input.set_value(saved.program.clone(), window, cx);
        });
        self.acp_args_input.update(cx, |input, cx| {
            input.set_value(saved.args.clone(), window, cx);
        });
        self.acp_cwd_input.update(cx, |input, cx| {
            input.set_value(saved.cwd.clone(), window, cx);
        });
        Ok(saved)
    }

    fn save_external_acp_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.status = match self.persist_external_acp_settings(window, cx) {
            Ok(_) => Some("外部 ACP 命令已保存；程序与 argv 直接启动，不经 shell".into()),
            Err(error) => Some(error.into()),
        };
        cx.notify();
    }

    fn start_external_acp_turn(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.agent_in_progress {
            return;
        }
        let settings = match self.persist_external_acp_settings(window, cx) {
            Ok(settings) => settings,
            Err(error) => {
                self.status = Some(error.into());
                cx.notify();
                return;
            }
        };
        let config =
            match ExternalAcpConfig::parse(&settings.program, &settings.args, &settings.cwd) {
                Ok(config) => config,
                Err(error) => {
                    self.status = Some(error.to_string().into());
                    cx.notify();
                    return;
                }
            };
        if !command_exists(&config.program) {
            self.status = Some("未在本机找到外部 ACP 程序".into());
            cx.notify();
            return;
        }
        let prompt = self.agent_prompt_input.read(cx).value().to_string();
        if prompt.trim().is_empty() {
            self.status = Some("请输入 Agent 消息".into());
            cx.notify();
            return;
        }
        let database_path = self.database_path.clone();
        let existing_thread_id = self.agent_thread_id.clone();
        let task = cx.background_executor().spawn(async move {
            let mut workspace =
                LocalWorkspace::open(database_path).map_err(|error| (None, error.to_string()))?;
            let thread_id = workspace
                .begin_external_agent_turn(existing_thread_id.as_deref(), &prompt)
                .map_err(|error| (None, error.to_string()))?;
            let result = run_external_acp(config, &prompt)
                .map_err(|error| (Some(thread_id.clone()), error.to_string()))?;
            let mut tools = result
                .tools
                .iter()
                .map(|tool| AgentToolRun {
                    name: format!("external-acp.{}", tool.id),
                    ok: tool.status == AcpToolStatus::Completed,
                    summary: format!("{} · {}", tool.title, acp_tool_status_label(tool.status)),
                })
                .collect::<Vec<_>>();
            if result.denied_permissions > 0 {
                tools.push(AgentToolRun {
                    name: "external-acp.permission".into(),
                    ok: false,
                    summary: format!("已拒绝 {} 个外部 Agent 权限请求", result.denied_permissions),
                });
            }
            workspace
                .complete_external_agent_turn(&thread_id, &result.content, &tools)
                .map_err(|error| (Some(thread_id.clone()), error.to_string()))?;
            Ok::<_, (Option<String>, String)>((thread_id, result))
        });
        self.agent_in_progress = true;
        self.status = Some("正在启动外部 ACP v1 Agent；权限请求默认拒绝……".into());
        cx.spawn_in(window, async move |view, cx| {
            let result = task.await;
            let _ = view.update_in(cx, |this, window, cx| {
                this.agent_in_progress = false;
                match result {
                    Ok((thread_id, result)) => {
                        this.agent_thread_id = Some(thread_id.clone());
                        this.agent_transcript = this
                            .service
                            .agent_transcript(&thread_id)
                            .unwrap_or_default();
                        this.agent_prompt_input
                            .update(cx, |input, cx| input.set_value("", window, cx));
                        this.status = Some(
                            format!(
                                "ACP {}：{} 个工具事件，{} 个权限请求被拒绝",
                                result.stop_reason,
                                result.tools.len(),
                                result.denied_permissions
                            )
                            .into(),
                        );
                    }
                    Err((thread_id, error)) => {
                        if let Some(thread_id) = thread_id {
                            this.agent_thread_id = Some(thread_id.clone());
                            this.agent_transcript = this
                                .service
                                .agent_transcript(&thread_id)
                                .unwrap_or_default();
                        }
                        this.status = Some(error.into());
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn refresh_sync_secret_status(&mut self) {
        match self.secret_store.get(SecretKey::SyncCode) {
            Ok(value) => self.sync_code_configured = value.is_some(),
            Err(error) => self.status = Some(error.to_string().into()),
        }
        match self.secret_store.get(SecretKey::SyncBearerToken) {
            Ok(value) => self.sync_token_configured = value.is_some(),
            Err(error) => self.status = Some(error.to_string().into()),
        }
    }

    fn persist_sync_settings(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        let server_base_url = self.sync_server_input.read(cx).value().to_string();
        let saved = self
            .service
            .save_sync_settings(&SyncSettings { server_base_url })
            .map_err(|error| error.to_string())?;
        self.sync_server_input.update(cx, |input, cx| {
            input.set_value(saved.server_base_url, window, cx);
        });

        let code = self.sync_code_input.read(cx).value().to_string();
        if !code.trim().is_empty() {
            if !is_valid_sync_code(&code) {
                return Err("同步码必须恰好包含 32 位十六进制字符".into());
            }
            self.secret_store
                .set(SecretKey::SyncCode, &normalize_sync_code(&code))
                .map_err(|error| error.to_string())?;
            self.sync_code_configured = true;
            self.sync_code_input
                .update(cx, |input, cx| input.set_value("", window, cx));
        }

        let token = self.sync_token_input.read(cx).value().to_string();
        if !token.trim().is_empty() {
            self.secret_store
                .set(SecretKey::SyncBearerToken, token.trim())
                .map_err(|error| error.to_string())?;
            self.sync_token_configured = true;
            self.sync_token_input
                .update(cx, |input, cx| input.set_value("", window, cx));
        }
        Ok(())
    }

    fn save_sync_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.status = match self.persist_sync_settings(window, cx) {
            Ok(()) => Some("同步设置已保存；凭据未写入 SQLite".into()),
            Err(error) => Some(error.into()),
        };
        cx.notify();
    }

    fn clear_sync_credentials(&mut self, cx: &mut Context<Self>) {
        let result = self
            .secret_store
            .delete(SecretKey::SyncCode)
            .and_then(|_| self.secret_store.delete(SecretKey::SyncBearerToken));
        match result {
            Ok(_) => {
                self.sync_code_configured = false;
                self.sync_token_configured = false;
                self.status = Some("同步凭据已从系统安全存储清除".into());
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }

    fn start_notes_sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.sync_in_progress {
            return;
        }
        if let Err(error) = self.persist_sync_settings(window, cx) {
            self.status = Some(error.into());
            cx.notify();
            return;
        }
        let settings = match self.service.load_sync_settings() {
            Ok(settings) => settings,
            Err(error) => {
                self.status = Some(error.to_string().into());
                cx.notify();
                return;
            }
        };
        let code = match self.secret_store.get(SecretKey::SyncCode) {
            Ok(Some(value)) => value,
            Ok(None) => {
                self.status = Some("请先保存同步码".into());
                cx.notify();
                return;
            }
            Err(error) => {
                self.status = Some(error.to_string().into());
                cx.notify();
                return;
            }
        };
        let token = match self.secret_store.get(SecretKey::SyncBearerToken) {
            Ok(Some(value)) => value,
            Ok(None) => {
                self.status = Some("请先保存登录 Bearer Token".into());
                cx.notify();
                return;
            }
            Err(error) => {
                self.status = Some(error.to_string().into());
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
        self.status = Some("正在同步关注、笔记与书签三个加密域……".into());
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
                            this.refresh_items();
                            this.status = Some(
                                format!(
                                    "同步完成：关注 {}、笔记 {}、书签 {} 条；新增 {} 条",
                                    subscriptions.total,
                                    notes.total,
                                    bookmarks.total,
                                    subscriptions.added + notes.added + bookmarks.added
                                )
                                .into(),
                            );
                        }
                        Err(error) => this.status = Some(error.into()),
                    }
                    cx.notify();
                });
            })
        })
        .detach();
        cx.notify();
    }

    fn start_update_check(&mut self, cx: &mut Context<Self>) {
        if self.update_in_progress {
            return;
        }
        let task = cx.background_executor().spawn(async move {
            let updater = updater_from_environment().map_err(|error| error.to_string())?;
            updater
                .check(env!("CARGO_PKG_VERSION"))
                .map_err(|error| error.to_string())
        });
        self.update_in_progress = true;
        self.update_status = Some("正在获取并验证签名更新清单……".into());
        cx.spawn(async move |view, cx| {
            let result = task.await;
            cx.update(|cx| {
                let Some(view) = view.upgrade() else {
                    return;
                };
                view.update(cx, |this, cx| {
                    this.update_in_progress = false;
                    match result {
                        Ok(UpdateStatus::Current { version }) => {
                            this.available_update = None;
                            this.update_status =
                                Some(format!("当前 {version} 已是最新版本").into());
                        }
                        Ok(UpdateStatus::Available(update)) => {
                            this.update_status =
                                Some(format!("已验证 {} 的签名更新清单", update.version).into());
                            this.available_update = Some(update);
                        }
                        Err(error) => this.update_status = Some(error.into()),
                    }
                    cx.notify();
                });
            })
        })
        .detach();
        cx.notify();
    }

    fn start_update_download(&mut self, cx: &mut Context<Self>) {
        if self.update_in_progress {
            return;
        }
        let Some(update) = self.available_update.clone() else {
            self.update_status = Some("请先检查更新".into());
            cx.notify();
            return;
        };
        let destination_root = self
            .database_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("updates");
        let task = cx.background_executor().spawn(async move {
            let updater = updater_from_environment().map_err(|error| error.to_string())?;
            updater
                .download(&update, &destination_root)
                .map_err(|error| error.to_string())
        });
        self.update_in_progress = true;
        self.update_status = Some("正在下载并校验安装器大小与 SHA-256……".into());
        cx.spawn(async move |view, cx| {
            let result = task.await;
            cx.update(|cx| {
                let Some(view) = view.upgrade() else {
                    return;
                };
                view.update(cx, |this, cx| {
                    this.update_in_progress = false;
                    match result {
                        Ok(path) => {
                            cx.open_with_system(&path);
                            this.update_status = Some(
                                "安装器已通过签名清单与 SHA-256 校验，并交给系统打开；安装前请保存当前编辑"
                                    .into(),
                            );
                        }
                        Err(error) => this.update_status = Some(error.into()),
                    }
                    cx.notify();
                });
            })
        })
        .detach();
        cx.notify();
    }

    fn show_trash(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.show_trash = true;
        self.search_query.clear();
        self.search_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.active_section = "回收站".into();
        self.clear_selection(window, cx);
        self.refresh_items();
        cx.notify();
    }

    fn clear_selection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.selected_id = None;
        self.selected_kind = None;
        self.body_editable = false;
        self.dirty = false;
        self.title_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.body_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.code_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.active_engine_id = None;
        self.embedded_browser = None;
    }

    fn activate_tab(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        if self.workspace.activate(&id)
            && let Some(tab) = self.workspace.tabs.iter().find(|tab| tab_key(tab) == id)
        {
            self.open_node(tab.file.file_id.clone(), window, cx);
        }
        self.persist_workspace();
    }

    fn close_tab(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        if !self.workspace.close(&id) {
            return;
        }
        self.persist_workspace();
        if let Some(active_id) = self.workspace.active_id.clone()
            && let Some(tab) = self
                .workspace
                .tabs
                .iter()
                .find(|tab| tab_key(tab) == active_id)
        {
            self.open_node(tab.file.file_id.clone(), window, cx);
        } else {
            self.clear_selection(window, cx);
        }
        cx.notify();
    }

    fn persist_workspace(&mut self) {
        if let Err(error) = self.service.save_workspace_state(&self.workspace) {
            self.status = Some(error.to_string().into());
        }
    }

    fn set_engine_preference(
        &mut self,
        engine_id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.dirty {
            self.save(window, cx);
            if self.dirty {
                return;
            }
        }
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        let result = self.service.file_metadata(&id).and_then(|file| {
            let supported = list_matching_engines(&self.engines, &file)
                .iter()
                .any(|candidate| candidate.descriptor.engine_id == engine_id);
            if !supported {
                return Err(ideall_application::ApplicationError::EngineNotSupported {
                    engine_id: engine_id.into(),
                    media_type: file.media_type,
                });
            }
            let key = file.r#ref.to_key().map_err(|error| {
                ideall_application::ApplicationError::InvalidFileRef(error.to_string())
            })?;
            self.engine_preferences
                .files
                .insert(key, engine_id.to_owned());
            self.service
                .save_engine_preferences(&self.engine_preferences)
        });
        match result {
            Ok(()) => {
                self.open_node(id, window, cx);
                self.status = Some(format!("默认使用 {engine_id}").into());
            }
            Err(error) => self.status = Some(error.to_string().into()),
        }
        cx.notify();
    }
}

impl Render for IdeallDesktop {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sections = ["我的", "活动", "浏览", "应用", "设置"];
        let selected_id = self.selected_id.clone();
        let items = self.items.clone();
        let tabs = self.workspace.tabs.clone();
        let active_tab = self.workspace.active_id.clone();
        let has_selection = self.selected_id.is_some();
        let show_settings = !has_selection && self.active_section.as_ref() == "设置";
        let show_apps = !has_selection && self.active_section.as_ref() == "应用";
        let show_browse = self.active_section.as_ref() == "浏览";
        let can_create = !self.show_trash && self.active_section.as_ref() == "我的";
        let engine_capabilities = engine_runtime_capabilities(EnginePlatform::current_desktop());
        let agent_audits = if show_apps {
            self.service.list_agent_audits(50).unwrap_or_default()
        } else {
            Vec::new()
        };
        let agent_threads = if show_apps {
            self.service.list_agent_threads(12).unwrap_or_default()
        } else {
            Vec::new()
        };
        let agent_transcript = self.agent_transcript.clone();
        let available_update = self.available_update.clone();
        let empty_message: SharedString = match self.active_section.as_ref() {
            "搜索" => "没有匹配的本地内容".into(),
            "回收站" => "回收站为空".into(),
            "活动" => "还没有本地活动".into(),
            "浏览" => "还没有书签或关注源".into(),
            "应用" => format!("已声明 {} 项平台 Engine 能力", engine_capabilities.len()).into(),
            "设置" => "本地设置已就绪；文件 Engine 偏好会自动持久化".into(),
            _ => "点击“+ 笔记”开始".into(),
        };
        let is_body_editable = matches!(
            self.selected_kind,
            Some(NodeKind::Note | NodeKind::Bookmark | NodeKind::File)
        );
        let show_code = self.active_engine_id.as_deref() == Some("ideall.code")
            && self.selected_kind == Some(NodeKind::File);
        let show_preview = self.active_engine_id.as_deref() == Some("ideall.preview")
            && self.selected_kind == Some(NodeKind::File);
        let embedded_browser = self.embedded_browser.clone();
        let show_browser = embedded_browser.is_some()
            && self.active_engine_id.as_deref() == Some("ideall.browser");
        let show_remote_webview = !has_selection
            && embedded_browser.is_some()
            && matches!(
                self.active_engine_id.as_deref(),
                Some("ideall.info" | "ideall.community")
            );
        let remote_browser = embedded_browser.clone();
        let delegated_capability = self.active_engine_id.as_deref().and_then(|engine_id| {
            engine_capabilities.iter().copied().find(|capability| {
                capability.engine_id == engine_id
                    && matches!(
                        capability.kind,
                        EngineRuntimeKind::SystemExternal | EngineRuntimeKind::MetadataOnly
                    )
            })
        });
        let show_delegated_engine = has_selection && delegated_capability.is_some();
        let preview_text = self.body_input.read(cx).value();
        let preview = TextView::markdown("active-file-preview", preview_text, window, cx)
            .selectable(true)
            .scrollable(true);

        div()
            .id("ideall-root")
            .flex()
            .size_full()
            .bg(rgb(0xf5f7fa))
            .text_color(rgb(0x1f2937))
            .child(
                div()
                    .w(px(64.0))
                    .h_full()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap_2()
                    .py_3()
                    .border_r_1()
                    .border_color(rgb(0xdde3ea))
                    .bg(rgb(0xffffff))
                    .children(sections.map(|section| {
                        let selected = self.active_section.as_ref() == section;
                        div()
                            .id(SharedString::from(format!("section-{section}")))
                            .w(px(48.0))
                            .h(px(40.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_lg()
                            .cursor_pointer()
                            .when(selected, |item| item.bg(rgb(0xe8eef8)))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.select_section(section, window, cx);
                            }))
                            .child(section)
                    })),
            )
            .child(
                div()
                    .w(px(252.0))
                    .h_full()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .p_3()
                    .border_r_1()
                    .border_color(rgb(0xdde3ea))
                    .bg(rgb(0xf9fafb))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(div().text_lg().child(self.active_section.clone()))
                            .child(
                                Button::new("new-note")
                                    .label("+ 笔记")
                                    .small()
                                    .disabled(!can_create)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.create_note(window, cx);
                                    })),
                            ),
                    )
                    .child(Input::new(&self.search_input).w_full())
                    .when(show_browse, |sidebar| {
                        sidebar.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_2()
                                .child(Input::new(&self.feed_key_input).w_full())
                                .child(
                                    Button::new("new-feed")
                                        .label("+ 关注发布者")
                                        .small()
                                        .primary()
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.create_feed(window, cx);
                                        })),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .gap_2()
                                .child(
                                    Button::new("open-info-portal")
                                        .label("资讯")
                                        .small()
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.open_portal(
                                                "ideall.info",
                                                INFO_PORTAL_URL,
                                                window,
                                                cx,
                                            );
                                        })),
                                )
                                .child(
                                    Button::new("open-community-portal")
                                        .label("社区")
                                        .small()
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.open_portal(
                                                "ideall.community",
                                                COMMUNITY_PORTAL_URL,
                                                window,
                                                cx,
                                            );
                                        })),
                                ),
                        )
                    })
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(
                                Button::new("home-list")
                                    .label("全部")
                                    .small()
                                    .selected(!self.show_trash)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.show_files(window, cx);
                                    })),
                            )
                            .child(
                                Button::new("trash-list")
                                    .label("回收站")
                                    .small()
                                    .selected(self.show_trash)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.show_trash(window, cx);
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap_1()
                            .child(
                                Button::new("new-bookmark")
                                    .label("+ 书签")
                                    .small()
                                    .ghost()
                                    .disabled(!can_create)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.create_bookmark(window, cx);
                                    })),
                            )
                            .child(
                                Button::new("new-folder")
                                    .label("+ 文件夹")
                                    .small()
                                    .ghost()
                                    .disabled(!can_create)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.create_folder(window, cx);
                                    })),
                            )
                            .child(
                                Button::new("new-file")
                                    .label("+ 空文件")
                                    .small()
                                    .ghost()
                                    .disabled(!can_create)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.create_text_file(window, cx);
                                    })),
                            )
                            .child(
                                Button::new("import-file")
                                    .label("导入")
                                    .small()
                                    .ghost()
                                    .disabled(!can_create)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.import_files(cx);
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .overflow_hidden()
                            .when(items.is_empty(), |list| {
                                list.child(
                                    div()
                                        .p_3()
                                        .text_sm()
                                        .text_color(rgb(0x6b7280))
                                        .child(empty_message),
                                )
                            })
                            .children(items.into_iter().map(|item| {
                                let id = item.id.clone();
                                let selected = selected_id.as_deref() == Some(id.as_str());
                                div()
                                    .id(SharedString::from(format!("node-{id}")))
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .px_2()
                                    .pl(px(8.0 + item.depth as f32 * 14.0))
                                    .py_2()
                                    .rounded_md()
                                    .cursor_pointer()
                                    .when(selected, |row| row.bg(rgb(0xe8eef8)))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.open_node(id.clone(), window, cx);
                                    }))
                                    .child(div().text_sm().child(kind_icon(item.kind)))
                                    .child(
                                        div()
                                            .flex_1()
                                            .overflow_hidden()
                                            .text_ellipsis()
                                            .whitespace_nowrap()
                                            .child(item.title),
                                    )
                            })),
                    ),
            )
            .child(
                div()
                    .flex()
                    .gap_2()
                    .child(
                        Button::new("engine-code")
                            .label("开发视图")
                            .small()
                            .ghost()
                            .disabled(self.selected_kind != Some(NodeKind::File))
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.set_engine_preference("ideall.code", window, cx);
                            })),
                    )
                    .child(
                        Button::new("engine-preview")
                            .label("通用预览")
                            .small()
                            .ghost()
                            .disabled(self.selected_kind != Some(NodeKind::File))
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.set_engine_preference("ideall.preview", window, cx);
                            })),
                    )
                    .child(
                        Button::new("engine-browser")
                            .label("浏览器视图")
                            .small()
                            .ghost()
                            .disabled(self.selected_kind != Some(NodeKind::Bookmark))
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.set_engine_preference("ideall.browser", window, cx);
                            })),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .h_full()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .h(px(48.0))
                            .flex()
                            .items_center()
                            .gap_1()
                            .px_2()
                            .border_b_1()
                            .border_color(rgb(0xdde3ea))
                            .bg(rgb(0xffffff))
                            .children(tabs.into_iter().map(|tab| {
                                let id = tab_key(&tab);
                                let close_id = id.clone();
                                let selected = active_tab.as_deref() == Some(id.as_str());
                                div()
                                    .id(SharedString::from(format!("tab-{id}")))
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .px_3()
                                    .py_2()
                                    .rounded_md()
                                    .cursor_pointer()
                                    .when(selected, |item| item.bg(rgb(0xe9edf3)))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.activate_tab(id.clone(), window, cx);
                                    }))
                                    .child(tab.title)
                                    .child(
                                        Button::new(SharedString::from(format!(
                                            "close-{close_id}"
                                        )))
                                        .label("×")
                                        .small()
                                        .ghost()
                                        .on_click(
                                            cx.listener(move |this, _, window, cx| {
                                                this.close_tab(close_id.clone(), window, cx);
                                            }),
                                        ),
                                    )
                            })),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_h_0()
                            .flex()
                            .flex_col()
                            .p_5()
                            .gap_3()
                            .when(
                                !has_selection
                                    && !show_settings
                                    && !show_apps
                                    && !show_remote_webview,
                                |content| {
                                content.items_center().justify_center().child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .items_center()
                                        .gap_2()
                                        .child(div().text_xl().child("ideall 原生工作区"))
                                        .child(
                                            div()
                                                .text_sm()
                                                .text_color(rgb(0x6b7280))
                                                .child("Rust · GPUI · SQLite · 本地优先"),
                                        ),
                                )
                            },
                            )
                            .when(show_remote_webview, |content| {
                                content.child(
                                    remote_browser
                                        .clone()
                                        .expect("remote WebView is present when rendered"),
                                )
                            })
                            .when(show_apps, |content| {
                                content.child(
                                    div()
                                        .w_full()
                                        .max_w(px(820.0))
                                        .h_full()
                                        .flex()
                                        .flex_col()
                                        .gap_3()
                                        .overflow_y_scrollbar()
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .justify_between()
                                                .child(
                                                    div()
                                                        .flex()
                                                        .flex_col()
                                                        .gap_1()
                                                        .child(
                                                            div()
                                                                .text_xl()
                                                                .child("Agent 与原生 Engine"),
                                                        )
                                                        .child(
                                                            div()
                                                                .text_sm()
                                                                .text_color(rgb(0x6b7280))
                                                                .child("BYOK 由本机直连模型；默认工具可读取节点元数据并创建笔记，但不能读取既有笔记正文或 Blob。"),
                                                        ),
                                                )
                                                .child(
                                                    Button::new("agent-new-thread")
                                                        .label("新对话")
                                                        .disabled(self.agent_in_progress)
                                                        .on_click(cx.listener(|this, _, _, cx| {
                                                            this.new_agent_thread(cx);
                                                        })),
                                                ),
                                        )
                                        .child(div().text_lg().child("模型连接（OpenAI-compatible）"))
                                        .child(div().text_sm().child("API 基址"))
                                        .child(Input::new(&self.agent_base_url_input).w_full())
                                        .child(div().text_sm().child("模型名称"))
                                        .child(Input::new(&self.agent_model_input).w_full())
                                        .child(div().text_sm().child(format!(
                                            "API Key：{}",
                                            if self.agent_key_configured {
                                                "已安全配置"
                                            } else {
                                                "未配置"
                                            }
                                        )))
                                        .child(Input::new(&self.agent_key_input).w_full())
                                        .child(
                                            div()
                                                .flex()
                                                .gap_2()
                                                .child(
                                                    Button::new("agent-save-settings")
                                                        .label("安全保存")
                                                        .on_click(cx.listener(
                                                            |this, _, window, cx| {
                                                                this.save_agent_model_settings(
                                                                    window, cx,
                                                                );
                                                            },
                                                        )),
                                                )
                                                .child(
                                                    Button::new("agent-clear-key")
                                                        .label("清除 Key")
                                                        .danger()
                                                        .on_click(cx.listener(|this, _, _, cx| {
                                                            this.clear_agent_credential(cx);
                                                        })),
                                                )
                                                .child(
                                                    Button::new("agent-create-draft")
                                                        .label("MCP 冒烟：创建草稿")
                                                        .on_click(cx.listener(|this, _, _, cx| {
                                                            this.create_agent_draft(cx);
                                                        })),
                                                ),
                                        )
                                        .child(div().text_lg().child("外部 ACP Agent（仅桌面）"))
                                        .child(
                                            div()
                                                .text_sm()
                                                .text_color(rgb(0x9f2f28))
                                                .child("只运行你在本机明确配置的程序。ACP 权限请求默认拒绝，但外部进程仍拥有当前系统账户与所选工作目录本身允许的访问权。"),
                                        )
                                        .child(div().text_sm().child("程序"))
                                        .child(Input::new(&self.acp_program_input).w_full())
                                        .child(div().text_sm().child("参数（argv 引号规则）"))
                                        .child(Input::new(&self.acp_args_input).w_full())
                                        .child(div().text_sm().child("工作目录（绝对路径）"))
                                        .child(Input::new(&self.acp_cwd_input).w_full())
                                        .child(
                                            div()
                                                .flex()
                                                .gap_2()
                                                .child(
                                                    Button::new("acp-save-settings")
                                                        .label("保存 ACP 设置")
                                                        .on_click(cx.listener(
                                                            |this, _, window, cx| {
                                                                this.save_external_acp_settings(
                                                                    window, cx,
                                                                );
                                                            },
                                                        )),
                                                )
                                                .child(
                                                    Button::new("acp-send")
                                                        .label(if self.agent_in_progress {
                                                            "Agent 处理中……"
                                                        } else {
                                                            "用外部 ACP 发送下方消息"
                                                        })
                                                        .disabled(self.agent_in_progress)
                                                        .on_click(cx.listener(
                                                            |this, _, window, cx| {
                                                                this.start_external_acp_turn(
                                                                    window, cx,
                                                                );
                                                            },
                                                        )),
                                                ),
                                        )
                                        .child(div().text_lg().child("本地对话"))
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
                                                    Button::new(SharedString::from(format!(
                                                        "agent-thread-{}",
                                                        thread.id
                                                    )))
                                                    .label(thread.title)
                                                    .small()
                                                    .selected(
                                                        self.agent_thread_id.as_deref()
                                                            == Some(thread.id.as_str()),
                                                    )
                                                    .disabled(self.agent_in_progress)
                                                    .on_click(cx.listener(move |this, _, _, cx| {
                                                        this.select_agent_thread(id.clone(), cx);
                                                    }))
                                                })),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .gap_2()
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
                                                .children(agent_transcript.into_iter().map(
                                                    |message| {
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
                                                                    .child(agent_role_label(
                                                                        message.role,
                                                                    )),
                                                            )
                                                            .child(message.content)
                                                    },
                                                )),
                                        )
                                        .child(Input::new(&self.agent_prompt_input).w_full())
                                        .child(
                                            Button::new("agent-send")
                                                .label(if self.agent_in_progress {
                                                    "Agent 处理中……"
                                                } else {
                                                    "发送给 Agent"
                                                })
                                                .primary()
                                                .disabled(self.agent_in_progress)
                                                .on_click(cx.listener(|this, _, window, cx| {
                                                    this.start_agent_turn(window, cx);
                                                })),
                                        )
                                        .child(
                                            div()
                                                .text_sm()
                                                .text_color(rgb(0x6b7280))
                                                .child(
                                                    self.status
                                                        .clone()
                                                        .unwrap_or_else(|| "Agent 就绪".into()),
                                                ),
                                        )
                                        .child(
                                            div()
                                                .text_lg()
                                                .child(format!(
                                                    "平台 Engine 能力（{}）",
                                                    engine_capabilities.len()
                                                )),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .flex_wrap()
                                                .gap_2()
                                                .children(engine_capabilities.into_iter().map(
                                                    |capability| {
                                                    div()
                                                        .w(px(250.0))
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
                                                                    capability.label,
                                                                    capability.engine_id
                                                                ))
                                                                .child(
                                                                    div()
                                                                        .text_sm()
                                                                        .text_color(rgb(
                                                                            if capability
                                                                                .kind
                                                                                .is_available()
                                                                            {
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
                                                        .child(capability.detail)
                                                },
                                                )),
                                        )
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
                                content.child(
                                    div()
                                        .w_full()
                                        .max_w(px(720.0))
                                        .h_full()
                                        .flex()
                                        .flex_col()
                                        .gap_3()
                                        .overflow_y_scrollbar()
                                        .child(div().text_xl().child("端到端加密同步"))
                                        .child(
                                            div()
                                                .text_sm()
                                                .text_color(rgb(0x6b7280))
                                                .child("服务端只保存 AES-GCM 密文；同步码与登录 Token 保存在系统安全存储。"),
                                        )
                                        .child(div().text_sm().child("服务端基址"))
                                        .child(Input::new(&self.sync_server_input).w_full())
                                        .child(
                                            div().text_sm().child(format!(
                                                "同步码：{}",
                                                if self.sync_code_configured {
                                                    "已配置"
                                                } else {
                                                    "未配置"
                                                }
                                            )),
                                        )
                                        .child(Input::new(&self.sync_code_input).w_full())
                                        .child(
                                            div().text_sm().child(format!(
                                                "登录 Token：{}",
                                                if self.sync_token_configured {
                                                    "已配置"
                                                } else {
                                                    "未配置"
                                                }
                                            )),
                                        )
                                        .child(Input::new(&self.sync_token_input).w_full())
                                        .child(
                                            div()
                                                .flex()
                                                .gap_2()
                                                .child(
                                                    Button::new("save-sync-settings")
                                                        .label("安全保存")
                                                        .on_click(cx.listener(
                                                            |this, _, window, cx| {
                                                                this.save_sync_settings(window, cx);
                                                            },
                                                        )),
                                                )
                                                .child(
                                                    Button::new("sync-notes-now")
                                                        .label(if self.sync_in_progress {
                                                            "同步中……"
                                                        } else {
                                                            "立即同步全部"
                                                        })
                                                        .primary()
                                                        .disabled(self.sync_in_progress)
                                                        .on_click(cx.listener(
                                                            |this, _, window, cx| {
                                                                this.start_notes_sync(window, cx);
                                                            },
                                                        )),
                                                )
                                                .child(
                                                    Button::new("clear-sync-secrets")
                                                        .label("清除凭据")
                                                        .danger()
                                                        .on_click(cx.listener(
                                                            |this, _, _, cx| {
                                                                this.clear_sync_credentials(cx);
                                                            },
                                                        )),
                                                ),
                                        )
                                        .child(
                                            div()
                                                .text_sm()
                                                .text_color(rgb(0x6b7280))
                                                .child(
                                                    self.status
                                                        .clone()
                                                        .unwrap_or_else(|| "尚未同步".into()),
                                                ),
                                        )
                                        .child(div().text_xl().child("原生版本与更新"))
                                        .child(
                                            div()
                                                .text_sm()
                                                .text_color(rgb(0x6b7280))
                                                .child(format!(
                                                    "当前版本 {}；只接受 ideall 官方 minisign 根签名的清单，安装器下载后还会校验大小与 SHA-256。",
                                                    env!("CARGO_PKG_VERSION")
                                                )),
                                        )
                                        .child(
                                            Button::new("check-native-update")
                                                .label(if self.update_in_progress {
                                                    "更新处理中……"
                                                } else {
                                                    "检查签名更新"
                                                })
                                                .disabled(self.update_in_progress)
                                                .on_click(cx.listener(|this, _, _, cx| {
                                                    this.start_update_check(cx);
                                                })),
                                        )
                                        .when(available_update.is_some(), |updates| {
                                            let update = available_update
                                                .as_ref()
                                                .expect("available update was checked")
                                                .clone();
                                            let notes = update
                                                .notes
                                                .chars()
                                                .take(600)
                                                .collect::<String>();
                                            updates
                                                .child(
                                                    div()
                                                        .p_3()
                                                        .rounded_lg()
                                                        .border_1()
                                                        .border_color(rgb(0xdde3ea))
                                                        .bg(rgb(0xffffff))
                                                        .child(format!(
                                                            "可用版本 {} · {}\n{}",
                                                            update.version,
                                                            update.artifact.kind,
                                                            notes
                                                        )),
                                                )
                                                .child(
                                                    Button::new("download-native-update")
                                                        .label(format!(
                                                            "下载、校验并打开 {} 安装器",
                                                            update.version
                                                        ))
                                                        .primary()
                                                        .disabled(self.update_in_progress)
                                                        .on_click(cx.listener(
                                                            |this, _, _, cx| {
                                                                this.start_update_download(cx);
                                                            },
                                                        )),
                                                )
                                        })
                                        .child(
                                            div()
                                                .text_sm()
                                                .text_color(rgb(0x6b7280))
                                                .child(
                                                    self.update_status
                                                        .clone()
                                                        .unwrap_or_else(|| {
                                                            "尚未检查原生 Preview 更新".into()
                                                        }),
                                                ),
                                        ),
                                )
                            })
                            .when(has_selection, |content| {
                                content
                                    .child(Input::new(&self.title_input).w_full())
                                    .child(
                                        div()
                                            .flex_1()
                                            .min_h_0()
                                            .flex()
                                            .flex_col()
                                            .when(show_browser, |body| {
                                                body.child(embedded_browser.clone().unwrap())
                                            })
                                            .when(show_code, |body| {
                                                body.child(
                                                    Input::new(&self.code_input)
                                                        .h_full()
                                                        .disabled(!self.body_editable),
                                                )
                                            })
                                            .when(show_preview, |body| {
                                                body.child(
                                                    div()
                                                        .flex_1()
                                                        .min_h_0()
                                                        .p_3()
                                                        .border_1()
                                                        .border_color(rgb(0xdde3ea))
                                                        .rounded_md()
                                                        .child(preview),
                                                )
                                                .child(
                                                    Input::new(&self.body_input)
                                                        .h(px(220.0))
                                                        .disabled(!self.body_editable),
                                                )
                                            })
                                            .when(show_delegated_engine, |body| {
                                                let capability = delegated_capability
                                                    .expect("delegated capability is present");
                                                body.child(
                                                    div()
                                                        .flex_1()
                                                        .min_h_0()
                                                        .flex()
                                                        .flex_col()
                                                        .items_center()
                                                        .justify_center()
                                                        .gap_3()
                                                        .p_5()
                                                        .border_1()
                                                        .border_color(rgb(0xdde3ea))
                                                        .rounded_md()
                                                        .child(
                                                            div()
                                                                .text_xl()
                                                                .child(format!(
                                                                    "{} · {}",
                                                                    capability.label,
                                                                    capability.kind.label()
                                                                )),
                                                        )
                                                        .child(
                                                            div()
                                                                .text_color(rgb(0x6b7280))
                                                                .child(capability.detail),
                                                        )
                                                        .child(
                                                            Button::new("open-delegated-file")
                                                                .label("用系统应用打开只读副本")
                                                                .primary()
                                                                .on_click(cx.listener(
                                                                    |this, _, _, cx| {
                                                                        this.open_file_with_system(cx);
                                                                    },
                                                                )),
                                                        ),
                                                )
                                            })
                                            .when(
                                                !show_browser
                                                    && !show_code
                                                    && !show_preview
                                                    && !show_delegated_engine,
                                                |body| {
                                                body.child(
                                                    Input::new(&self.body_input)
                                                        .h_full()
                                                        .disabled(
                                                            !is_body_editable
                                                                || !self.body_editable,
                                                        ),
                                                )
                                            },
                                            ),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .justify_between()
                                            .child(
                                                div().text_sm().text_color(rgb(0x6b7280)).child(
                                                    self.status
                                                        .clone()
                                                        .unwrap_or_else(|| "本地数据".into()),
                                                ),
                                            )
                                            .child(
                                                div()
                                                    .flex()
                                                    .gap_2()
                                                    .child(
                                                        Button::new("save")
                                                            .label(if self.dirty {
                                                                "保存更改"
                                                            } else {
                                                                "已保存"
                                                            })
                                                            .primary()
                                                            .disabled(!self.dirty)
                                                            .on_click(cx.listener(
                                                                |this, _, window, cx| {
                                                                    this.save(window, cx);
                                                                },
                                                            )),
                                                    )
                                                    .when(
                                                        !self.show_trash
                                                            && self.selected_kind
                                                                == Some(NodeKind::Bookmark),
                                                        |actions| {
                                                            actions.child(
                                                                Button::new("open-bookmark")
                                                                    .label("系统浏览器打开")
                                                                    .on_click(cx.listener(
                                                                        |this, _, window, cx| {
                                                                            this.open_bookmark_external(
                                                                                window, cx,
                                                                            );
                                                                        },
                                                                    )),
                                                            )
                                                        },
                                                    )
                                                    .when(
                                                        !self.show_trash
                                                            && self.selected_kind
                                                                == Some(NodeKind::File),
                                                        |actions| {
                                                            actions.child(
                                                                Button::new("open-file-system")
                                                                    .label("系统应用打开")
                                                                    .on_click(cx.listener(
                                                                        |this, _, _, cx| {
                                                                            this.open_file_with_system(cx);
                                                                        },
                                                                    )),
                                                            )
                                                        },
                                                    )
                                                    .when(self.show_trash, |actions| {
                                                        actions
                                                            .child(
                                                                Button::new("restore")
                                                                    .label("恢复")
                                                                    .on_click(cx.listener(
                                                                        |this, _, window, cx| {
                                                                            this.restore_selected(
                                                                                window, cx,
                                                                            );
                                                                        },
                                                                    )),
                                                            )
                                                            .child(
                                                                Button::new("purge")
                                                                    .label("永久删除")
                                                                    .danger()
                                                                    .on_click(cx.listener(
                                                                        |this, _, window, cx| {
                                                                            this.confirm_purge(
                                                                                window, cx,
                                                                            );
                                                                        },
                                                                    )),
                                                            )
                                                    })
                                                    .when(!self.show_trash, |actions| {
                                                        actions.child(
                                                            Button::new("trash")
                                                                .label("移到回收站")
                                                                .danger()
                                                                .on_click(cx.listener(
                                                                    |this, _, window, cx| {
                                                                        this.move_selected_to_trash(
                                                                            window, cx,
                                                                        );
                                                                    },
                                                                )),
                                                        )
                                                    }),
                                            ),
                                    )
                            }),
                    ),
            )
    }
}

fn engine_id(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Folder => "ideall.directory",
        NodeKind::Note => "ideall.note",
        NodeKind::Bookmark => "ideall.bookmark",
        NodeKind::File => "ideall.preview",
        NodeKind::Feed => "ideall.feed",
        NodeKind::Thread => "ideall.thread",
    }
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

fn acp_tool_status_label(status: AcpToolStatus) -> &'static str {
    match status {
        AcpToolStatus::Pending => "等待",
        AcpToolStatus::InProgress => "执行中",
        AcpToolStatus::Completed => "完成",
        AcpToolStatus::Failed => "失败",
    }
}

fn code_language_for_node(service: &LocalWorkspace, id: &str) -> &'static str {
    let Ok(file) = service.file_metadata(id) else {
        return "markdown";
    };
    let extension = file
        .name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    match (file.media_type.as_str(), extension.as_deref()) {
        (_, Some("rs")) => "rust",
        (_, Some("ts" | "tsx")) => "typescript",
        (_, Some("js" | "jsx" | "mjs" | "cjs")) => "javascript",
        ("application/json", _) | (_, Some("json")) => "json",
        ("text/markdown", _) | (_, Some("md" | "mdx")) => "markdown",
        (_, Some("toml")) => "toml",
        (_, Some("yaml" | "yml")) => "yaml",
        ("text/html", _) | (_, Some("html" | "htm")) => "html",
        ("text/css", _) | (_, Some("css")) => "css",
        (_, Some("py")) => "python",
        (_, Some("go")) => "go",
        (_, Some("c" | "h")) => "c",
        (_, Some("cc" | "cpp" | "cxx" | "hpp")) => "cpp",
        (_, Some("sh" | "bash")) => "bash",
        (_, Some("sql")) => "sql",
        _ => "markdown",
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn create_embedded_browser(
    url: &str,
    window: &mut Window,
    cx: &mut Context<IdeallDesktop>,
) -> Result<Entity<WebView>, String> {
    let webview = wry::WebViewBuilder::new()
        .with_url(url)
        .build_as_child(window)
        .map_err(|error| error.to_string())?;
    Ok(cx.new(|cx| WebView::new(webview, window, cx)))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn create_embedded_browser(
    _url: &str,
    _window: &mut Window,
    _cx: &mut Context<IdeallDesktop>,
) -> Result<Entity<WebView>, String> {
    Err("当前 Linux GPUI 后端不支持可靠的子窗口 WebView；可使用“系统浏览器打开”".into())
}

fn native_database_path() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("IDEALL_NATIVE_DATA_DIR") {
        let directory = PathBuf::from(path);
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        return Ok(directory.join("ideall.db"));
    }
    let project = ProjectDirs::from("org", "ideall", "ideall")
        .ok_or_else(|| "无法确定 ideall 本地数据目录".to_owned())?;
    std::fs::create_dir_all(project.data_dir()).map_err(|error| error.to_string())?;
    Ok(project.data_dir().join("ideall.db"))
}

#[cfg(target_os = "linux")]
fn select_linux_backend() {
    let has_x11 = std::env::var_os("DISPLAY").is_some_and(|value| !value.is_empty());
    let has_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some_and(|value| !value.is_empty());
    let declared_wayland = std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland");
    let force_x11 = std::env::var_os("IDEALL_FORCE_X11").is_some();
    if has_x11 && has_wayland && (force_x11 || !declared_wayland) {
        // SAFETY: this runs as the first statement in `main`, before GPUI or any
        // other thread can read the process environment.
        unsafe { std::env::remove_var("WAYLAND_DISPLAY") };
    }
}

#[cfg(not(target_os = "linux"))]
fn select_linux_backend() {}

fn main() {
    select_linux_backend();
    ideall_secrets::initialize_platform().expect("failed to initialize native secure store");
    Application::new().run(|cx: &mut App| {
        gpui_component::init(cx);
        let database_path =
            native_database_path().expect("failed to resolve ideall data directory");
        let service = LocalWorkspace::open(&database_path).expect("failed to open ideall database");
        cx.open_window(WindowOptions::default(), |window, cx| {
            let workspace = cx.new(|cx| IdeallDesktop::new(database_path, service, window, cx));
            cx.new(|cx| Root::new(workspace, window, cx))
        })
        .expect("failed to open ideall desktop window");
        cx.activate(true);
    });
}
