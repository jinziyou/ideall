import 'dart:convert';

/// The kinds of information that can live in the local hierarchy.
enum NodeKind { folder, note, bookmark, publicationDraft }

enum NodeStatus { active, trashed, archived }

enum PublicationState { draft, published, archived }

enum PublicationVisibility { private, unlisted, public }

enum ActivityType {
  created,
  updated,
  moved,
  trashed,
  restored,
  archived,
  deleted,
  opened,
  published,
  synced,
  imported,
}

enum ImportMode { merge, replace }

/// Identifies why a snapshot is being applied.
///
/// User imports are treated as local changes and therefore mark the affected
/// sync scopes dirty. A sync import is already the coordinator's merged view
/// and must not recursively create another local change while it is applied.
enum SnapshotImportSource { user, sync }

const _emptyDeltaJson = '[{"insert":"\\n"}]';

/// Editor content stored in Quill Delta JSON together with its searchable
/// plain-text projection.
final class DocumentContent {
  DocumentContent({required String deltaJson, required this.plainText})
    : deltaJson = _normalizeDelta(deltaJson);

  factory DocumentContent.empty() =>
      DocumentContent(deltaJson: _emptyDeltaJson, plainText: '');

  factory DocumentContent.fromDelta(List<Object?> delta, {String? plainText}) {
    final json = jsonEncode(delta);
    return DocumentContent(
      deltaJson: json,
      plainText: plainText ?? plainTextFromDelta(delta),
    );
  }

  final String deltaJson;
  final String plainText;

  List<Object?> get delta {
    final decoded = jsonDecode(deltaJson);
    return List<Object?>.unmodifiable(decoded as List<Object?>);
  }

  Map<String, Object?> toJson() => {
    'delta': jsonDecode(deltaJson),
    'plain_text': plainText,
  };

  factory DocumentContent.fromJson(Map<String, Object?> json) {
    final deltaValue = json['delta'];
    final encoded = deltaValue is String ? deltaValue : jsonEncode(deltaValue);
    return DocumentContent(
      deltaJson: encoded,
      plainText: json['plain_text'] as String? ?? '',
    );
  }

  static String _normalizeDelta(String value) {
    final decoded = jsonDecode(value);
    if (decoded is! List) {
      throw const FormatException('A Quill Delta must be a JSON array.');
    }
    for (final operation in decoded) {
      if (operation is! Map || !operation.containsKey('insert')) {
        throw const FormatException(
          'Every stored Quill operation must contain an insert value.',
        );
      }
    }
    return jsonEncode(decoded);
  }

  static String plainTextFromDelta(List<Object?> delta) {
    final buffer = StringBuffer();
    for (final value in delta) {
      if (value is! Map) continue;
      final inserted = value['insert'];
      if (inserted is String) {
        buffer.write(inserted);
      } else if (inserted != null) {
        buffer.write('\u{fffc}');
      }
    }
    final result = buffer.toString();
    return result.endsWith('\n')
        ? result.substring(0, result.length - 1)
        : result;
  }
}

final class LibraryNode {
  const LibraryNode({
    required this.id,
    required this.kind,
    required this.title,
    required this.document,
    required this.tags,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    required this.revision,
    this.parentId,
    this.url,
    this.deletedAt,
    this.sortOrder = 0,
  });

  final String id;
  final String? parentId;
  final NodeKind kind;
  final String title;
  final DocumentContent document;
  final String? url;
  final List<String> tags;
  final NodeStatus status;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? deletedAt;
  final int revision;
  final int sortOrder;

  LibraryNode copyWith({
    String? id,
    String? parentId,
    bool clearParent = false,
    NodeKind? kind,
    String? title,
    DocumentContent? document,
    String? url,
    bool clearUrl = false,
    List<String>? tags,
    NodeStatus? status,
    DateTime? createdAt,
    DateTime? updatedAt,
    DateTime? deletedAt,
    bool clearDeletedAt = false,
    int? revision,
    int? sortOrder,
  }) {
    return LibraryNode(
      id: id ?? this.id,
      parentId: clearParent ? null : (parentId ?? this.parentId),
      kind: kind ?? this.kind,
      title: title ?? this.title,
      document: document ?? this.document,
      url: clearUrl ? null : (url ?? this.url),
      tags: List<String>.unmodifiable(tags ?? this.tags),
      status: status ?? this.status,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      deletedAt: clearDeletedAt ? null : (deletedAt ?? this.deletedAt),
      revision: revision ?? this.revision,
      sortOrder: sortOrder ?? this.sortOrder,
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'parent_id': parentId,
    'kind': kind.name,
    'title': title,
    'document': document.toJson(),
    'url': url,
    'tags': tags,
    'status': status.name,
    'created_at_ms': createdAt.millisecondsSinceEpoch,
    'updated_at_ms': updatedAt.millisecondsSinceEpoch,
    'deleted_at_ms': deletedAt?.millisecondsSinceEpoch,
    'revision': revision,
    'sort_order': sortOrder,
  };

  factory LibraryNode.fromJson(Map<String, Object?> json) => LibraryNode(
    id: json['id']! as String,
    parentId: json['parent_id'] as String?,
    kind: NodeKind.values.byName(json['kind']! as String),
    title: json['title']! as String,
    document: DocumentContent.fromJson(
      (json['document']! as Map).cast<String, Object?>(),
    ),
    url: json['url'] as String?,
    tags: List<String>.unmodifiable(
      (json['tags'] as List? ?? const <Object?>[]).cast<String>(),
    ),
    status: NodeStatus.values.byName(json['status']! as String),
    createdAt: DateTime.fromMillisecondsSinceEpoch(
      (json['created_at_ms']! as num).toInt(),
      isUtc: true,
    ),
    updatedAt: DateTime.fromMillisecondsSinceEpoch(
      (json['updated_at_ms']! as num).toInt(),
      isUtc: true,
    ),
    deletedAt: json['deleted_at_ms'] == null
        ? null
        : DateTime.fromMillisecondsSinceEpoch(
            (json['deleted_at_ms']! as num).toInt(),
            isUtc: true,
          ),
    revision: (json['revision']! as num).toInt(),
    sortOrder: (json['sort_order'] as num?)?.toInt() ?? 0,
  );
}

final class CreateNodeInput {
  CreateNodeInput({
    required this.kind,
    required this.title,
    DocumentContent? document,
    List<String> tags = const [],
    this.id,
    this.parentId,
    this.url,
    this.sortOrder = 0,
  }) : document = document ?? DocumentContent.empty(),
       tags = List<String>.unmodifiable(tags);

  final String? id;
  final String? parentId;
  final NodeKind kind;
  final String title;
  final DocumentContent document;
  final String? url;
  final List<String> tags;
  final int sortOrder;
}

final class SearchHit {
  const SearchHit({required this.node, required this.rank});

  final LibraryNode node;
  final double rank;
}

final class Subscription {
  const Subscription({
    required this.id,
    required this.kind,
    required this.targetId,
    required this.label,
    required this.metadata,
    required this.enabled,
    required this.createdAt,
    required this.updatedAt,
    required this.revision,
  });

  final String id;
  final String kind;
  final String targetId;
  final String label;
  final Map<String, Object?> metadata;
  final bool enabled;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int revision;

  Map<String, Object?> toJson() => {
    'id': id,
    'kind': kind,
    'target_id': targetId,
    'label': label,
    'metadata': metadata,
    'enabled': enabled,
    'created_at_ms': createdAt.millisecondsSinceEpoch,
    'updated_at_ms': updatedAt.millisecondsSinceEpoch,
    'revision': revision,
  };

  factory Subscription.fromJson(Map<String, Object?> json) => Subscription(
    id: json['id']! as String,
    kind: json['kind']! as String,
    targetId: json['target_id']! as String,
    label: json['label']! as String,
    metadata: Map<String, Object?>.unmodifiable(
      (json['metadata'] as Map? ?? const <String, Object?>{})
          .cast<String, Object?>(),
    ),
    enabled: json['enabled'] as bool? ?? true,
    createdAt: _dateFromJson(json, 'created_at_ms'),
    updatedAt: _dateFromJson(json, 'updated_at_ms'),
    revision: (json['revision']! as num).toInt(),
  );
}

/// A durable deletion marker carried by encrypted sync snapshots.
///
/// Removing a row alone is ambiguous to another device: it cannot distinguish
/// a deletion from a record it has never seen. Tombstones are retained so a
/// stale live record cannot resurrect a permanently deleted item.
final class SyncTombstone {
  const SyncTombstone({
    required this.scope,
    required this.entityId,
    required this.deletedAt,
    required this.revision,
  });

  final String scope;
  final String entityId;
  final DateTime deletedAt;
  final int revision;

  Map<String, Object?> toJson() => {
    'scope': scope,
    'entity_id': entityId,
    'deleted_at_ms': deletedAt.millisecondsSinceEpoch,
    'revision': revision,
  };

  factory SyncTombstone.fromJson(Map<String, Object?> json) {
    final scope = (json['scope'] as String? ?? '').trim();
    final entityId = (json['entity_id'] as String? ?? '').trim();
    final revision = (json['revision'] as num?)?.toInt() ?? 1;
    if (scope.isEmpty || entityId.isEmpty || revision < 1) {
      throw const FormatException('Invalid sync tombstone.');
    }
    return SyncTombstone(
      scope: scope,
      entityId: entityId,
      deletedAt: _dateFromJson(json, 'deleted_at_ms'),
      revision: revision,
    );
  }
}

final class PublicationLink {
  const PublicationLink({
    required this.publicationId,
    required this.version,
    required this.state,
    required this.visibility,
    required this.updatedAt,
    this.nodeId,
    this.publicUrl,
    this.lastPublishedAt,
  });

  final String publicationId;
  final String? nodeId;
  final int version;
  final PublicationState state;
  final PublicationVisibility visibility;
  final String? publicUrl;
  final DateTime? lastPublishedAt;
  final DateTime updatedAt;

  Map<String, Object?> toJson() => {
    'publication_id': publicationId,
    'node_id': nodeId,
    'version': version,
    'state': state.name,
    'visibility': visibility.name,
    'public_url': publicUrl,
    'last_published_at_ms': lastPublishedAt?.millisecondsSinceEpoch,
    'updated_at_ms': updatedAt.millisecondsSinceEpoch,
  };

  factory PublicationLink.fromJson(Map<String, Object?> json) =>
      PublicationLink(
        publicationId: json['publication_id']! as String,
        nodeId: json['node_id'] as String?,
        version: (json['version']! as num).toInt(),
        state: PublicationState.values.byName(json['state']! as String),
        visibility: PublicationVisibility.values.byName(
          json['visibility']! as String,
        ),
        publicUrl: json['public_url'] as String?,
        lastPublishedAt: _nullableDateFromJson(json, 'last_published_at_ms'),
        updatedAt: _dateFromJson(json, 'updated_at_ms'),
      );
}

final class SyncMetadata {
  const SyncMetadata({
    required this.scope,
    required this.versionVector,
    required this.dirty,
    this.localGeneration,
    this.remoteGeneration,
    this.manifestEtag,
    this.lastSyncedAt,
    this.error,
  });

  final String scope;
  final String? localGeneration;
  final String? remoteGeneration;
  final String? manifestEtag;
  final Map<String, int> versionVector;
  final bool dirty;
  final DateTime? lastSyncedAt;
  final String? error;

  Map<String, Object?> toJson() => {
    'scope': scope,
    'local_generation': localGeneration,
    'remote_generation': remoteGeneration,
    'manifest_etag': manifestEtag,
    'version_vector': versionVector,
    'dirty': dirty,
    'last_synced_at_ms': lastSyncedAt?.millisecondsSinceEpoch,
    'error': error,
  };

  factory SyncMetadata.fromJson(Map<String, Object?> json) => SyncMetadata(
    scope: json['scope']! as String,
    localGeneration: json['local_generation'] as String?,
    remoteGeneration: json['remote_generation'] as String?,
    manifestEtag: json['manifest_etag'] as String?,
    versionVector: Map<String, int>.unmodifiable(
      (json['version_vector'] as Map? ?? const <String, Object?>{}).map(
        (key, value) => MapEntry(key as String, (value as num).toInt()),
      ),
    ),
    dirty: json['dirty'] as bool? ?? false,
    lastSyncedAt: _nullableDateFromJson(json, 'last_synced_at_ms'),
    error: json['error'] as String?,
  );
}

final class ActivityEntry {
  const ActivityEntry({
    required this.id,
    required this.type,
    required this.occurredAt,
    required this.details,
    this.nodeId,
  });

  final String id;
  final ActivityType type;
  final String? nodeId;
  final DateTime occurredAt;
  final Map<String, Object?> details;

  Map<String, Object?> toJson() => {
    'id': id,
    'type': type.name,
    'node_id': nodeId,
    'occurred_at_ms': occurredAt.millisecondsSinceEpoch,
    'details': details,
  };

  factory ActivityEntry.fromJson(Map<String, Object?> json) => ActivityEntry(
    id: json['id']! as String,
    type: ActivityType.values.byName(json['type']! as String),
    nodeId: json['node_id'] as String?,
    occurredAt: _dateFromJson(json, 'occurred_at_ms'),
    details: Map<String, Object?>.unmodifiable(
      (json['details'] as Map? ?? const <String, Object?>{})
          .cast<String, Object?>(),
    ),
  );
}

final class LibrarySnapshot {
  const LibrarySnapshot({
    required this.exportedAt,
    required this.nodes,
    required this.subscriptions,
    required this.publicationLinks,
    required this.syncMetadata,
    required this.activity,
    this.tombstones = const [],
    this.schemaVersion = currentSchemaVersion,
  });

  static const currentSchemaVersion = 2;

  final int schemaVersion;
  final DateTime exportedAt;
  final List<LibraryNode> nodes;
  final List<Subscription> subscriptions;
  final List<PublicationLink> publicationLinks;
  final List<SyncMetadata> syncMetadata;
  final List<ActivityEntry> activity;
  final List<SyncTombstone> tombstones;

  Map<String, Object?> toJson() => {
    'schema': 'org.wonita.ideall.library-snapshot',
    'schema_version': schemaVersion,
    'exported_at_ms': exportedAt.millisecondsSinceEpoch,
    'nodes': nodes.map((value) => value.toJson()).toList(),
    'subscriptions': subscriptions.map((value) => value.toJson()).toList(),
    'publication_links': publicationLinks
        .map((value) => value.toJson())
        .toList(),
    'sync_metadata': syncMetadata.map((value) => value.toJson()).toList(),
    'activity': activity.map((value) => value.toJson()).toList(),
    'tombstones': tombstones.map((value) => value.toJson()).toList(),
  };

  String toJsonString() => jsonEncode(toJson());

  factory LibrarySnapshot.fromJson(Map<String, Object?> json) {
    if (json['schema'] != 'org.wonita.ideall.library-snapshot') {
      throw const FormatException('Not an ideall library snapshot.');
    }
    final version = (json['schema_version']! as num).toInt();
    if (version > currentSchemaVersion || version < 1) {
      throw FormatException('Unsupported snapshot schema version: $version.');
    }
    return LibrarySnapshot(
      schemaVersion: version,
      exportedAt: _dateFromJson(json, 'exported_at_ms'),
      nodes: _objectList(json, 'nodes').map(LibraryNode.fromJson).toList(),
      subscriptions: _objectList(
        json,
        'subscriptions',
      ).map(Subscription.fromJson).toList(),
      publicationLinks: _objectList(
        json,
        'publication_links',
      ).map(PublicationLink.fromJson).toList(),
      syncMetadata: _objectList(
        json,
        'sync_metadata',
      ).map(SyncMetadata.fromJson).toList(),
      activity: _objectList(
        json,
        'activity',
      ).map(ActivityEntry.fromJson).toList(),
      tombstones: _objectList(
        json,
        'tombstones',
      ).map(SyncTombstone.fromJson).toList(),
    );
  }

  factory LibrarySnapshot.fromJsonString(String value) =>
      LibrarySnapshot.fromJson(
        (jsonDecode(value) as Map).cast<String, Object?>(),
      );
}

final class ImportResult {
  const ImportResult({
    required this.nodes,
    required this.subscriptions,
    required this.publicationLinks,
    this.tombstones = 0,
  });

  final int nodes;
  final int subscriptions;
  final int publicationLinks;
  final int tombstones;
}

DateTime _dateFromJson(Map<String, Object?> json, String key) =>
    DateTime.fromMillisecondsSinceEpoch(
      (json[key]! as num).toInt(),
      isUtc: true,
    );

DateTime? _nullableDateFromJson(Map<String, Object?> json, String key) {
  final value = json[key];
  return value == null
      ? null
      : DateTime.fromMillisecondsSinceEpoch(
          (value as num).toInt(),
          isUtc: true,
        );
}

List<Map<String, Object?>> _objectList(Map<String, Object?> json, String key) =>
    (json[key] as List? ?? const <Object?>[])
        .map((value) => (value as Map).cast<String, Object?>())
        .toList();
