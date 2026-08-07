import 'package:flutter/material.dart';
import 'package:ideall/l10n/app_localizations.dart';

import '../../app/ideall_theme.dart';
import '../library/library_page.dart';
import '../widgets/page_frame.dart';

class ActivityPage extends StatelessWidget {
  const ActivityPage({
    required this.watchRecent,
    required this.watchTrash,
    required this.onOpen,
    required this.onRestore,
    required this.onDeleteForever,
    super.key,
  });

  final Stream<List<LibraryItemViewData>> Function() watchRecent;
  final Stream<List<LibraryItemViewData>> Function() watchTrash;
  final ValueChanged<LibraryItemViewData> onOpen;
  final Future<void> Function(String id) onRestore;
  final Future<void> Function(String id) onDeleteForever;

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    return DefaultTabController(
      length: 2,
      child: PageFrame(
        title: localizations.navActivity,
        maxWidth: 960,
        child: Column(
          children: [
            TabBar(
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: [
                Tab(
                  text: localizations.recent,
                  icon: const Icon(Icons.history_rounded),
                ),
                Tab(
                  text: localizations.trash,
                  icon: const Icon(Icons.delete_outline_rounded),
                ),
              ],
            ),
            SizedBox(
              height: 560,
              child: TabBarView(
                children: [
                  _ActivityList(
                    stream: watchRecent(),
                    emptyTitle: localizations.noActivity,
                    onOpen: onOpen,
                  ),
                  _ActivityList(
                    stream: watchTrash(),
                    emptyTitle: localizations.emptyTrash,
                    onRestore: onRestore,
                    onDeleteForever: onDeleteForever,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActivityList extends StatelessWidget {
  const _ActivityList({
    required this.stream,
    required this.emptyTitle,
    this.onOpen,
    this.onRestore,
    this.onDeleteForever,
  });

  final Stream<List<LibraryItemViewData>> stream;
  final String emptyTitle;
  final ValueChanged<LibraryItemViewData>? onOpen;
  final Future<void> Function(String id)? onRestore;
  final Future<void> Function(String id)? onDeleteForever;

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    return StreamBuilder<List<LibraryItemViewData>>(
      stream: stream,
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
            icon: Icons.history_toggle_off_rounded,
            title: emptyTitle,
            body: localizations.localDataNotice,
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.symmetric(vertical: 16),
          itemCount: items.length,
          separatorBuilder: (_, _) => const Divider(),
          itemBuilder: (context, index) {
            final item = items[index];
            return ListTile(
              leading: Icon(switch (item.kind) {
                LibraryItemKind.folder => Icons.folder_outlined,
                LibraryItemKind.note => Icons.description_outlined,
                LibraryItemKind.bookmark => Icons.bookmark_outline_rounded,
                LibraryItemKind.publicationDraft => Icons.public_outlined,
              }, color: IdeallColors.accent),
              title: Text(
                item.title.isEmpty ? localizations.untitled : item.title,
              ),
              subtitle: Text(
                '${localizations.updated} ${MaterialLocalizations.of(context).formatShortDate(item.updatedAt)}',
              ),
              onTap: onOpen == null ? null : () => onOpen!(item),
              trailing: onRestore == null
                  ? const Icon(Icons.chevron_right_rounded)
                  : Wrap(
                      spacing: 4,
                      children: [
                        IconButton(
                          tooltip: localizations.restore,
                          onPressed: () => onRestore!(item.id),
                          icon: const Icon(Icons.restore_from_trash_outlined),
                        ),
                        IconButton(
                          tooltip: localizations.deleteForever,
                          onPressed: () => _confirmDelete(context, item.id),
                          icon: const Icon(
                            Icons.delete_forever_outlined,
                            color: IdeallColors.danger,
                          ),
                        ),
                      ],
                    ),
            );
          },
        );
      },
    );
  }

  Future<void> _confirmDelete(BuildContext context, String id) async {
    final localizations = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(localizations.confirmDeleteTitle),
        content: Text(localizations.confirmDeleteBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(localizations.cancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: IdeallColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: Text(localizations.deleteForever),
          ),
        ],
      ),
    );
    if (confirmed ?? false) await onDeleteForever!(id);
  }
}
