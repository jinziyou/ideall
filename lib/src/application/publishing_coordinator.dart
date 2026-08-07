import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../domain/domain.dart' as domain;
import '../presentation/editor/rich_document_editor.dart';
import '../wonita/wonita.dart' as wonita;

final class PublishingCoordinator {
  const PublishingCoordinator({required this.repository, required this.remote});

  final domain.LibraryRepository repository;
  final wonita.WonitaPublicationService remote;

  Future<wonita.WonitaPublication> uploadDraft(
    domain.LibraryNode node,
    EditorSnapshot snapshot,
  ) async {
    _validate(snapshot);
    final existing = await _linkForNode(node.id);
    late final wonita.WonitaPublication publication;
    if (existing == null) {
      publication = await remote.createDraft(
        wonita.NewWonitaPublicationDraft(
          clientRequestId: draftRequestIdForNode(node.id),
          title: snapshot.title,
          body: snapshot.markdown,
        ),
      );
    } else {
      publication = await remote.update(
        publicationId: existing.publicationId,
        expectedVersion: existing.version,
        publication: wonita.UpdateWonitaPublication(
          title: snapshot.title,
          body: snapshot.markdown,
        ),
      );
    }
    await _storeLink(node.id, publication);
    return publication;
  }

  Future<wonita.WonitaPublication> publish(
    domain.LibraryNode node,
    EditorSnapshot snapshot, {
    required wonita.PublicationVisibility visibility,
  }) async {
    if (visibility == wonita.PublicationVisibility.private) {
      throw ArgumentError.value(
        visibility,
        'visibility',
        'a published item must be public or unlisted',
      );
    }
    final draft = await uploadDraft(node, snapshot);
    final published = await remote.changeState(
      publicationId: draft.publicationId,
      expectedVersion: draft.version,
      state: wonita.PublicationState.published,
      visibility: visibility,
    );
    await _storeLink(node.id, published);
    await repository.recordActivity(
      domain.ActivityType.published,
      nodeId: node.id,
      details: {
        'publication_id': published.publicationId,
        'version': published.version,
        'visibility': published.visibility.wireName,
      },
    );
    return published;
  }

  Future<List<wonita.WonitaPublicationVersion>> versions(String nodeId) async {
    final link = await _linkForNode(nodeId);
    if (link == null) return const [];
    return remote.versions(link.publicationId);
  }

  Future<wonita.WonitaPublication> restoreVersion({
    required String nodeId,
    required int version,
  }) async {
    final link = await _linkForNode(nodeId);
    if (link == null) {
      throw const FormatException('The note has no cloud publication.');
    }
    final publication = await remote.restore(
      publicationId: link.publicationId,
      version: version,
      expectedVersion: link.version,
    );
    await _storeLink(nodeId, publication);
    return publication;
  }

  Future<domain.PublicationLink?> _linkForNode(String nodeId) async {
    final snapshot = await repository.exportSnapshot();
    for (final link in snapshot.publicationLinks) {
      if (link.nodeId == nodeId) return link;
    }
    return null;
  }

  Future<void> _storeLink(
    String nodeId,
    wonita.WonitaPublication publication,
  ) async {
    await repository.upsertPublicationLink(
      domain.PublicationLink(
        publicationId: publication.publicationId,
        nodeId: nodeId,
        version: publication.version,
        state: domain.PublicationState.values.byName(
          publication.state.wireName,
        ),
        visibility: domain.PublicationVisibility.values.byName(
          publication.visibility.wireName,
        ),
        publicUrl:
            publication.state == wonita.PublicationState.published &&
                publication.visibility != wonita.PublicationVisibility.private
            ? publicUriFor(publication.publicationId).toString()
            : null,
        lastPublishedAt: publication.publishedAtMs == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(
                publication.publishedAtMs!,
                isUtc: true,
              ),
        updatedAt: DateTime.fromMillisecondsSinceEpoch(
          publication.updatedAtMs,
          isUtc: true,
        ),
      ),
    );
  }

  /// A retry must address the same server-side draft even after local edits
  /// increment the node revision.
  static String draftRequestIdForNode(String nodeId) => const Uuid().v5(
    Namespace.url.value,
    'org.wonita.ideall.publication-request.v1/$nodeId',
  );

  static Uri publicUriFor(String publicationId) => Uri(
    scheme: 'https',
    host: 'www.wonita.link',
    pathSegments: <String>['community', 'publications', publicationId],
  );

  void _validate(EditorSnapshot snapshot) {
    final title = snapshot.title.trim();
    if (title.isEmpty || title.runes.length > 200) {
      throw const FormatException(
        'Publication title must contain 1–200 characters.',
      );
    }
    if (utf8.encode(snapshot.markdown).length > 65536) {
      throw const FormatException(
        'Publication body exceeds 65,536 UTF-8 bytes.',
      );
    }
  }
}
