import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:ideall/l10n/app_localizations.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/ideall_theme.dart';

class ArticleViewData {
  const ArticleViewData({
    required this.title,
    required this.markdown,
    this.publisher,
    this.sourceUrl,
    this.tags = const [],
  });

  final String title;
  final String markdown;
  final String? publisher;
  final String? sourceUrl;
  final List<String> tags;
}

class ArticleReaderPage extends StatelessWidget {
  const ArticleReaderPage({
    required this.article,
    required this.onBack,
    super.key,
  });

  final ArticleViewData article;
  final VoidCallback onBack;

  Future<void> _open(String? value) async {
    final uri = value == null ? null : Uri.tryParse(value);
    if (uri != null && (uri.scheme == 'http' || uri.scheme == 'https')) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    return ColoredBox(
      color: IdeallColors.surface,
      child: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              pinned: true,
              backgroundColor: IdeallColors.surface.withValues(alpha: 0.96),
              leading: IconButton(
                tooltip: localizations.back,
                onPressed: onBack,
                icon: const Icon(Icons.arrow_back_rounded),
              ),
              actions: [
                if (article.sourceUrl != null)
                  IconButton(
                    tooltip: localizations.openExternal,
                    onPressed: () => _open(article.sourceUrl),
                    icon: const Icon(Icons.open_in_new_rounded),
                  ),
                const SizedBox(width: 8),
              ],
            ),
            SliverToBoxAdapter(
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 820),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(28, 34, 28, 80),
                    child: SelectionArea(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            article.title,
                            style: Theme.of(context).textTheme.displaySmall,
                          ),
                          if (article.publisher?.isNotEmpty ?? false) ...[
                            const SizedBox(height: 12),
                            Text(
                              article.publisher!,
                              style: Theme.of(context).textTheme.bodyMedium
                                  ?.copyWith(color: IdeallColors.inkMuted),
                            ),
                          ],
                          if (article.tags.isNotEmpty) ...[
                            const SizedBox(height: 18),
                            Wrap(
                              spacing: 7,
                              runSpacing: 7,
                              children: [
                                for (final tag in article.tags)
                                  Chip(label: Text(tag)),
                              ],
                            ),
                          ],
                          const SizedBox(height: 30),
                          const Divider(),
                          const SizedBox(height: 22),
                          MarkdownBody(
                            data: article.markdown,
                            selectable: false,
                            onTapLink: (_, href, _) => _open(href),
                            // Corpus Markdown is text-first. Never let remote
                            // content trigger an implicit network or file read;
                            // readers can still open explicit http(s) links.
                            imageBuilder: (uri, title, alt) => Tooltip(
                              message: uri.toString(),
                              child: Semantics(
                                label: alt,
                                child: const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 12),
                                  child: Icon(
                                    Icons.image_not_supported_outlined,
                                    color: IdeallColors.inkMuted,
                                  ),
                                ),
                              ),
                            ),
                            styleSheet:
                                MarkdownStyleSheet.fromTheme(
                                  Theme.of(context),
                                ).copyWith(
                                  p: Theme.of(context).textTheme.bodyLarge,
                                  blockquoteDecoration: const BoxDecoration(
                                    color: IdeallColors.surfaceMuted,
                                    border: Border(
                                      left: BorderSide(
                                        color: IdeallColors.accent,
                                        width: 3,
                                      ),
                                    ),
                                  ),
                                  codeblockDecoration: BoxDecoration(
                                    color: IdeallColors.surfaceMuted,
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(
                                      color: IdeallColors.border,
                                    ),
                                  ),
                                ),
                          ),
                        ],
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
