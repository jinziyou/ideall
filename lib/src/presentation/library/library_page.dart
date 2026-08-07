import 'dart:async';

import 'package:flutter/material.dart';
import 'package:ideall/l10n/app_localizations.dart';

import '../../app/ideall_theme.dart';
import '../widgets/page_frame.dart';

enum LibraryItemKind { folder, note, bookmark, publicationDraft }

class LibraryItemViewData {
  const LibraryItemViewData({
    required this.id,
    required this.kind,
    required this.title,
    required this.updatedAt,
    this.parentId,
    this.excerpt = '',
    this.url,
    this.tags = const [],
  });

  final String id;
  final String? parentId;
  final LibraryItemKind kind;
  final String title;
  final String excerpt;
  final String? url;
  final List<String> tags;
  final DateTime updatedAt;
}

typedef WatchLibraryItems =
    Stream<List<LibraryItemViewData>> Function({
      String? parentId,
      String query,
    });

class LibraryPage extends StatefulWidget {
  const LibraryPage({
    required this.watchItems,
    required this.createNote,
    required this.createFolder,
    required this.createBookmark,
    required this.moveToTrash,
    required this.openDocument,
    required this.openBookmark,
    this.initialFolderId,
    this.initialFolderTitle,
    super.key,
  });

  final WatchLibraryItems watchItems;
  final Future<String> Function(String? parentId) createNote;
  final Future<void> Function(String title, String? parentId) createFolder;
  final Future<void> Function(
    String title,
    String url,
    List<String> tags,
    String? parentId,
  )
  createBookmark;
  final Future<void> Function(String id) moveToTrash;
  final ValueChanged<String> openDocument;
  final ValueChanged<String> openBookmark;
  final String? initialFolderId;
  final String? initialFolderTitle;

  @override
  State<LibraryPage> createState() => _LibraryPageState();
}

enum _CreateKind { note, folder, bookmark }

class _FolderCrumb {
  const _FolderCrumb(this.id, this.title);
  final String id;
  final String title;
}

class _LibraryPageState extends State<LibraryPage> {
  final _searchController = TextEditingController();
  final List<_FolderCrumb> _folders = [];
  Timer? _searchTimer;
  String _query = '';

  String? get _parentId => _folders.isEmpty ? null : _folders.last.id;

  @override
  void initState() {
    super.initState();
    if (widget.initialFolderId case final id? when id.isNotEmpty) {
      _folders.add(_FolderCrumb(id, widget.initialFolderTitle ?? id));
    }
    _searchController.addListener(_onSearchChanged);
  }

  void _onSearchChanged() {
    _searchTimer?.cancel();
    _searchTimer = Timer(const Duration(milliseconds: 240), () {
      if (mounted) setState(() => _query = _searchController.text.trim());
    });
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    _searchController
      ..removeListener(_onSearchChanged)
      ..dispose();
    super.dispose();
  }

  Future<void> _create(_CreateKind kind) async {
    switch (kind) {
      case _CreateKind.note:
        final id = await widget.createNote(_parentId);
        widget.openDocument(id);
        break;
      case _CreateKind.folder:
        final title = await _askForText(
          AppLocalizations.of(context).newFolder,
          AppLocalizations.of(context).title,
        );
        if (title != null && title.trim().isNotEmpty) {
          await widget.createFolder(title.trim(), _parentId);
        }
        break;
      case _CreateKind.bookmark:
        final bookmark = await _showBookmarkDialog();
        if (bookmark != null) {
          await widget.createBookmark(
            bookmark.title,
            bookmark.url,
            bookmark.tags,
            _parentId,
          );
        }
        break;
    }
  }

  Future<String?> _askForText(String title, String label) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(labelText: label),
          onSubmitted: (value) => Navigator.pop(context, value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(AppLocalizations.of(context).cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: Text(AppLocalizations.of(context).save),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  Future<_BookmarkDraft?> _showBookmarkDialog() async {
    final title = TextEditingController();
    final url = TextEditingController();
    final tags = TextEditingController();
    String? validation;
    final result = await showDialog<_BookmarkDraft>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(AppLocalizations.of(context).newBookmark),
          content: SizedBox(
            width: 460,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: title,
                  decoration: InputDecoration(
                    labelText: AppLocalizations.of(context).title,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: url,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: InputDecoration(
                    labelText: AppLocalizations.of(context).url,
                    errorText: validation,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: tags,
                  decoration: InputDecoration(
                    labelText: AppLocalizations.of(context).tags,
                    hintText: AppLocalizations.of(context).tagHint,
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(AppLocalizations.of(context).cancel),
            ),
            FilledButton(
              onPressed: () {
                final uri = Uri.tryParse(url.text.trim());
                if (uri == null ||
                    !uri.hasAuthority ||
                    (uri.scheme != 'http' && uri.scheme != 'https')) {
                  setDialogState(() => validation = 'https://…');
                  return;
                }
                Navigator.pop(
                  context,
                  _BookmarkDraft(
                    title.text.trim().isEmpty ? uri.host : title.text.trim(),
                    uri.toString(),
                    tags.text
                        .split(',')
                        .map((value) => value.trim())
                        .where((value) => value.isNotEmpty)
                        .toSet()
                        .toList(growable: false),
                  ),
                );
              },
              child: Text(AppLocalizations.of(context).save),
            ),
          ],
        ),
      ),
    );
    title.dispose();
    url.dispose();
    tags.dispose();
    return result;
  }

  void _openItem(LibraryItemViewData item) {
    switch (item.kind) {
      case LibraryItemKind.folder:
        setState(() {
          _folders.add(_FolderCrumb(item.id, item.title));
          _searchController.clear();
          _query = '';
        });
        return;
      case LibraryItemKind.note:
      case LibraryItemKind.publicationDraft:
        widget.openDocument(item.id);
        return;
      case LibraryItemKind.bookmark:
        widget.openBookmark(item.id);
        return;
    }
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 980) {
          return SafeArea(
            child: Row(
              children: [
                SizedBox(
                  width: 232,
                  child: _LibrarySidebar(
                    watchItems: widget.watchItems,
                    selectedParent: _parentId,
                    onRoot: () => setState(_folders.clear),
                    onFolder: (item) => setState(() {
                      _folders
                        ..clear()
                        ..add(_FolderCrumb(item.id, item.title));
                    }),
                  ),
                ),
                const VerticalDivider(),
                Expanded(child: _buildMain()),
              ],
            ),
          );
        }
        return SafeArea(child: _buildMain());
      },
    );
  }

  Widget _buildMain() {
    final localizations = AppLocalizations.of(context);
    return Padding(
      padding: EdgeInsets.symmetric(
        horizontal: MediaQuery.sizeOf(context).width < 600 ? 18 : 30,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 26),
          Row(
            children: [
              Expanded(child: _buildBreadcrumbs(localizations)),
              MenuAnchor(
                menuChildren: [
                  MenuItemButton(
                    onPressed: () => _create(_CreateKind.note),
                    leadingIcon: const Icon(Icons.note_add_outlined),
                    child: Text(localizations.newNote),
                  ),
                  MenuItemButton(
                    onPressed: () => _create(_CreateKind.folder),
                    leadingIcon: const Icon(Icons.create_new_folder_outlined),
                    child: Text(localizations.newFolder),
                  ),
                  MenuItemButton(
                    onPressed: () => _create(_CreateKind.bookmark),
                    leadingIcon: const Icon(Icons.bookmark_add_outlined),
                    child: Text(localizations.newBookmark),
                  ),
                ],
                builder: (context, controller, child) => FilledButton.icon(
                  onPressed: () {
                    if (controller.isOpen) {
                      controller.close();
                    } else {
                      controller.open();
                    }
                  },
                  icon: const Icon(Icons.add_rounded),
                  label: Text(localizations.create),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          SearchBar(
            controller: _searchController,
            hintText: localizations.searchHint,
            leading: const Icon(Icons.search_rounded),
            trailing: [
              if (_query.isNotEmpty)
                IconButton(
                  onPressed: _searchController.clear,
                  icon: const Icon(Icons.close_rounded),
                ),
            ],
          ),
          const SizedBox(height: 18),
          Expanded(
            child: StreamBuilder<List<LibraryItemViewData>>(
              stream: widget.watchItems(parentId: _parentId, query: _query),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return IdeallEmptyState(
                    icon: Icons.error_outline_rounded,
                    title: localizations.errorGeneric,
                    body: snapshot.error.toString(),
                  );
                }
                if (!snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final items = snapshot.data!;
                if (items.isEmpty) {
                  return IdeallEmptyState(
                    icon: Icons.auto_stories_outlined,
                    title: localizations.emptyLibraryTitle,
                    body: localizations.emptyLibraryBody,
                    action: FilledButton.icon(
                      onPressed: () => _create(_CreateKind.note),
                      icon: const Icon(Icons.add_rounded),
                      label: Text(localizations.newNote),
                    ),
                  );
                }
                return ListView.separated(
                  padding: const EdgeInsets.only(bottom: 30),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 9),
                  itemBuilder: (context, index) => _LibraryItemTile(
                    item: items[index],
                    onOpen: _openItem,
                    onTrash: widget.moveToTrash,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBreadcrumbs(AppLocalizations localizations) {
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        TextButton(
          onPressed: _folders.isEmpty
              ? null
              : () => setState(() {
                  _folders.clear();
                  _searchController.clear();
                }),
          child: Text(
            localizations.libraryTitle,
            style: Theme.of(context).textTheme.headlineMedium,
          ),
        ),
        for (var index = 0; index < _folders.length; index++) ...[
          const Icon(Icons.chevron_right_rounded, color: IdeallColors.inkMuted),
          TextButton(
            onPressed: index == _folders.length - 1
                ? null
                : () => setState(
                    () => _folders.removeRange(index + 1, _folders.length),
                  ),
            child: Text(_folders[index].title),
          ),
        ],
      ],
    );
  }
}

class _LibrarySidebar extends StatelessWidget {
  const _LibrarySidebar({
    required this.watchItems,
    required this.selectedParent,
    required this.onRoot,
    required this.onFolder,
  });

  final WatchLibraryItems watchItems;
  final String? selectedParent;
  final VoidCallback onRoot;
  final ValueChanged<LibraryItemViewData> onFolder;

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    return ColoredBox(
      color: IdeallColors.surfaceMuted,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 22, 12, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text(
                localizations.quickStart,
                style: Theme.of(
                  context,
                ).textTheme.labelLarge?.copyWith(color: IdeallColors.inkMuted),
              ),
            ),
            const SizedBox(height: 8),
            ListTile(
              selected: selectedParent == null,
              selectedTileColor: IdeallColors.selection,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              leading: const Icon(Icons.inbox_outlined),
              title: Text(localizations.allItems),
              onTap: onRoot,
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text(
                localizations.folder,
                style: Theme.of(
                  context,
                ).textTheme.labelLarge?.copyWith(color: IdeallColors.inkMuted),
              ),
            ),
            const SizedBox(height: 6),
            Expanded(
              child: StreamBuilder<List<LibraryItemViewData>>(
                stream: watchItems(parentId: null, query: ''),
                builder: (context, snapshot) {
                  final folders = (snapshot.data ?? const [])
                      .where((item) => item.kind == LibraryItemKind.folder)
                      .toList(growable: false);
                  return ListView.builder(
                    itemCount: folders.length,
                    itemBuilder: (context, index) {
                      final folder = folders[index];
                      return ListTile(
                        dense: true,
                        selected: selectedParent == folder.id,
                        selectedTileColor: IdeallColors.selection,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        leading: const Icon(Icons.folder_outlined),
                        title: Text(
                          folder.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () => onFolder(folder),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LibraryItemTile extends StatelessWidget {
  const _LibraryItemTile({
    required this.item,
    required this.onOpen,
    required this.onTrash,
  });

  final LibraryItemViewData item;
  final ValueChanged<LibraryItemViewData> onOpen;
  final Future<void> Function(String id) onTrash;

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    final (icon, color) = switch (item.kind) {
      LibraryItemKind.folder => (
        Icons.folder_outlined,
        const Color(0xFF4974A5),
      ),
      LibraryItemKind.note => (Icons.description_outlined, IdeallColors.accent),
      LibraryItemKind.bookmark => (
        Icons.bookmark_outline_rounded,
        const Color(0xFF8A5B1B),
      ),
      LibraryItemKind.publicationDraft => (
        Icons.public_outlined,
        const Color(0xFF7657A7),
      ),
    };
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => onOpen(item),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 8, 14),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.11),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(icon, color: color, size: 21),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title.isEmpty ? localizations.untitled : item.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (item.excerpt.isNotEmpty || item.url != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        item.url ?? item.excerpt,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
              if (item.tags.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Chip(label: Text(item.tags.first)),
                ),
              PopupMenuButton<String>(
                onSelected: (_) => onTrash(item.id),
                itemBuilder: (context) => [
                  PopupMenuItem(
                    value: 'trash',
                    child: Row(
                      children: [
                        const Icon(Icons.delete_outline_rounded),
                        const SizedBox(width: 10),
                        Text(localizations.moveToTrash),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BookmarkDraft {
  const _BookmarkDraft(this.title, this.url, this.tags);
  final String title;
  final String url;
  final List<String> tags;
}
