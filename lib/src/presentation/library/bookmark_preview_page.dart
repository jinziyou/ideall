import 'package:flutter/material.dart';
import 'package:ideall/l10n/app_localizations.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/ideall_theme.dart';

class BookmarkViewData {
  const BookmarkViewData({
    required this.title,
    required this.url,
    this.tags = const [],
    this.updatedAt,
  });

  final String title;
  final String url;
  final List<String> tags;
  final DateTime? updatedAt;
}

class BookmarkPreviewPage extends StatelessWidget {
  const BookmarkPreviewPage({
    required this.bookmark,
    required this.onBack,
    super.key,
  });

  final BookmarkViewData bookmark;
  final VoidCallback onBack;

  Future<void> _open() async {
    final uri = Uri.tryParse(bookmark.url);
    if (uri != null && (uri.scheme == 'http' || uri.scheme == 'https')) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    final uri = Uri.tryParse(bookmark.url);
    return ColoredBox(
      color: IdeallColors.surface,
      child: SafeArea(
        child: Column(
          children: [
            AppBar(
              leading: IconButton(
                tooltip: localizations.back,
                onPressed: onBack,
                icon: const Icon(Icons.arrow_back_rounded),
              ),
              title: Text(localizations.bookmark),
            ),
            Expanded(
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 680),
                  child: Padding(
                    padding: const EdgeInsets.all(28),
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(28),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              width: 58,
                              height: 58,
                              decoration: BoxDecoration(
                                color: IdeallColors.accentSoft,
                                borderRadius: BorderRadius.circular(17),
                              ),
                              child: const Icon(
                                Icons.bookmark_outline_rounded,
                                color: IdeallColors.accent,
                                size: 29,
                              ),
                            ),
                            const SizedBox(height: 22),
                            Text(
                              bookmark.title,
                              style: Theme.of(context).textTheme.headlineMedium,
                            ),
                            const SizedBox(height: 9),
                            Text(
                              uri?.host ?? bookmark.url,
                              style: Theme.of(context).textTheme.bodyMedium
                                  ?.copyWith(color: IdeallColors.inkMuted),
                            ),
                            if (bookmark.tags.isNotEmpty) ...[
                              const SizedBox(height: 18),
                              Wrap(
                                spacing: 7,
                                runSpacing: 7,
                                children: [
                                  for (final tag in bookmark.tags)
                                    Chip(label: Text(tag)),
                                ],
                              ),
                            ],
                            const SizedBox(height: 24),
                            SizedBox(
                              width: double.infinity,
                              child: FilledButton.icon(
                                onPressed: _open,
                                icon: const Icon(Icons.open_in_new_rounded),
                                label: Text(localizations.openExternal),
                              ),
                            ),
                            const SizedBox(height: 10),
                            SelectableText(
                              bookmark.url,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
