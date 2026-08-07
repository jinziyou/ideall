import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:ideall/l10n/app_localizations.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/ideall_theme.dart';
import 'delta_markdown.dart';

class EditorSnapshot {
  const EditorSnapshot({
    required this.title,
    required this.deltaJson,
    required this.plainText,
    required this.markdown,
    required this.tags,
  });

  final String title;
  final String deltaJson;
  final String plainText;
  final String markdown;
  final List<String> tags;
}

class RichDocumentEditor extends StatefulWidget {
  const RichDocumentEditor({
    required this.initialTitle,
    required this.initialDeltaJson,
    required this.onSave,
    this.initialTags = const [],
    this.onBack,
    this.onMoveToTrash,
    this.onUploadDraft,
    this.onPublish,
    this.onShowHistory,
    super.key,
  });

  final String initialTitle;
  final String initialDeltaJson;
  final List<String> initialTags;
  final Future<void> Function(EditorSnapshot value) onSave;
  final FutureOr<void> Function()? onBack;
  final Future<void> Function()? onMoveToTrash;
  final Future<void> Function(EditorSnapshot value)? onUploadDraft;
  final Future<void> Function(EditorSnapshot value)? onPublish;
  final Future<void> Function()? onShowHistory;

  @override
  State<RichDocumentEditor> createState() => _RichDocumentEditorState();
}

enum _SavePhase { clean, pending, saving, failed }

class _RichDocumentEditorState extends State<RichDocumentEditor> {
  late final TextEditingController _titleController;
  late final TextEditingController _tagsController;
  late final QuillController _quillController;
  final _editorFocusNode = FocusNode();
  final _editorScrollController = ScrollController();
  StreamSubscription<Object?>? _documentSubscription;
  Timer? _saveTimer;
  EditorSnapshot? _queuedSnapshot;
  String? _queuedSnapshotKey;
  String? _inFlightSnapshotKey;
  String? _persistedSnapshotKey;
  Future<bool>? _saveLoop;
  Object? _lastSaveError;
  _SavePhase _savePhase = _SavePhase.clean;
  bool _cloudActionInProgress = false;
  bool _leaving = false;
  bool _disposing = false;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.initialTitle);
    _tagsController = TextEditingController(
      text: widget.initialTags.join(', '),
    );
    _quillController = QuillController(
      document: _decodeDocument(widget.initialDeltaJson),
      selection: const TextSelection.collapsed(offset: 0),
    );
    _titleController.addListener(_scheduleSave);
    _tagsController.addListener(_scheduleSave);
    _documentSubscription = _quillController.document.changes.listen(
      (_) => _scheduleSave(),
    );
    _persistedSnapshotKey = _snapshotKey(_snapshot);
  }

  Document _decodeDocument(String value) {
    try {
      final decoded = jsonDecode(value);
      if (decoded is List) return Document.fromJson(decoded);
    } on FormatException {
      // Fall through to a valid empty Quill document.
    }
    return Document();
  }

  EditorSnapshot get _snapshot {
    final delta = _quillController.document.toDelta().toJson();
    final tags = _tagsController.text
        .split(',')
        .map((tag) => tag.trim())
        .where((tag) => tag.isNotEmpty)
        .toSet()
        .take(20)
        .toList(growable: false);
    return EditorSnapshot(
      title: _titleController.text.trim(),
      deltaJson: jsonEncode(delta),
      plainText: _quillController.document.toPlainText().trimRight(),
      markdown: deltaToMarkdown(delta),
      tags: tags,
    );
  }

  void _scheduleSave() {
    _saveTimer?.cancel();
    final queued = _queueCurrentSnapshot();
    if (!queued) {
      _setSavePhase(
        _inFlightSnapshotKey == null ? _SavePhase.clean : _SavePhase.saving,
      );
      return;
    }
    _setSavePhase(_SavePhase.pending);
    _saveTimer = Timer(
      const Duration(milliseconds: 700),
      () => unawaited(_flushSaves()),
    );
  }

  bool _queueCurrentSnapshot() {
    final snapshot = _snapshot;
    final key = _snapshotKey(snapshot);
    if (key == _queuedSnapshotKey) return true;
    if (key == _inFlightSnapshotKey) {
      _queuedSnapshot = null;
      _queuedSnapshotKey = null;
      return false;
    }
    if (key == _persistedSnapshotKey && _inFlightSnapshotKey == null) {
      _queuedSnapshot = null;
      _queuedSnapshotKey = null;
      return false;
    }
    _queuedSnapshot = snapshot;
    _queuedSnapshotKey = key;
    return true;
  }

  String _snapshotKey(EditorSnapshot snapshot) =>
      jsonEncode(<Object?>[snapshot.title, snapshot.deltaJson, snapshot.tags]);

  void _setSavePhase(_SavePhase value) {
    if (_disposing || !mounted || _savePhase == value) return;
    setState(() => _savePhase = value);
  }

  Future<bool> _flushSaves() {
    _saveTimer?.cancel();
    _queueCurrentSnapshot();
    final running = _saveLoop;
    if (running != null) return running;
    final operation = _drainSaveQueue();
    _saveLoop = operation;
    return operation;
  }

  Future<bool> _drainSaveQueue() async {
    try {
      while (_queuedSnapshot != null) {
        final snapshot = _queuedSnapshot!;
        final key = _queuedSnapshotKey!;
        _queuedSnapshot = null;
        _queuedSnapshotKey = null;
        _inFlightSnapshotKey = key;
        _setSavePhase(_SavePhase.saving);
        try {
          await widget.onSave(snapshot);
          _persistedSnapshotKey = key;
          _lastSaveError = null;
        } catch (error) {
          _lastSaveError = error;
          if (_queuedSnapshot == null) {
            _queuedSnapshot = snapshot;
            _queuedSnapshotKey = key;
          }
          _setSavePhase(_SavePhase.failed);
          return false;
        } finally {
          _inFlightSnapshotKey = null;
        }
      }
      _setSavePhase(_SavePhase.clean);
      return true;
    } finally {
      _saveLoop = null;
    }
  }

  Future<void> _runCloudAction(
    Future<void> Function(EditorSnapshot value) action,
  ) async {
    if (_cloudActionInProgress || _leaving) return;
    setState(() => _cloudActionInProgress = true);
    try {
      if (!await _flushSaves()) {
        if (mounted) _showError(_lastSaveError);
        return;
      }
      await action(_snapshot);
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _cloudActionInProgress = false);
    }
  }

  Future<void> _requestBack() async {
    if (_leaving || _cloudActionInProgress) return;
    setState(() => _leaving = true);
    final saved = await _flushSaves();
    if (!mounted) return;
    if (!saved) {
      setState(() => _leaving = false);
      _showError(_lastSaveError);
      return;
    }
    try {
      await widget.onBack?.call();
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _leaving = false);
    }
  }

  void _showError(Object? error) {
    final message = error?.toString().trim();
    final generic = AppLocalizations.of(context).errorGeneric;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(
        content: Text(
          message == null || message.isEmpty ? generic : '$generic: $message',
        ),
      ),
    );
  }

  void _insertDivider() {
    final selection = _quillController.selection;
    final length = selection.end - selection.start;
    _quillController.replaceText(
      selection.start,
      length,
      const BlockEmbed('divider', ''),
      TextSelection.collapsed(offset: selection.start + 1),
    );
  }

  @override
  void dispose() {
    _disposing = true;
    _saveTimer?.cancel();
    _queueCurrentSnapshot();
    unawaited(_flushSaves());
    unawaited(_documentSubscription?.cancel());
    _titleController
      ..removeListener(_scheduleSave)
      ..dispose();
    _tagsController
      ..removeListener(_scheduleSave)
      ..dispose();
    _quillController.dispose();
    _editorFocusNode.dispose();
    _editorScrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_requestBack());
      },
      child: ColoredBox(
        color: IdeallColors.surface,
        child: SafeArea(
          child: Column(
            children: [
              _EditorHeader(
                titleController: _titleController,
                savePhase: _savePhase,
                cloudActionInProgress: _cloudActionInProgress,
                leaving: _leaving,
                onBack: _requestBack,
                onSave: _flushSaves,
                onMoveToTrash: widget.onMoveToTrash,
                onUploadDraft: widget.onUploadDraft == null
                    ? null
                    : () => _runCloudAction(widget.onUploadDraft!),
                onPublish: widget.onPublish == null
                    ? null
                    : () => _runCloudAction(widget.onPublish!),
                onShowHistory: widget.onShowHistory,
              ),
              const Divider(),
              Align(
                alignment: Alignment.centerLeft,
                child: SizedBox(
                  width: double.infinity,
                  child: QuillSimpleToolbar(
                    controller: _quillController,
                    config: QuillSimpleToolbarConfig(
                      multiRowsDisplay: false,
                      showFontFamily: false,
                      showFontSize: false,
                      showUnderLineButton: false,
                      showSmallButton: false,
                      showColorButton: false,
                      showBackgroundColorButton: false,
                      showClearFormat: false,
                      showAlignmentButtons: false,
                      showIndent: false,
                      showDirection: false,
                      showSearchButton: false,
                      showSubscript: false,
                      showSuperscript: false,
                      color: IdeallColors.surface,
                      sectionDividerColor: IdeallColors.border,
                      customButtons: [
                        QuillToolbarCustomButtonOptions(
                          icon: const Icon(Icons.horizontal_rule_rounded),
                          tooltip: localizations.divider,
                          onPressed: _insertDivider,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const Divider(),
              Expanded(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 820),
                    child: QuillEditor(
                      focusNode: _editorFocusNode,
                      scrollController: _editorScrollController,
                      controller: _quillController,
                      config: QuillEditorConfig(
                        placeholder: localizations.editorPlaceholder,
                        padding: const EdgeInsets.fromLTRB(28, 32, 28, 100),
                        customLinkPrefixes: const ['https://', 'http://'],
                        onLaunchUrl: (value) async {
                          final uri = Uri.tryParse(value);
                          if (uri != null &&
                              (uri.scheme == 'http' || uri.scheme == 'https')) {
                            await launchUrl(
                              uri,
                              mode: LaunchMode.externalApplication,
                            );
                          }
                        },
                        embedBuilders: const [_DividerEmbedBuilder()],
                      ),
                    ),
                  ),
                ),
              ),
              Container(
                decoration: const BoxDecoration(
                  color: IdeallColors.surfaceMuted,
                  border: Border(top: BorderSide(color: IdeallColors.border)),
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 8,
                ),
                child: TextField(
                  controller: _tagsController,
                  decoration: InputDecoration(
                    isDense: true,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    filled: false,
                    prefixIcon: const Icon(Icons.sell_outlined, size: 19),
                    hintText: localizations.tagHint,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EditorHeader extends StatelessWidget {
  const _EditorHeader({
    required this.titleController,
    required this.savePhase,
    required this.cloudActionInProgress,
    required this.leaving,
    required this.onSave,
    this.onBack,
    this.onMoveToTrash,
    this.onUploadDraft,
    this.onPublish,
    this.onShowHistory,
  });

  final TextEditingController titleController;
  final _SavePhase savePhase;
  final bool cloudActionInProgress;
  final bool leaving;
  final Future<void> Function()? onBack;
  final Future<bool> Function() onSave;
  final Future<void> Function()? onMoveToTrash;
  final Future<void> Function()? onUploadDraft;
  final Future<void> Function()? onPublish;
  final Future<void> Function()? onShowHistory;

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    final status = switch (savePhase) {
      _SavePhase.clean => localizations.documentSaved,
      _SavePhase.pending => '…',
      _SavePhase.saving => '…',
      _SavePhase.failed => localizations.errorGeneric,
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      child: Row(
        children: [
          IconButton(
            key: const ValueKey('editor-back'),
            tooltip: localizations.back,
            onPressed: leaving || cloudActionInProgress ? null : onBack,
            icon: leaving
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.arrow_back_rounded),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: TextField(
              key: const ValueKey('document-title'),
              controller: titleController,
              maxLines: 1,
              style: Theme.of(context).textTheme.titleLarge,
              decoration: InputDecoration(
                hintText: localizations.untitled,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                fillColor: Colors.transparent,
                contentPadding: const EdgeInsets.symmetric(horizontal: 8),
              ),
            ),
          ),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 180),
            child: Text(
              status,
              key: ValueKey(savePhase),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: savePhase == _SavePhase.failed
                    ? IdeallColors.danger
                    : IdeallColors.inkMuted,
              ),
            ),
          ),
          const SizedBox(width: 8),
          if (onUploadDraft != null)
            IconButton.filledTonal(
              key: const ValueKey('upload-draft'),
              tooltip: localizations.uploadDraft,
              onPressed: cloudActionInProgress ? null : onUploadDraft,
              icon: cloudActionInProgress
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.cloud_upload_outlined),
            ),
          if (onPublish != null) ...[
            const SizedBox(width: 6),
            FilledButton.icon(
              key: const ValueKey('publish-document'),
              onPressed: cloudActionInProgress ? null : onPublish,
              icon: cloudActionInProgress
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.publish_rounded, size: 19),
              label: Text(localizations.publish),
            ),
          ],
          MenuAnchor(
            builder: (context, controller, child) => IconButton(
              tooltip: localizations.more,
              onPressed: cloudActionInProgress || leaving
                  ? null
                  : () => controller.isOpen
                        ? controller.close()
                        : controller.open(),
              icon: const Icon(Icons.more_horiz_rounded),
            ),
            menuChildren: [
              MenuItemButton(
                onPressed: () => unawaited(onSave()),
                leadingIcon: const Icon(Icons.save_outlined),
                child: Text(localizations.save),
              ),
              if (onMoveToTrash != null)
                MenuItemButton(
                  onPressed: onMoveToTrash,
                  leadingIcon: const Icon(Icons.delete_outline_rounded),
                  child: Text(localizations.moveToTrash),
                ),
              if (onShowHistory != null)
                MenuItemButton(
                  onPressed: onShowHistory,
                  leadingIcon: const Icon(Icons.history_rounded),
                  child: Text(localizations.publicationHistory),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DividerEmbedBuilder extends EmbedBuilder {
  const _DividerEmbedBuilder();

  @override
  String get key => 'divider';

  @override
  String toPlainText(Embed node) => '\n---\n';

  @override
  Widget build(BuildContext context, EmbedContext embedContext) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 12),
      child: Divider(),
    );
  }
}
