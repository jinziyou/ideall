import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ideall/l10n/app_localizations.dart';

import '../../domain/domain.dart';
import '../widgets/page_frame.dart';
import 'rich_document_editor.dart';

class LocalDocumentEditorPage extends StatefulWidget {
  const LocalDocumentEditorPage({
    required this.nodeId,
    required this.repository,
    this.onUploadDraft,
    this.onPublish,
    this.onShowHistory,
    super.key,
  });

  final String nodeId;
  final LibraryRepository repository;
  final Future<void> Function(LibraryNode node, EditorSnapshot snapshot)?
  onUploadDraft;
  final Future<void> Function(LibraryNode node, EditorSnapshot snapshot)?
  onPublish;
  final Future<void> Function(LibraryNode node)? onShowHistory;

  @override
  State<LocalDocumentEditorPage> createState() =>
      _LocalDocumentEditorPageState();
}

class _LocalDocumentEditorPageState extends State<LocalDocumentEditorPage> {
  late final Future<LibraryNode?> _load = widget.repository.getNode(
    widget.nodeId,
  );
  LibraryNode? _node;

  Future<void> _save(EditorSnapshot value) async {
    final current = _node;
    if (current == null) return;
    final title = value.title.isEmpty
        ? AppLocalizations.of(context).untitled
        : value.title;
    try {
      _node = await widget.repository.updateNode(
        id: current.id,
        title: title,
        document: DocumentContent(
          deltaJson: value.deltaJson,
          plainText: value.plainText,
        ),
        tags: value.tags,
        expectedRevision: current.revision,
      );
    } on RevisionConflictException {
      final latest = await widget.repository.getNode(current.id);
      if (latest == null) rethrow;
      _node = await widget.repository.updateNode(
        id: latest.id,
        title: title,
        document: DocumentContent(
          deltaJson: value.deltaJson,
          plainText: value.plainText,
        ),
        tags: value.tags,
        expectedRevision: latest.revision,
      );
    }
  }

  Future<void> _trash() async {
    final node = _node;
    if (node == null) return;
    await widget.repository.trashNode(node.id, expectedRevision: node.revision);
    if (mounted) context.go('/mine');
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<LibraryNode?>(
      future: _load,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return PageFrame(
            title: AppLocalizations.of(context).errorGeneric,
            child: Center(child: Text(snapshot.error.toString())),
          );
        }
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        final node = snapshot.data;
        if (node == null ||
            (node.kind != NodeKind.note &&
                node.kind != NodeKind.publicationDraft)) {
          return PageFrame(
            title: AppLocalizations.of(context).errorGeneric,
            child: Center(child: Text(AppLocalizations.of(context).notFound)),
          );
        }
        _node ??= node;
        return RichDocumentEditor(
          initialTitle: node.title,
          initialDeltaJson: node.document.deltaJson,
          initialTags: node.tags,
          onSave: _save,
          onBack: () => context.go('/mine'),
          onMoveToTrash: _trash,
          onUploadDraft: widget.onUploadDraft == null
              ? null
              : (value) => widget.onUploadDraft!(_node!, value),
          onPublish: widget.onPublish == null
              ? null
              : (value) => widget.onPublish!(_node!, value),
          onShowHistory: widget.onShowHistory == null
              ? null
              : () => widget.onShowHistory!(_node!),
        );
      },
    );
  }
}
