import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ideall/l10n/app_localizations.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../application/encrypted_sync_coordinator.dart';
import '../application/local_data_transfer_service.dart';
import '../application/publishing_coordinator.dart';
import '../domain/domain.dart' as domain;
import '../presentation/activity/activity_page.dart';
import '../presentation/browse/article_reader_page.dart';
import '../presentation/browse/browse_page.dart';
import '../presentation/connect/connection_page.dart';
import '../presentation/editor/local_document_editor_page.dart';
import '../presentation/editor/publication_history_dialog.dart';
import '../presentation/editor/rich_document_editor.dart';
import '../presentation/library/bookmark_preview_page.dart';
import '../presentation/library/library_page.dart';
import '../presentation/settings/settings_page.dart';
import '../presentation/shell/ideall_shell.dart';
import '../presentation/widgets/page_frame.dart';
import '../wonita/wonita.dart' as wonita;
import 'ideall_theme.dart';
import 'locale_controller.dart';
import 'providers.dart';
import 'service_endpoint_controller.dart';

class IdeallApp extends ConsumerStatefulWidget {
  const IdeallApp({
    required this.localeController,
    required this.endpointController,
    required this.deviceId,
    super.key,
  });

  final IdeallLocaleController localeController;
  final ServiceEndpointController endpointController;
  final String deviceId;

  @override
  ConsumerState<IdeallApp> createState() => _IdeallAppState();
}

class _IdeallAppState extends ConsumerState<IdeallApp> {
  late final GoRouter _router;
  String? _cachedEndpoint;
  wonita.WonitaServices? _cachedServices;

  domain.LibraryRepository get _repository =>
      ref.read(libraryRepositoryProvider);

  wonita.WonitaServices get _services {
    final endpoint = widget.endpointController.endpoint;
    if (_cachedServices == null || _cachedEndpoint != endpoint) {
      _cachedServices?.client.dio.close(force: true);
      _cachedServices?.client.publicDio.close(force: true);
      _cachedEndpoint = endpoint;
      _cachedServices = wonita.WonitaServices(baseUri: Uri.parse(endpoint));
    }
    return _cachedServices!;
  }

  @override
  void initState() {
    super.initState();
    _router = _buildRouter();
  }

  @override
  void dispose() {
    _router.dispose();
    _cachedServices?.client.dio.close(force: true);
    _cachedServices?.client.publicDio.close(force: true);
    super.dispose();
  }

  GoRouter _buildRouter() {
    return GoRouter(
      initialLocation: '/mine',
      routes: [
        GoRoute(path: '/', redirect: (_, _) => '/mine'),
        ShellRoute(
          builder: (context, state, child) => IdeallShell(child: child),
          routes: [
            GoRoute(
              path: '/mine',
              builder: (context, state) => LibraryPage(
                key: ValueKey(state.uri.queryParameters['folder']),
                initialFolderId: state.uri.queryParameters['folder'],
                initialFolderTitle: state.uri.queryParameters['title'],
                watchItems: _watchLibraryItems,
                createNote: (parentId) async {
                  final node = await _repository.createNode(
                    domain.CreateNodeInput(
                      kind: domain.NodeKind.note,
                      title: AppLocalizations.of(context).untitled,
                      parentId: parentId,
                    ),
                  );
                  return node.id;
                },
                createFolder: (title, parentId) async {
                  await _repository.createNode(
                    domain.CreateNodeInput(
                      kind: domain.NodeKind.folder,
                      title: title,
                      parentId: parentId,
                    ),
                  );
                },
                createBookmark: (title, url, tags, parentId) async {
                  await _repository.createNode(
                    domain.CreateNodeInput(
                      kind: domain.NodeKind.bookmark,
                      title: title,
                      url: url,
                      tags: tags,
                      parentId: parentId,
                    ),
                  );
                },
                moveToTrash: _repository.trashNode,
                openDocument: (id) => context.go('/mine/document/$id'),
                openBookmark: (id) => context.go('/mine/bookmark/$id'),
              ),
            ),
            GoRoute(
              path: '/mine/document/:id',
              builder: (context, state) {
                final nodeId = state.pathParameters['id']!;
                return LocalDocumentEditorPage(
                  nodeId: nodeId,
                  repository: _repository,
                  onUploadDraft: (node, snapshot) =>
                      _uploadDraft(context, node, snapshot),
                  onPublish: (node, snapshot) =>
                      _publish(context, node, snapshot),
                  onShowHistory: (node) => _showHistory(context, node),
                );
              },
            ),
            GoRoute(
              path: '/mine/bookmark/:id',
              builder: (context, state) => _FutureLoader<domain.LibraryNode?>(
                load: () => _repository.getNode(state.pathParameters['id']!),
                builder: (context, node) {
                  if (node == null || node.kind != domain.NodeKind.bookmark) {
                    return _notFound(context);
                  }
                  return BookmarkPreviewPage(
                    bookmark: BookmarkViewData(
                      title: node.title,
                      url: node.url!,
                      tags: node.tags,
                      updatedAt: node.updatedAt,
                    ),
                    onBack: () => _back(context, '/mine'),
                  );
                },
              ),
            ),
            GoRoute(
              path: '/activity',
              builder: (context, state) => ActivityPage(
                watchRecent: () =>
                    _repository.watchRecent().map(_mapLibraryItems),
                watchTrash: () =>
                    _repository.watchTrash().map(_mapLibraryItems),
                onOpen: (item) {
                  switch (item.kind) {
                    case LibraryItemKind.note:
                    case LibraryItemKind.publicationDraft:
                      context.go('/mine/document/${item.id}');
                      return;
                    case LibraryItemKind.bookmark:
                      context.go('/mine/bookmark/${item.id}');
                      return;
                    case LibraryItemKind.folder:
                      context.go(
                        Uri(
                          path: '/mine',
                          queryParameters: {
                            'folder': item.id,
                            'title': item.title,
                          },
                        ).toString(),
                      );
                      return;
                  }
                },
                onRestore: _repository.restoreNode,
                onDeleteForever: _repository.deletePermanently,
              ),
            ),
            GoRoute(
              path: '/browse',
              builder: (context, state) => BrowsePage(
                search: (query) async {
                  final result = await _services.corpus.query(
                    wonita.WonitaArticleQuery(
                      query: query.isEmpty ? null : query,
                      limit: 30,
                    ),
                  );
                  return [
                    for (final article in result.items)
                      BrowseItemViewData(
                        id: article.articleId,
                        title: article.title,
                        excerpt: _excerpt(article.body),
                        publisher: article.publisherDomain,
                        dateLabel: DateFormat.yMMMd().format(
                          DateTime.fromMillisecondsSinceEpoch(
                            article.publishedAtMs,
                          ),
                        ),
                        tags: article.topics,
                      ),
                  ];
                },
                onOpen: (id) => context.go('/browse/article/$id'),
              ),
            ),
            GoRoute(
              path: '/browse/article/:id',
              builder: (context, state) => _FutureLoader<wonita.WonitaArticle>(
                load: () => _services.corpus.get(state.pathParameters['id']!),
                builder: (context, article) => ArticleReaderPage(
                  article: ArticleViewData(
                    title: article.title,
                    markdown: article.body,
                    publisher: article.publisherDomain,
                    sourceUrl: article.canonicalUrl,
                    tags: article.topics,
                  ),
                  onBack: () => _back(context, '/browse'),
                ),
              ),
            ),
            GoRoute(
              path: '/publication/:id',
              builder: (context, state) =>
                  _FutureLoader<wonita.WonitaPublication>(
                    load: () => _services.publications.getPublic(
                      state.pathParameters['id']!,
                    ),
                    builder: (context, publication) => ArticleReaderPage(
                      article: ArticleViewData(
                        title: publication.title,
                        markdown: publication.body,
                        publisher: 'Wonita',
                        sourceUrl: publication.url.isEmpty
                            ? null
                            : publication.url,
                      ),
                      onBack: () => _back(context, '/browse'),
                    ),
                  ),
            ),
            GoRoute(
              path: '/connect',
              builder: (context, state) => ConnectionPage(
                loadAccount: () async {
                  final stored = await _services.client.sessionStore.read();
                  if (stored == null) return null;
                  final account = await _services.auth.currentAccount();
                  return ConnectionAccountViewData(
                    label: account.displayName,
                    email: account.email,
                  );
                },
                signIn: (email, password) =>
                    _services.auth.login(email: email, password: password),
                register: (email, password, displayName) async {
                  await _services.auth.register(
                    email: email,
                    password: password,
                  );
                  if (displayName.isNotEmpty) {
                    await _services.auth.updateProfile(displayName);
                  }
                },
                signOut: _services.auth.logout,
                generateSyncCode: () async =>
                    wonita.WonitaSyncCode.generate().value,
                syncNow: (code) => EncryptedSyncCoordinator(
                  repository: _repository,
                  remote: _services.sync,
                  deviceId: widget.deviceId,
                ).syncAll(wonita.WonitaSyncCode.parse(code)),
              ),
            ),
            GoRoute(
              path: '/settings',
              builder: (context, state) {
                final transfer = LocalDataTransferService(_repository);
                return SettingsPage(
                  localeController: widget.localeController,
                  serviceEndpoint: widget.endpointController.endpoint,
                  onServiceEndpointChanged: (value) {
                    unawaited(widget.endpointController.setEndpoint(value));
                  },
                  onExport: transfer.exportSnapshot,
                  onImport: () async => await transfer.importSnapshot() != null,
                  onRebuildIndex: () async {
                    await ref.read(ideallDatabaseProvider).rebuildSearchIndex();
                    return true;
                  },
                );
              },
            ),
          ],
        ),
      ],
      errorBuilder: (context, state) => Scaffold(
        body: IdeallEmptyState(
          icon: Icons.route_outlined,
          title: AppLocalizations.of(context).errorGeneric,
          body: state.error.toString(),
          action: FilledButton(
            onPressed: () => context.go('/mine'),
            child: Text(AppLocalizations.of(context).back),
          ),
        ),
      ),
    );
  }

  Stream<List<LibraryItemViewData>> _watchLibraryItems({
    String? parentId,
    String query = '',
  }) {
    if (query.trim().isEmpty) {
      return _repository
          .watchChildren(parentId: parentId)
          .map(_mapLibraryItems);
    }
    return Stream.fromFuture(
      _repository.search(query),
    ).map((hits) => _mapLibraryItems(hits.map((hit) => hit.node).toList()));
  }

  List<LibraryItemViewData> _mapLibraryItems(List<domain.LibraryNode> nodes) {
    return [for (final node in nodes) _mapLibraryItem(node)];
  }

  LibraryItemViewData _mapLibraryItem(domain.LibraryNode node) {
    return LibraryItemViewData(
      id: node.id,
      parentId: node.parentId,
      kind: LibraryItemKind.values.byName(node.kind.name),
      title: node.title,
      excerpt: _excerpt(node.document.plainText),
      url: node.url,
      tags: node.tags,
      updatedAt: node.updatedAt.toLocal(),
    );
  }

  PublishingCoordinator get _publisher => PublishingCoordinator(
    repository: _repository,
    remote: _services.publications,
  );

  Future<bool> _requireSession(BuildContext context) async {
    if (await _services.client.sessionStore.read() != null) return true;
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context).notSignedIn)),
      );
      context.go('/connect');
    }
    return false;
  }

  Future<void> _uploadDraft(
    BuildContext context,
    domain.LibraryNode node,
    EditorSnapshot snapshot,
  ) async {
    if (!await _requireSession(context)) return;
    final publication = await _publisher.uploadDraft(node, snapshot);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${AppLocalizations.of(context).draft} · '
            'v${publication.version}',
          ),
        ),
      );
    }
  }

  Future<void> _publish(
    BuildContext context,
    domain.LibraryNode node,
    EditorSnapshot snapshot,
  ) async {
    if (!await _requireSession(context) || !context.mounted) return;
    final visibility = await showDialog<wonita.PublicationVisibility>(
      context: context,
      builder: (context) => const _PublishDialog(),
    );
    if (visibility == null) return;
    final publication = await _publisher.publish(
      node,
      snapshot,
      visibility: visibility,
    );
    if (context.mounted) {
      await showDialog<void>(
        context: context,
        builder: (context) => _PublishedDialog(
          version: publication.version,
          publicUri: PublishingCoordinator.publicUriFor(
            publication.publicationId,
          ),
        ),
      );
    }
  }

  Future<void> _showHistory(
    BuildContext context,
    domain.LibraryNode node,
  ) async {
    if (!await _requireSession(context) || !context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => PublicationHistoryDialog(
        load: () async {
          final versions = await _publisher.versions(node.id);
          return [
            for (final version in versions)
              PublicationVersionViewData(
                version: version.version,
                title: version.title,
                state: version.state.wireName,
                visibility: version.visibility.wireName,
                createdAt: DateTime.fromMillisecondsSinceEpoch(
                  version.revisionCreatedAtMs,
                ),
              ),
          ];
        },
        restore: (version) =>
            _publisher.restoreVersion(nodeId: node.id, version: version),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.localeController,
      builder: (context, _) => MaterialApp.router(
        debugShowCheckedModeBanner: false,
        title: 'Ideall',
        onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
        theme: buildIdeallTheme(),
        locale: widget.localeController.locale,
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          ...AppLocalizations.localizationsDelegates,
          FlutterQuillLocalizations.delegate,
        ],
        routerConfig: _router,
      ),
    );
  }
}

class _FutureLoader<T> extends StatefulWidget {
  const _FutureLoader({required this.load, required this.builder});

  final Future<T> Function() load;
  final Widget Function(BuildContext context, T value) builder;

  @override
  State<_FutureLoader<T>> createState() => _FutureLoaderState<T>();
}

class _FutureLoaderState<T> extends State<_FutureLoader<T>> {
  late Future<T> _future = widget.load();

  @override
  void didUpdateWidget(covariant _FutureLoader<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.load != widget.load) _future = widget.load();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<T>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return PageFrame(
            title: AppLocalizations.of(context).errorGeneric,
            child: IdeallEmptyState(
              icon: Icons.error_outline_rounded,
              title: AppLocalizations.of(context).errorGeneric,
              body: snapshot.error.toString(),
              action: OutlinedButton.icon(
                onPressed: () => setState(() => _future = widget.load()),
                icon: const Icon(Icons.refresh_rounded),
                label: Text(AppLocalizations.of(context).retry),
              ),
            ),
          );
        }
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        return widget.builder(context, snapshot.data as T);
      },
    );
  }
}

class _PublishDialog extends StatefulWidget {
  const _PublishDialog();

  @override
  State<_PublishDialog> createState() => _PublishDialogState();
}

class _PublishDialogState extends State<_PublishDialog> {
  wonita.PublicationVisibility _visibility =
      wonita.PublicationVisibility.public;

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(localizations.publish),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          RadioGroup<wonita.PublicationVisibility>(
            groupValue: _visibility,
            onChanged: (value) {
              if (value != null) setState(() => _visibility = value);
            },
            child: Column(
              children: [
                RadioListTile(
                  value: wonita.PublicationVisibility.public,
                  title: Text(localizations.publicVisibility),
                  subtitle: Text(localizations.browseTitle),
                ),
                RadioListTile(
                  value: wonita.PublicationVisibility.unlisted,
                  title: Text(localizations.unlistedVisibility),
                  subtitle: Text(localizations.localDataNotice),
                ),
              ],
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(localizations.cancel),
        ),
        FilledButton.icon(
          onPressed: () => Navigator.pop(context, _visibility),
          icon: const Icon(Icons.publish_rounded),
          label: Text(localizations.publish),
        ),
      ],
    );
  }
}

class _PublishedDialog extends StatelessWidget {
  const _PublishedDialog({required this.version, required this.publicUri});

  final int version;
  final Uri publicUri;

  Future<void> _copy(BuildContext context) async {
    await Clipboard.setData(ClipboardData(text: publicUri.toString()));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context).linkCopied)),
      );
    }
  }

  Future<void> _open(BuildContext context) async {
    try {
      final opened = await launchUrl(
        publicUri,
        mode: LaunchMode.externalApplication,
      );
      if (!opened && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(context).errorGeneric)),
        );
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(context).errorGeneric)),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(localizations.published),
      content: SizedBox(
        width: 480,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${localizations.version} $version'),
            const SizedBox(height: 16),
            Text(
              localizations.publicationLink,
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 6),
            SelectableText(publicUri.toString()),
          ],
        ),
      ),
      actions: [
        TextButton.icon(
          onPressed: () => _copy(context),
          icon: const Icon(Icons.copy_rounded),
          label: Text(localizations.copyLink),
        ),
        TextButton.icon(
          onPressed: () => _open(context),
          icon: const Icon(Icons.open_in_new_rounded),
          label: Text(localizations.openExternal),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context),
          child: Text(localizations.close),
        ),
      ],
    );
  }
}

Widget _notFound(BuildContext context) => PageFrame(
  title: AppLocalizations.of(context).errorGeneric,
  child: Center(child: Text(AppLocalizations.of(context).notFound)),
);

void _back(BuildContext context, String fallback) {
  if (context.canPop()) {
    context.pop();
  } else {
    context.go(fallback);
  }
}

String _excerpt(String value) {
  final normalized = value.replaceAll(RegExp(r'\s+'), ' ').trim();
  return normalized.length <= 180
      ? normalized
      : '${normalized.substring(0, 177)}…';
}
