import 'dart:collection';
import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uuid/uuid.dart';

import '../domain/domain.dart';
import 'database/ideall_database.dart';

typedef Clock = DateTime Function();
typedef IdGenerator = String Function();

final class DriftLibraryRepository implements LibraryRepository {
  DriftLibraryRepository(
    this.database, {
    Clock? clock,
    IdGenerator? idGenerator,
  }) : _clock = clock ?? DateTime.now,
       _idGenerator = idGenerator ?? const Uuid().v4;

  final IdeallDatabase database;
  final Clock _clock;
  final IdGenerator _idGenerator;

  @override
  Stream<List<LibraryNode>> watchChildren({
    String? parentId,
    NodeStatus status = NodeStatus.active,
  }) {
    final query = database.select(database.libraryNodeRows)
      ..where(
        (row) =>
            (parentId == null
                ? row.parentId.isNull()
                : row.parentId.equals(parentId)) &
            row.status.equals(status.name),
      )
      ..orderBy([
        (row) => OrderingTerm(expression: row.sortOrder),
        (row) => OrderingTerm(expression: row.title.collate(Collate.noCase)),
        (row) => OrderingTerm(expression: row.id),
      ]);
    return query.watch().map(
      (rows) => List<LibraryNode>.unmodifiable(rows.map(_nodeFromRow)),
    );
  }

  @override
  Stream<LibraryNode?> watchNode(String id) {
    final query = database.select(database.libraryNodeRows)
      ..where((row) => row.id.equals(id));
    return query.watchSingleOrNull().map(
      (row) => row == null ? null : _nodeFromRow(row),
    );
  }

  @override
  Stream<List<LibraryNode>> watchRecent({
    int limit = 30,
    NodeStatus status = NodeStatus.active,
  }) {
    _requirePositiveLimit(limit);
    final query = database.select(database.libraryNodeRows)
      ..where((row) => row.status.equals(status.name))
      ..orderBy([
        (row) => OrderingTerm.desc(row.updatedAtMs),
        (row) => OrderingTerm.desc(row.id),
      ])
      ..limit(limit);
    return query.watch().map(
      (rows) => List<LibraryNode>.unmodifiable(rows.map(_nodeFromRow)),
    );
  }

  @override
  Stream<List<LibraryNode>> watchTrash({int limit = 200}) =>
      watchRecent(limit: limit, status: NodeStatus.trashed);

  @override
  Future<LibraryNode?> getNode(String id) async {
    final query = database.select(database.libraryNodeRows)
      ..where((row) => row.id.equals(id));
    final row = await query.getSingleOrNull();
    return row == null ? null : _nodeFromRow(row);
  }

  @override
  Future<LibraryNode> createNode(CreateNodeInput input) {
    return database.transaction(() async {
      final id = (input.id ?? _idGenerator()).trim();
      if (id.isEmpty) throw ArgumentError.value(id, 'id', 'must not be empty');
      await _validateParent(nodeId: id, parentId: input.parentId);
      final title = _validateTitle(input.title);
      final url = _validateUrl(input.kind, input.url);
      final tags = _normalizeTags(input.tags);
      final now = _now();
      final node = LibraryNode(
        id: id,
        parentId: input.parentId,
        kind: input.kind,
        title: title,
        document: input.document,
        url: url,
        tags: tags,
        status: NodeStatus.active,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        sortOrder: input.sortOrder,
      );
      await database
          .into(database.libraryNodeRows)
          .insert(_nodeCompanion(node));
      await _insertActivity(ActivityType.created, nodeId: id);
      await _markNodeScopeDirty(input.kind);
      return node;
    });
  }

  @override
  Future<LibraryNode> updateNode({
    required String id,
    String? title,
    DocumentContent? document,
    String? url,
    bool changeUrl = false,
    List<String>? tags,
    NodeStatus? status,
    String? parentId,
    bool changeParent = false,
    int? sortOrder,
    int? expectedRevision,
  }) {
    return database.transaction(() async {
      final current = await _requireNode(id);
      _checkRevision(current, expectedRevision);
      if (changeParent) {
        await _validateParent(nodeId: id, parentId: parentId);
      }
      final nextStatus = status ?? current.status;
      final next = current.copyWith(
        parentId: changeParent ? parentId : current.parentId,
        clearParent: changeParent && parentId == null,
        title: title == null ? current.title : _validateTitle(title),
        document: document,
        url: changeUrl ? _validateUrl(current.kind, url) : current.url,
        clearUrl: changeUrl && url == null,
        tags: tags == null ? current.tags : _normalizeTags(tags),
        status: nextStatus,
        updatedAt: _now(),
        deletedAt: nextStatus == NodeStatus.trashed
            ? _now()
            : current.deletedAt,
        clearDeletedAt: nextStatus != NodeStatus.trashed,
        revision: current.revision + 1,
        sortOrder: sortOrder,
      );
      await (database.update(
        database.libraryNodeRows,
      )..where((row) => row.id.equals(id))).write(_nodeCompanion(next));
      await _insertActivity(
        changeParent ? ActivityType.moved : ActivityType.updated,
        nodeId: id,
      );
      await _markNodeScopeDirty(current.kind);
      return next;
    });
  }

  @override
  Future<LibraryNode> moveNode(
    String id,
    String? newParentId, {
    int? expectedRevision,
  }) => updateNode(
    id: id,
    parentId: newParentId,
    changeParent: true,
    expectedRevision: expectedRevision,
  );

  @override
  Future<void> trashNode(String id, {int? expectedRevision}) => _setTreeStatus(
    id,
    NodeStatus.trashed,
    ActivityType.trashed,
    expectedRevision,
  );

  @override
  Future<void> restoreNode(String id, {int? expectedRevision}) =>
      _setTreeStatus(
        id,
        NodeStatus.active,
        ActivityType.restored,
        expectedRevision,
      );

  @override
  Future<void> archiveNode(String id, {int? expectedRevision}) =>
      _setTreeStatus(
        id,
        NodeStatus.archived,
        ActivityType.archived,
        expectedRevision,
      );

  Future<void> _setTreeStatus(
    String id,
    NodeStatus status,
    ActivityType activity,
    int? expectedRevision,
  ) {
    return database.transaction(() async {
      final root = await _requireNode(id);
      _checkRevision(root, expectedRevision);
      final nodes = await _tree(root);
      final now = _now();
      for (final node in nodes) {
        var clearParent = false;
        if (node.id == root.id && status == NodeStatus.active) {
          final parent = node.parentId == null
              ? null
              : await getNode(node.parentId!);
          clearParent = parent?.status == NodeStatus.trashed;
        }
        final next = node.copyWith(
          status: status,
          clearParent: clearParent,
          updatedAt: now,
          deletedAt: status == NodeStatus.trashed ? now : node.deletedAt,
          clearDeletedAt: status != NodeStatus.trashed,
          revision: node.revision + 1,
        );
        await (database.update(
          database.libraryNodeRows,
        )..where((row) => row.id.equals(node.id))).write(_nodeCompanion(next));
        await _markNodeScopeDirty(node.kind);
      }
      await _insertActivity(activity, nodeId: id);
    });
  }

  @override
  Future<void> deletePermanently(String id, {int? expectedRevision}) {
    return database.transaction(() async {
      final root = await _requireNode(id);
      _checkRevision(root, expectedRevision);
      final nodes = await _tree(root);
      final now = _now();
      await _insertActivity(
        ActivityType.deleted,
        nodeId: id,
        details: {'title': root.title, 'node_count': nodes.length},
      );
      for (final node in nodes) {
        final scope = _scopeForNodeKind(node.kind);
        await _upsertNewestTombstone(
          SyncTombstone(
            scope: scope,
            entityId: node.id,
            deletedAt: now,
            revision: node.revision + 1,
          ),
        );
        await _markScopeDirty(scope);
      }
      await (database.delete(
        database.libraryNodeRows,
      )..where((row) => row.id.equals(id))).go();
    });
  }

  @override
  Future<List<SearchHit>> search(
    String query, {
    int limit = 50,
    bool includeArchived = false,
  }) async {
    _requirePositiveLimit(limit);
    final trimmed = query.trim();
    if (trimmed.isEmpty) return const [];
    try {
      final match = _ftsExpression(trimmed);
      if (match.isEmpty) {
        return _fallbackSearch(trimmed, limit, includeArchived);
      }
      final archivedClause = includeArchived
          ? ''
          : "AND n.status != 'archived'";
      final rows = await database
          .customSelect(
            '''
          SELECT n.id AS node_id, bm25(node_search) AS rank
          FROM node_search
          JOIN library_node_rows n ON n.rowid = node_search.rowid
          WHERE node_search MATCH ?
            AND n.status != 'trashed'
            $archivedClause
          ORDER BY rank ASC, n.updated_at_ms DESC, n.id ASC
          LIMIT ?
        ''',
            variables: [Variable<String>(match), Variable<int>(limit)],
            readsFrom: {database.libraryNodeRows},
          )
          .get();
      if (rows.isEmpty) return const [];
      final ids = rows.map((row) => row.read<String>('node_id')).toList();
      final selected = await (database.select(
        database.libraryNodeRows,
      )..where((row) => row.id.isIn(ids))).get();
      final nodes = {for (final row in selected) row.id: _nodeFromRow(row)};
      return [
        for (final row in rows)
          if (nodes[row.read<String>('node_id')] case final node?)
            SearchHit(node: node, rank: row.read<double>('rank')),
      ];
    } on Object {
      // Some vendor SQLite builds omit FTS5. LIKE keeps search functional on
      // those devices and also makes corrupted indexes recoverable.
      return _fallbackSearch(trimmed, limit, includeArchived);
    }
  }

  Future<List<SearchHit>> _fallbackSearch(
    String text,
    int limit,
    bool includeArchived,
  ) async {
    final escaped = text
        .toLowerCase()
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_');
    final pattern = '%$escaped%';
    final query = database.select(database.libraryNodeRows)
      ..where(
        (row) =>
            row.status.isNotValue(NodeStatus.trashed.name) &
            (includeArchived
                ? const Constant(true)
                : row.status.isNotValue(NodeStatus.archived.name)) &
            (row.title.lower().like(pattern, escapeChar: '\\') |
                row.plainText.lower().like(pattern, escapeChar: '\\') |
                row.tagsText.lower().like(pattern, escapeChar: '\\')),
      )
      ..orderBy([(row) => OrderingTerm.desc(row.updatedAtMs)])
      ..limit(limit);
    final rows = await query.get();
    return [
      for (var index = 0; index < rows.length; index++)
        SearchHit(node: _nodeFromRow(rows[index]), rank: index.toDouble()),
    ];
  }

  @override
  Stream<List<Subscription>> watchSubscriptions({bool enabledOnly = false}) {
    final query = database.select(database.subscriptionRows);
    if (enabledOnly) query.where((row) => row.enabled.equals(true));
    query.orderBy([
      (row) => OrderingTerm(expression: row.label.collate(Collate.noCase)),
      (row) => OrderingTerm(expression: row.id),
    ]);
    return query.watch().map(
      (rows) => List<Subscription>.unmodifiable(rows.map(_subscriptionFromRow)),
    );
  }

  @override
  Future<void> upsertSubscription(Subscription subscription) {
    return database.transaction(() async {
      final tombstone = await _getTombstone('subscriptions', subscription.id);
      if (tombstone != null && subscription.revision <= tombstone.revision) {
        // A stale re-delivery must not make a removed subscription visible.
        return;
      }
      if (tombstone != null) {
        await _deleteTombstone('subscriptions', subscription.id);
      }
      await database
          .into(database.subscriptionRows)
          .insertOnConflictUpdate(
            SubscriptionRowsCompanion.insert(
              id: subscription.id,
              kind: subscription.kind,
              targetId: subscription.targetId,
              label: subscription.label,
              metadataJson: Value(jsonEncode(subscription.metadata)),
              enabled: Value(subscription.enabled),
              createdAtMs: subscription.createdAt.millisecondsSinceEpoch,
              updatedAtMs: subscription.updatedAt.millisecondsSinceEpoch,
              revision: Value(subscription.revision),
            ),
          );
      await _markScopeDirty('subscriptions');
    });
  }

  @override
  Future<void> removeSubscription(String id) {
    return database.transaction(() async {
      final query = database.select(database.subscriptionRows)
        ..where((row) => row.id.equals(id));
      final subscription = await query.getSingleOrNull();
      final existing = await _getTombstone('subscriptions', id);
      await _upsertNewestTombstone(
        SyncTombstone(
          scope: 'subscriptions',
          entityId: id,
          deletedAt: _now(),
          revision:
              ((subscription?.revision ?? 0) > (existing?.revision ?? 0)
                  ? subscription?.revision ?? 0
                  : existing?.revision ?? 0) +
              1,
        ),
      );
      await (database.delete(
        database.subscriptionRows,
      )..where((row) => row.id.equals(id))).go();
      await _markScopeDirty('subscriptions');
    });
  }

  @override
  Stream<List<PublicationLink>> watchPublicationLinks() {
    final query = database.select(database.publicationLinkRows)
      ..orderBy([(row) => OrderingTerm.desc(row.updatedAtMs)]);
    return query.watch().map(
      (rows) =>
          List<PublicationLink>.unmodifiable(rows.map(_publicationFromRow)),
    );
  }

  @override
  Future<PublicationLink?> getPublicationLink(String publicationId) async {
    final query = database.select(database.publicationLinkRows)
      ..where((row) => row.publicationId.equals(publicationId));
    final row = await query.getSingleOrNull();
    return row == null ? null : _publicationFromRow(row);
  }

  @override
  Future<void> upsertPublicationLink(PublicationLink link) => database
      .into(database.publicationLinkRows)
      .insertOnConflictUpdate(_publicationCompanion(link));

  @override
  Future<void> removePublicationLink(String publicationId) => (database.delete(
    database.publicationLinkRows,
  )..where((row) => row.publicationId.equals(publicationId))).go();

  @override
  Stream<SyncMetadata?> watchSyncMetadata(String scope) {
    final query = database.select(database.syncMetadataRows)
      ..where((row) => row.scope.equals(scope));
    return query.watchSingleOrNull().map(
      (row) => row == null ? null : _syncFromRow(row),
    );
  }

  @override
  Future<SyncMetadata?> getSyncMetadata(String scope) async {
    final query = database.select(database.syncMetadataRows)
      ..where((row) => row.scope.equals(scope));
    final row = await query.getSingleOrNull();
    return row == null ? null : _syncFromRow(row);
  }

  @override
  Future<void> upsertSyncMetadata(SyncMetadata metadata) => database
      .into(database.syncMetadataRows)
      .insertOnConflictUpdate(_syncCompanion(metadata));

  @override
  Future<void> markSyncDirty(String scope) => _markScopeDirty(scope);

  @override
  Stream<List<ActivityEntry>> watchActivity({int limit = 100}) {
    _requirePositiveLimit(limit);
    final query = database.select(database.activityRows)
      ..orderBy([
        (row) => OrderingTerm.desc(row.occurredAtMs),
        (row) => OrderingTerm.desc(row.id),
      ])
      ..limit(limit);
    return query.watch().map(
      (rows) => List<ActivityEntry>.unmodifiable(rows.map(_activityFromRow)),
    );
  }

  @override
  Future<void> recordActivity(
    ActivityType type, {
    String? nodeId,
    Map<String, Object?> details = const {},
  }) => _insertActivity(type, nodeId: nodeId, details: details);

  @override
  Future<LibrarySnapshot> exportSnapshot() async {
    final results = await Future.wait<Object>([
      database.select(database.libraryNodeRows).get(),
      database.select(database.subscriptionRows).get(),
      database.select(database.publicationLinkRows).get(),
      database.select(database.syncMetadataRows).get(),
      database.select(database.activityRows).get(),
      database.select(database.syncTombstoneRows).get(),
    ]);
    return LibrarySnapshot(
      exportedAt: _now(),
      nodes: (results[0] as List<LibraryNodeRow>).map(_nodeFromRow).toList(),
      subscriptions: (results[1] as List<SubscriptionRow>)
          .map(_subscriptionFromRow)
          .toList(),
      publicationLinks: (results[2] as List<PublicationLinkRow>)
          .map(_publicationFromRow)
          .toList(),
      syncMetadata: (results[3] as List<SyncMetadataRow>)
          .map(_syncFromRow)
          .toList(),
      activity: (results[4] as List<ActivityRow>)
          .map(_activityFromRow)
          .toList(),
      tombstones: (results[5] as List<SyncTombstoneRow>)
          .map(_tombstoneFromRow)
          .toList(),
    );
  }

  @override
  Future<ImportResult> importSnapshot(
    LibrarySnapshot snapshot, {
    ImportMode mode = ImportMode.merge,
    SnapshotImportSource source = SnapshotImportSource.user,
  }) {
    if (snapshot.schemaVersion > LibrarySnapshot.currentSchemaVersion) {
      throw FormatException(
        'Unsupported snapshot schema version: ${snapshot.schemaVersion}.',
      );
    }
    return database.transaction(() async {
      for (final tombstone in snapshot.tombstones) {
        if (!_isKnownScope(tombstone.scope)) {
          throw FormatException('Unknown tombstone scope: ${tombstone.scope}.');
        }
      }

      final incomingTombstones = <String, SyncTombstone>{};
      for (final tombstone in snapshot.tombstones) {
        final key = _tombstoneKey(tombstone.scope, tombstone.entityId);
        final current = incomingTombstones[key];
        incomingTombstones[key] = current == null
            ? tombstone
            : _newerTombstone(current, tombstone);
      }

      final existingNodes = await database
          .select(database.libraryNodeRows)
          .get();
      final existingSubscriptions = await database
          .select(database.subscriptionRows)
          .get();

      // A replace initiated by the user is a local deletion for records absent
      // from the imported snapshot. Preserve that intent as tombstones before
      // clearing rows so another device cannot reintroduce them later.
      if (mode == ImportMode.replace && source == SnapshotImportSource.user) {
        final incomingNodeIds = snapshot.nodes.map((node) => node.id).toSet();
        final incomingSubscriptionIds = snapshot.subscriptions
            .map((subscription) => subscription.id)
            .toSet();
        final now = _now();
        for (final row in existingNodes) {
          if (incomingNodeIds.contains(row.id)) continue;
          final scope = _scopeForNodeKind(NodeKind.values.byName(row.kind));
          final tombstone = SyncTombstone(
            scope: scope,
            entityId: row.id,
            deletedAt: now,
            revision: row.revision + 1,
          );
          final key = _tombstoneKey(scope, row.id);
          incomingTombstones[key] = incomingTombstones[key] == null
              ? tombstone
              : _newerTombstone(incomingTombstones[key]!, tombstone);
        }
        for (final row in existingSubscriptions) {
          if (incomingSubscriptionIds.contains(row.id)) continue;
          final tombstone = SyncTombstone(
            scope: 'subscriptions',
            entityId: row.id,
            deletedAt: now,
            revision: row.revision + 1,
          );
          final key = _tombstoneKey('subscriptions', row.id);
          incomingTombstones[key] = incomingTombstones[key] == null
              ? tombstone
              : _newerTombstone(incomingTombstones[key]!, tombstone);
        }
      }

      Set<String> available;
      if (mode == ImportMode.replace) {
        await database.delete(database.activityRows).go();
        await database.delete(database.publicationLinkRows).go();
        await database.delete(database.libraryNodeRows).go();
        await database.delete(database.subscriptionRows).go();
        available = <String>{};
      } else {
        available = existingNodes.map((row) => row.id).toSet();
      }

      final storedTombstones = await database
          .select(database.syncTombstoneRows)
          .get();
      final effectiveTombstoneKeys = <String>{
        for (final row in storedTombstones)
          _tombstoneKey(row.scope, row.entityId),
        ...incomingTombstones.keys,
      };

      final acceptedNodes = <LibraryNode>[];
      for (final node in snapshot.nodes) {
        final scope = _scopeForNodeKind(node.kind);
        final key = _tombstoneKey(scope, node.id);
        if (source == SnapshotImportSource.user &&
            effectiveTombstoneKeys.contains(key)) {
          continue;
        }
        final current = mode == ImportMode.replace
            ? null
            : await getNode(node.id);
        if (source == SnapshotImportSource.user &&
            current != null &&
            !_incomingNodeIsNewer(node, current)) {
          continue;
        }
        if (source == SnapshotImportSource.sync) {
          await _deleteTombstone(scope, node.id);
        }
        acceptedNodes.add(node);
      }

      final sortedNodes = _parentsFirst(acceptedNodes, available);
      for (final node in sortedNodes) {
        await database
            .into(database.libraryNodeRows)
            .insertOnConflictUpdate(_nodeCompanion(node));
        available.add(node.id);
      }

      var importedSubscriptions = 0;
      for (final subscription in snapshot.subscriptions) {
        final key = _tombstoneKey('subscriptions', subscription.id);
        if (source == SnapshotImportSource.user &&
            effectiveTombstoneKeys.contains(key)) {
          continue;
        }
        final currentQuery = database.select(database.subscriptionRows)
          ..where((row) => row.id.equals(subscription.id));
        final currentRow = await currentQuery.getSingleOrNull();
        if (source == SnapshotImportSource.user &&
            currentRow != null &&
            !_incomingSubscriptionIsNewer(
              subscription,
              _subscriptionFromRow(currentRow),
            )) {
          continue;
        }
        if (source == SnapshotImportSource.sync) {
          await _deleteTombstone('subscriptions', subscription.id);
        }
        await database
            .into(database.subscriptionRows)
            .insertOnConflictUpdate(
              SubscriptionRowsCompanion.insert(
                id: subscription.id,
                kind: subscription.kind,
                targetId: subscription.targetId,
                label: subscription.label,
                metadataJson: Value(jsonEncode(subscription.metadata)),
                enabled: Value(subscription.enabled),
                createdAtMs: subscription.createdAt.millisecondsSinceEpoch,
                updatedAtMs: subscription.updatedAt.millisecondsSinceEpoch,
                revision: Value(subscription.revision),
              ),
            );
        importedSubscriptions++;
      }

      var importedPublicationLinks = 0;
      for (final link in snapshot.publicationLinks) {
        final nodeId =
            link.nodeId != null && await getNode(link.nodeId!) != null
            ? link.nodeId
            : null;
        final effectiveLink = nodeId == link.nodeId
            ? link
            : PublicationLink(
                publicationId: link.publicationId,
                nodeId: nodeId,
                version: link.version,
                state: link.state,
                visibility: link.visibility,
                publicUrl: link.publicUrl,
                lastPublishedAt: link.lastPublishedAt,
                updatedAt: link.updatedAt,
              );
        if (source == SnapshotImportSource.user) {
          final current = await getPublicationLink(link.publicationId);
          if (current != null &&
              !_incomingPublicationIsNewer(effectiveLink, current)) {
            continue;
          }
        }
        await database
            .into(database.publicationLinkRows)
            .insertOnConflictUpdate(_publicationCompanion(effectiveLink));
        importedPublicationLinks++;
      }

      final appliedTombstones = <SyncTombstone>[];
      for (final tombstone in incomingTombstones.values) {
        final applied = await _upsertNewestTombstone(tombstone);
        await _applyTombstone(applied);
        appliedTombstones.add(applied);
      }

      // Sync metadata belongs to the current device and is deliberately never
      // restored from another device's/user backup snapshot.
      for (final activity in snapshot.activity) {
        final nodeId =
            activity.nodeId != null && await getNode(activity.nodeId!) != null
            ? activity.nodeId
            : null;
        await database
            .into(database.activityRows)
            .insertOnConflictUpdate(
              ActivityRowsCompanion.insert(
                id: activity.id,
                type: activity.type.name,
                nodeId: Value(nodeId),
                occurredAtMs: activity.occurredAt.millisecondsSinceEpoch,
                detailsJson: Value(jsonEncode(activity.details)),
              ),
            );
      }

      if (source == SnapshotImportSource.user) {
        final dirtyScopes = <String>{
          for (final node in acceptedNodes) _scopeForNodeKind(node.kind),
          for (final tombstone in appliedTombstones) tombstone.scope,
          if (snapshot.subscriptions.isNotEmpty) 'subscriptions',
          if (mode == ImportMode.replace) ...{
            'notes',
            'bookmarks',
            'subscriptions',
          },
        };
        for (final scope in dirtyScopes) {
          await _markScopeDirty(scope);
        }
        await _insertActivity(
          ActivityType.imported,
          details: {
            'mode': mode.name,
            'nodes': acceptedNodes.length,
            'subscriptions': importedSubscriptions,
            'publication_links': importedPublicationLinks,
            'tombstones': appliedTombstones.length,
          },
        );
      }
      return ImportResult(
        nodes: acceptedNodes.length,
        subscriptions: importedSubscriptions,
        publicationLinks: importedPublicationLinks,
        tombstones: appliedTombstones.length,
      );
    });
  }

  Future<LibraryNode> _requireNode(String id) async {
    final node = await getNode(id);
    if (node == null) throw NodeNotFoundException(id);
    return node;
  }

  void _checkRevision(LibraryNode node, int? expected) {
    if (expected != null && expected != node.revision) {
      throw RevisionConflictException(
        nodeId: node.id,
        expected: expected,
        actual: node.revision,
      );
    }
  }

  Future<void> _validateParent({
    required String nodeId,
    required String? parentId,
  }) async {
    if (parentId == null) return;
    if (nodeId == parentId) throw HierarchyCycleException(nodeId, parentId);
    final parent = await getNode(parentId);
    if (parent == null) throw InvalidParentException(parentId, 'not found');
    if (parent.kind != NodeKind.folder) {
      throw InvalidParentException(parentId, 'parent is not a folder');
    }
    if (parent.status == NodeStatus.trashed) {
      throw InvalidParentException(parentId, 'parent is in trash');
    }
    String? ancestorId = parent.parentId;
    final visited = <String>{parent.id};
    while (ancestorId != null) {
      if (ancestorId == nodeId) {
        throw HierarchyCycleException(nodeId, parentId);
      }
      if (!visited.add(ancestorId)) {
        throw HierarchyCycleException(nodeId, parentId);
      }
      ancestorId = (await getNode(ancestorId))?.parentId;
    }
  }

  Future<List<LibraryNode>> _tree(LibraryNode root) async {
    final result = <LibraryNode>[root];
    final queue = Queue<String>()..add(root.id);
    while (queue.isNotEmpty) {
      final parentId = queue.removeFirst();
      final query = database.select(database.libraryNodeRows)
        ..where((row) => row.parentId.equals(parentId));
      for (final row in await query.get()) {
        final node = _nodeFromRow(row);
        result.add(node);
        queue.add(node.id);
      }
    }
    return result;
  }

  Future<void> _insertActivity(
    ActivityType type, {
    String? nodeId,
    Map<String, Object?> details = const {},
  }) => database
      .into(database.activityRows)
      .insert(
        ActivityRowsCompanion.insert(
          id: _idGenerator(),
          type: type.name,
          nodeId: Value(nodeId),
          occurredAtMs: _now().millisecondsSinceEpoch,
          detailsJson: Value(jsonEncode(details)),
        ),
      );

  Future<void> _markNodeScopeDirty(NodeKind kind) =>
      _markScopeDirty(kind == NodeKind.bookmark ? 'bookmarks' : 'notes');

  Future<SyncTombstone?> _getTombstone(String scope, String entityId) async {
    final query = database.select(database.syncTombstoneRows)
      ..where((row) => row.scope.equals(scope) & row.entityId.equals(entityId));
    final row = await query.getSingleOrNull();
    return row == null ? null : _tombstoneFromRow(row);
  }

  Future<void> _deleteTombstone(String scope, String entityId) =>
      (database.delete(database.syncTombstoneRows)..where(
            (row) => row.scope.equals(scope) & row.entityId.equals(entityId),
          ))
          .go();

  Future<SyncTombstone> _upsertNewestTombstone(SyncTombstone candidate) async {
    final existing = await _getTombstone(candidate.scope, candidate.entityId);
    final newest = existing == null
        ? candidate
        : _newerTombstone(existing, candidate);
    await database
        .into(database.syncTombstoneRows)
        .insertOnConflictUpdate(_tombstoneCompanion(newest));
    return newest;
  }

  Future<void> _applyTombstone(SyncTombstone tombstone) async {
    if (tombstone.scope == 'subscriptions') {
      await (database.delete(
        database.subscriptionRows,
      )..where((row) => row.id.equals(tombstone.entityId))).go();
      return;
    }
    final query = database.select(database.libraryNodeRows)
      ..where((row) => row.id.equals(tombstone.entityId));
    final row = await query.getSingleOrNull();
    if (row == null ||
        _scopeForNodeKind(NodeKind.values.byName(row.kind)) !=
            tombstone.scope) {
      return;
    }
    await (database.delete(
      database.libraryNodeRows,
    )..where((candidate) => candidate.id.equals(tombstone.entityId))).go();
  }

  Future<void> _markScopeDirty(String scope) async {
    final existing = await getSyncMetadata(scope);
    await upsertSyncMetadata(
      SyncMetadata(
        scope: scope,
        localGeneration: existing?.localGeneration,
        remoteGeneration: existing?.remoteGeneration,
        manifestEtag: existing?.manifestEtag,
        versionVector: existing?.versionVector ?? const {},
        dirty: true,
        lastSyncedAt: existing?.lastSyncedAt,
        error: existing?.error,
      ),
    );
  }

  DateTime _now() => _clock().toUtc();
}

LibraryNode _nodeFromRow(LibraryNodeRow row) => LibraryNode(
  id: row.id,
  parentId: row.parentId,
  kind: NodeKind.values.byName(row.kind),
  title: row.title,
  document: DocumentContent(deltaJson: row.deltaJson, plainText: row.plainText),
  url: row.url,
  tags: List<String>.unmodifiable(
    (jsonDecode(row.tagsJson) as List).cast<String>(),
  ),
  status: NodeStatus.values.byName(row.status),
  createdAt: DateTime.fromMillisecondsSinceEpoch(row.createdAtMs, isUtc: true),
  updatedAt: DateTime.fromMillisecondsSinceEpoch(row.updatedAtMs, isUtc: true),
  deletedAt: row.deletedAtMs == null
      ? null
      : DateTime.fromMillisecondsSinceEpoch(row.deletedAtMs!, isUtc: true),
  revision: row.revision,
  sortOrder: row.sortOrder,
);

LibraryNodeRowsCompanion _nodeCompanion(LibraryNode node) =>
    LibraryNodeRowsCompanion.insert(
      id: node.id,
      parentId: Value(node.parentId),
      kind: node.kind.name,
      title: node.title,
      deltaJson: node.document.deltaJson,
      plainText: Value(node.document.plainText),
      url: Value(node.url),
      tagsJson: Value(jsonEncode(node.tags)),
      tagsText: Value(node.tags.join('\n')),
      status: Value(node.status.name),
      createdAtMs: node.createdAt.millisecondsSinceEpoch,
      updatedAtMs: node.updatedAt.millisecondsSinceEpoch,
      deletedAtMs: Value(node.deletedAt?.millisecondsSinceEpoch),
      revision: Value(node.revision),
      sortOrder: Value(node.sortOrder),
    );

Subscription _subscriptionFromRow(SubscriptionRow row) => Subscription(
  id: row.id,
  kind: row.kind,
  targetId: row.targetId,
  label: row.label,
  metadata: Map<String, Object?>.unmodifiable(
    (jsonDecode(row.metadataJson) as Map).cast<String, Object?>(),
  ),
  enabled: row.enabled,
  createdAt: DateTime.fromMillisecondsSinceEpoch(row.createdAtMs, isUtc: true),
  updatedAt: DateTime.fromMillisecondsSinceEpoch(row.updatedAtMs, isUtc: true),
  revision: row.revision,
);

PublicationLink _publicationFromRow(PublicationLinkRow row) => PublicationLink(
  publicationId: row.publicationId,
  nodeId: row.nodeId,
  version: row.version,
  state: PublicationState.values.byName(row.state),
  visibility: PublicationVisibility.values.byName(row.visibility),
  publicUrl: row.publicUrl,
  lastPublishedAt: row.lastPublishedAtMs == null
      ? null
      : DateTime.fromMillisecondsSinceEpoch(
          row.lastPublishedAtMs!,
          isUtc: true,
        ),
  updatedAt: DateTime.fromMillisecondsSinceEpoch(row.updatedAtMs, isUtc: true),
);

PublicationLinkRowsCompanion _publicationCompanion(PublicationLink link) =>
    PublicationLinkRowsCompanion.insert(
      publicationId: link.publicationId,
      nodeId: Value(link.nodeId),
      version: link.version,
      state: link.state.name,
      visibility: link.visibility.name,
      publicUrl: Value(link.publicUrl),
      lastPublishedAtMs: Value(link.lastPublishedAt?.millisecondsSinceEpoch),
      updatedAtMs: link.updatedAt.millisecondsSinceEpoch,
    );

SyncMetadata _syncFromRow(SyncMetadataRow row) => SyncMetadata(
  scope: row.scope,
  localGeneration: row.localGeneration,
  remoteGeneration: row.remoteGeneration,
  manifestEtag: row.manifestEtag,
  versionVector: Map<String, int>.unmodifiable(
    (jsonDecode(row.vectorJson) as Map).map(
      (key, value) => MapEntry(key as String, (value as num).toInt()),
    ),
  ),
  dirty: row.dirty,
  lastSyncedAt: row.lastSyncedAtMs == null
      ? null
      : DateTime.fromMillisecondsSinceEpoch(row.lastSyncedAtMs!, isUtc: true),
  error: row.error,
);

SyncMetadataRowsCompanion _syncCompanion(SyncMetadata metadata) =>
    SyncMetadataRowsCompanion.insert(
      scope: metadata.scope,
      localGeneration: Value(metadata.localGeneration),
      remoteGeneration: Value(metadata.remoteGeneration),
      manifestEtag: Value(metadata.manifestEtag),
      vectorJson: Value(jsonEncode(metadata.versionVector)),
      dirty: Value(metadata.dirty),
      lastSyncedAtMs: Value(metadata.lastSyncedAt?.millisecondsSinceEpoch),
      error: Value(metadata.error),
    );

SyncTombstone _tombstoneFromRow(SyncTombstoneRow row) => SyncTombstone(
  scope: row.scope,
  entityId: row.entityId,
  deletedAt: DateTime.fromMillisecondsSinceEpoch(row.deletedAtMs, isUtc: true),
  revision: row.revision,
);

SyncTombstoneRowsCompanion _tombstoneCompanion(SyncTombstone tombstone) =>
    SyncTombstoneRowsCompanion.insert(
      scope: tombstone.scope,
      entityId: tombstone.entityId,
      deletedAtMs: tombstone.deletedAt.millisecondsSinceEpoch,
      revision: Value(tombstone.revision),
    );

ActivityEntry _activityFromRow(ActivityRow row) => ActivityEntry(
  id: row.id,
  type: ActivityType.values.byName(row.type),
  nodeId: row.nodeId,
  occurredAt: DateTime.fromMillisecondsSinceEpoch(
    row.occurredAtMs,
    isUtc: true,
  ),
  details: Map<String, Object?>.unmodifiable(
    (jsonDecode(row.detailsJson) as Map).cast<String, Object?>(),
  ),
);

String _validateTitle(String value) {
  final title = value.trim();
  if (title.isEmpty) {
    throw ArgumentError.value(value, 'title', 'must not be empty');
  }
  return title;
}

String? _validateUrl(NodeKind kind, String? value) {
  final url = value?.trim();
  if (url == null || url.isEmpty) {
    if (kind == NodeKind.bookmark) {
      throw ArgumentError.value(value, 'url', 'a bookmark requires a URL');
    }
    return null;
  }
  final parsed = Uri.tryParse(url);
  if (parsed == null ||
      !parsed.hasAuthority ||
      (parsed.scheme != 'http' && parsed.scheme != 'https')) {
    throw ArgumentError.value(value, 'url', 'must be an HTTP(S) URL');
  }
  return parsed.toString();
}

List<String> _normalizeTags(Iterable<String> values) {
  final unique = <String, String>{};
  for (final value in values) {
    final tag = value.trim();
    if (tag.isNotEmpty) unique.putIfAbsent(tag.toLowerCase(), () => tag);
  }
  return List<String>.unmodifiable(unique.values);
}

String _scopeForNodeKind(NodeKind kind) =>
    kind == NodeKind.bookmark ? 'bookmarks' : 'notes';

bool _isKnownScope(String scope) =>
    scope == 'notes' || scope == 'bookmarks' || scope == 'subscriptions';

String _tombstoneKey(String scope, String entityId) => '$scope\u0000$entityId';

SyncTombstone _newerTombstone(SyncTombstone left, SyncTombstone right) {
  if (left.scope != right.scope || left.entityId != right.entityId) {
    throw ArgumentError('Only tombstones for the same entity can be compared.');
  }
  if (left.revision != right.revision) {
    return left.revision > right.revision ? left : right;
  }
  final time = left.deletedAt.compareTo(right.deletedAt);
  if (time != 0) return time > 0 ? left : right;
  return left;
}

bool _incomingNodeIsNewer(LibraryNode incoming, LibraryNode current) {
  if (incoming.revision != current.revision) {
    return incoming.revision > current.revision;
  }
  return incoming.updatedAt.isAfter(current.updatedAt);
}

bool _incomingSubscriptionIsNewer(Subscription incoming, Subscription current) {
  if (incoming.revision != current.revision) {
    return incoming.revision > current.revision;
  }
  return incoming.updatedAt.isAfter(current.updatedAt);
}

bool _incomingPublicationIsNewer(
  PublicationLink incoming,
  PublicationLink current,
) {
  if (incoming.version != current.version) {
    return incoming.version > current.version;
  }
  return incoming.updatedAt.isAfter(current.updatedAt);
}

String _ftsExpression(String query) => query
    .split(RegExp(r'\s+'))
    .map((term) => term.replaceAll('"', '').trim())
    .where((term) => term.isNotEmpty)
    .map((term) => '"$term"*')
    .join(' AND ');

List<LibraryNode> _parentsFirst(
  List<LibraryNode> nodes,
  Set<String> initiallyAvailable,
) {
  final remaining = <String, LibraryNode>{
    for (final node in nodes) node.id: node,
  };
  final available = {...initiallyAvailable};
  final sorted = <LibraryNode>[];
  while (remaining.isNotEmpty) {
    final ready =
        remaining.values
            .where(
              (node) =>
                  node.parentId == null || available.contains(node.parentId),
            )
            .toList()
          ..sort((left, right) => left.id.compareTo(right.id));
    if (ready.isEmpty) {
      throw const FormatException(
        'Snapshot hierarchy contains a cycle or a missing parent.',
      );
    }
    for (final node in ready) {
      remaining.remove(node.id);
      available.add(node.id);
      sorted.add(node);
    }
  }
  return sorted;
}

void _requirePositiveLimit(int value) {
  if (value <= 0) throw RangeError.range(value, 1, null, 'limit');
}
