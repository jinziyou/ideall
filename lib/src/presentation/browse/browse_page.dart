import 'package:flutter/material.dart';
import 'package:ideall/l10n/app_localizations.dart';

import '../../app/ideall_theme.dart';
import '../widgets/page_frame.dart';

class BrowseItemViewData {
  const BrowseItemViewData({
    required this.id,
    required this.title,
    required this.excerpt,
    this.publisher,
    this.dateLabel,
    this.tags = const [],
  });

  final String id;
  final String title;
  final String excerpt;
  final String? publisher;
  final String? dateLabel;
  final List<String> tags;
}

typedef BrowseSearch = Future<List<BrowseItemViewData>> Function(String query);

class BrowsePage extends StatefulWidget {
  const BrowsePage({required this.search, required this.onOpen, super.key});

  final BrowseSearch search;
  final ValueChanged<String> onOpen;

  @override
  State<BrowsePage> createState() => _BrowsePageState();
}

class _BrowsePageState extends State<BrowsePage> {
  final _queryController = TextEditingController();
  List<BrowseItemViewData> _items = const [];
  Object? _error;
  bool _loading = false;
  int _requestGeneration = 0;

  @override
  void initState() {
    super.initState();
    _queryController.addListener(_onQueryChanged);
    _load();
  }

  void _onQueryChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _queryController
      ..removeListener(_onQueryChanged)
      ..dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final generation = ++_requestGeneration;
    final query = _queryController.text.trim();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await widget.search(query);
      if (mounted && generation == _requestGeneration) {
        setState(() => _items = items);
      }
    } catch (error) {
      if (mounted && generation == _requestGeneration) {
        setState(() => _error = error);
      }
    } finally {
      if (mounted && generation == _requestGeneration) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    return PageFrame(
      title: localizations.browseTitle,
      subtitle: localizations.offlineReady,
      child: Column(
        children: [
          SearchBar(
            controller: _queryController,
            hintText: localizations.browseSearchHint,
            leading: const Icon(Icons.search_rounded),
            trailing: [
              if (_queryController.text.isNotEmpty)
                IconButton(
                  onPressed: () {
                    _queryController.clear();
                    _load();
                  },
                  icon: const Icon(Icons.close_rounded),
                ),
            ],
            onSubmitted: (_) => _load(),
          ),
          const SizedBox(height: 20),
          if (_loading)
            const LinearProgressIndicator(minHeight: 2)
          else if (_error != null)
            IdeallEmptyState(
              icon: Icons.cloud_off_outlined,
              title: localizations.errorGeneric,
              body: _error.toString(),
              action: OutlinedButton.icon(
                onPressed: _load,
                icon: const Icon(Icons.refresh_rounded),
                label: Text(localizations.retry),
              ),
            )
          else if (_items.isEmpty)
            IdeallEmptyState(
              icon: Icons.manage_search_rounded,
              title: localizations.noResults,
              body: localizations.browseSearchHint,
            )
          else
            Column(
              children: [
                for (var index = 0; index < _items.length; index++) ...[
                  if (index > 0) const SizedBox(height: 12),
                  _BrowseResultCard(item: _items[index], onOpen: widget.onOpen),
                ],
              ],
            ),
        ],
      ),
    );
  }
}

class _BrowseResultCard extends StatelessWidget {
  const _BrowseResultCard({required this.item, required this.onOpen});

  final BrowseItemViewData item;
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context) {
    final metadata = [
      if (item.publisher?.isNotEmpty ?? false) item.publisher!,
      if (item.dateLabel?.isNotEmpty ?? false) item.dateLabel!,
    ].join(' · ');
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => onOpen(item.id),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: IdeallColors.accentSoft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.article_outlined,
                  color: IdeallColors.accent,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (metadata.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        metadata,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                    if (item.excerpt.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Text(
                        item.excerpt,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: IdeallColors.inkMuted,
                        ),
                      ),
                    ],
                    if (item.tags.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          for (final tag in item.tags.take(5))
                            Chip(
                              visualDensity: VisualDensity.compact,
                              label: Text(tag),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right_rounded,
                color: IdeallColors.inkMuted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
