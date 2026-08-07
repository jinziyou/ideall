import 'models.dart';

abstract interface class LibraryRepository {
  Stream<List<LibraryNode>> watchChildren({
    String? parentId,
    NodeStatus status = NodeStatus.active,
  });

  Stream<LibraryNode?> watchNode(String id);

  Stream<List<LibraryNode>> watchRecent({
    int limit = 30,
    NodeStatus status = NodeStatus.active,
  });

  Stream<List<LibraryNode>> watchTrash({int limit = 200});

  Future<LibraryNode?> getNode(String id);

  Future<LibraryNode> createNode(CreateNodeInput input);

  /// Applies a partial update and increments the node's revision.
  ///
  /// Set [changeParent] or [changeUrl] to distinguish an intentional `null`
  /// from an omitted value. [expectedRevision] provides local optimistic
  /// concurrency control for editors and sync merges.
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
  });

  Future<LibraryNode> moveNode(
    String id,
    String? newParentId, {
    int? expectedRevision,
  });

  Future<void> trashNode(String id, {int? expectedRevision});

  Future<void> restoreNode(String id, {int? expectedRevision});

  Future<void> archiveNode(String id, {int? expectedRevision});

  Future<void> deletePermanently(String id, {int? expectedRevision});

  Future<List<SearchHit>> search(
    String query, {
    int limit = 50,
    bool includeArchived = false,
  });

  Stream<List<Subscription>> watchSubscriptions({bool enabledOnly = false});

  Future<void> upsertSubscription(Subscription subscription);

  Future<void> removeSubscription(String id);

  Stream<List<PublicationLink>> watchPublicationLinks();

  Future<PublicationLink?> getPublicationLink(String publicationId);

  Future<void> upsertPublicationLink(PublicationLink link);

  Future<void> removePublicationLink(String publicationId);

  Stream<SyncMetadata?> watchSyncMetadata(String scope);

  Future<SyncMetadata?> getSyncMetadata(String scope);

  Future<void> upsertSyncMetadata(SyncMetadata metadata);

  Future<void> markSyncDirty(String scope);

  Stream<List<ActivityEntry>> watchActivity({int limit = 100});

  Future<void> recordActivity(
    ActivityType type, {
    String? nodeId,
    Map<String, Object?> details = const {},
  });

  Future<LibrarySnapshot> exportSnapshot();

  Future<ImportResult> importSnapshot(
    LibrarySnapshot snapshot, {
    ImportMode mode = ImportMode.merge,
    SnapshotImportSource source = SnapshotImportSource.user,
  });
}

final class NodeNotFoundException implements Exception {
  const NodeNotFoundException(this.nodeId);

  final String nodeId;

  @override
  String toString() => 'NodeNotFoundException: $nodeId';
}

final class RevisionConflictException implements Exception {
  const RevisionConflictException({
    required this.nodeId,
    required this.expected,
    required this.actual,
  });

  final String nodeId;
  final int expected;
  final int actual;

  @override
  String toString() =>
      'RevisionConflictException: $nodeId expected $expected, actual $actual';
}

final class InvalidParentException implements Exception {
  const InvalidParentException(this.parentId, this.reason);

  final String parentId;
  final String reason;

  @override
  String toString() => 'InvalidParentException: $parentId ($reason)';
}

final class HierarchyCycleException implements Exception {
  const HierarchyCycleException(this.nodeId, this.parentId);

  final String nodeId;
  final String parentId;

  @override
  String toString() => 'HierarchyCycleException: $nodeId -> $parentId';
}
