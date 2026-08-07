import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../domain/domain.dart';
import '../wonita/wonita.dart';

/// Coordinates local records with Wonita's encrypted, immutable-part transport.
/// The server sees only independently derived sync ids and AES-GCM ciphertext.
final class EncryptedSyncCoordinator {
  EncryptedSyncCoordinator({
    required this.repository,
    required this.remote,
    required this.deviceId,
  });

  static const _deviceIdPreference = 'ideall.sync.deviceId.v1';

  final LibraryRepository repository;
  final WonitaSyncService remote;
  final String deviceId;

  static Future<String> loadOrCreateDeviceId() async {
    final preferences = await SharedPreferences.getInstance();
    final stored = preferences.getString(_deviceIdPreference);
    if (stored != null && stored.isNotEmpty) return stored;
    final created = const Uuid().v4();
    await preferences.setString(_deviceIdPreference, created);
    return created;
  }

  Future<void> syncAll(WonitaSyncCode code) async {
    // Folders travel with notes, so notes must land before bookmarks that may
    // refer to those folders.
    for (final scope in const [
      WonitaSyncScope.notes,
      WonitaSyncScope.bookmarks,
      WonitaSyncScope.subscriptions,
    ]) {
      await _syncScope(code, scope);
    }
    await repository.recordActivity(ActivityType.synced);
  }

  Future<void> _syncScope(WonitaSyncCode code, WonitaSyncScope scope) async {
    final scopeName = scope.wireName;
    try {
      for (var attempt = 0; attempt < 3; attempt++) {
        final localLibrary = await repository.exportSnapshot();
        final localMetadata = await repository.getSyncMetadata(scopeName);
        final localVector = Map<String, int>.from(
          localMetadata?.versionVector ?? const {},
        );
        if (localMetadata?.dirty ?? _hasScopeRecords(localLibrary, scope)) {
          localVector[deviceId] = (localVector[deviceId] ?? 0) + 1;
        }

        final download = await remote.download(code: code, scope: scope);
        final remoteSnapshot = download == null
            ? null
            : WonitaSyncSnapshot.fromBytes(download.payload);
        if (remoteSnapshot != null && remoteSnapshot.scope != scope) {
          throw const FormatException('Downloaded sync scope does not match.');
        }
        final remoteEnvelope = _decodeRemote(remoteSnapshot);
        final relation = _compareVectors(localVector, remoteEnvelope.vector);
        final mergedVector = _mergeVectors(localVector, remoteEnvelope.vector);
        final mergedRecords = _mergeRecords(
          scope: scope,
          local: localLibrary,
          remote: remoteEnvelope,
          relation: relation,
        );
        final wireRecords = <Map<String, Object?>>[
          {
            'kind': 'meta',
            'writer_device_id': deviceId,
            'vector': mergedVector,
          },
          ...mergedRecords,
        ];
        final mergedSnapshot = WonitaSyncSnapshot(
          scope: scope,
          exportedAtMs: DateTime.now().toUtc().millisecondsSinceEpoch,
          records: wireRecords,
        );

        await _importMerged(mergedRecords);
        try {
          final upload = await remote.uploadSnapshot(
            code: code,
            snapshot: mergedSnapshot,
            expectedVersion: download?.manifest.version ?? 0,
          );
          await repository.upsertSyncMetadata(
            SyncMetadata(
              scope: scopeName,
              localGeneration: upload.manifest.generation,
              remoteGeneration: upload.manifest.generation,
              manifestEtag: upload.manifest.version.toString(),
              versionVector: mergedVector,
              dirty: false,
              lastSyncedAt: DateTime.now().toUtc(),
            ),
          );
          return;
        } on DioException catch (error) {
          if (error.response?.statusCode != 409 || attempt == 2) rethrow;
        }
      }
    } catch (error) {
      final existing = await repository.getSyncMetadata(scopeName);
      await repository.upsertSyncMetadata(
        SyncMetadata(
          scope: scopeName,
          localGeneration: existing?.localGeneration,
          remoteGeneration: existing?.remoteGeneration,
          manifestEtag: existing?.manifestEtag,
          versionVector: existing?.versionVector ?? const {},
          dirty: true,
          lastSyncedAt: existing?.lastSyncedAt,
          error: error.toString(),
        ),
      );
      rethrow;
    }
  }

  bool _hasScopeRecords(LibrarySnapshot snapshot, WonitaSyncScope scope) {
    return switch (scope) {
      WonitaSyncScope.notes =>
        snapshot.nodes.any((node) => node.kind != NodeKind.bookmark) ||
            snapshot.tombstones.any((value) => value.scope == scope.wireName),
      WonitaSyncScope.bookmarks =>
        snapshot.nodes.any((node) => node.kind == NodeKind.bookmark) ||
            snapshot.tombstones.any((value) => value.scope == scope.wireName),
      WonitaSyncScope.subscriptions =>
        snapshot.subscriptions.isNotEmpty ||
            snapshot.tombstones.any((value) => value.scope == scope.wireName),
    };
  }

  _RemoteEnvelope _decodeRemote(WonitaSyncSnapshot? snapshot) {
    if (snapshot == null) return const _RemoteEnvelope();
    var writer = 'remote';
    var vector = <String, int>{};
    final records = <Map<String, Object?>>[];
    for (final record in snapshot.records) {
      if (record['kind'] == 'meta') {
        writer = record['writer_device_id'] as String? ?? writer;
        final rawVector = record['vector'];
        if (rawVector is Map) {
          vector = rawVector.map(
            (key, value) => MapEntry(key.toString(), (value as num).toInt()),
          );
        }
      } else {
        records.add(record);
      }
    }
    return _RemoteEnvelope(
      writerDeviceId: writer,
      vector: vector,
      records: records,
    );
  }

  List<Map<String, Object?>> _mergeRecords({
    required WonitaSyncScope scope,
    required LibrarySnapshot local,
    required _RemoteEnvelope remote,
    required _VectorRelation relation,
  }) {
    if (scope == WonitaSyncScope.subscriptions) {
      return _mergeSubscriptions(local, remote, relation);
    }
    final localNodes = <String, LibraryNode>{
      for (final node in local.nodes)
        if ((scope == WonitaSyncScope.bookmarks) ==
            (node.kind == NodeKind.bookmark))
          node.id: node,
    };
    final remoteNodes = <String, LibraryNode>{};
    for (final record in remote.records) {
      if (record['kind'] != 'node' || record['value'] is! Map) continue;
      final node = LibraryNode.fromJson(
        (record['value']! as Map).cast<String, Object?>(),
      );
      remoteNodes[node.id] = node;
    }
    final localTombstones = <String, SyncTombstone>{
      for (final value in local.tombstones)
        if (value.scope == scope.wireName) value.entityId: value,
    };
    final remoteTombstones = _remoteTombstones(remote, scope);
    final result = <String, LibraryNode>{};
    final tombstones = <String, SyncTombstone>{};
    final ids = {
      ...localNodes.keys,
      ...remoteNodes.keys,
      ...localTombstones.keys,
      ...remoteTombstones.keys,
    }.toList()..sort();
    for (final id in ids) {
      final localNode = localNodes[id];
      final remoteNode = remoteNodes[id];
      final localTombstone = localTombstones[id];
      final remoteTombstone = remoteTombstones[id];
      if (localTombstone != null || remoteTombstone != null) {
        // Permanent deletion is a delete-wins operation. In particular, a
        // stale record from an offline device can never resurrect the id.
        tombstones[id] = _mergeTombstones(localTombstone, remoteTombstone);
        continue;
      }
      if (localNode == null) {
        result[id] = remoteNode!;
      } else if (remoteNode == null) {
        result[id] = localNode;
      } else if (_sameJson(localNode.toJson(), remoteNode.toJson())) {
        result[id] = localNode;
      } else if (relation == _VectorRelation.localDominates) {
        result[id] = localNode;
      } else if (relation == _VectorRelation.remoteDominates) {
        result[id] = remoteNode;
      } else {
        final resolution = resolveNodeConflict(
          local: localNode,
          remote: remoteNode,
          localDeviceId: deviceId,
          remoteDeviceId: remote.writerDeviceId,
        );
        result[id] = resolution.winner;
        result[resolution.conflictCopy.id] = resolution.conflictCopy;
      }
    }
    for (final id in tombstones.keys) {
      result.remove(id);
    }
    return [
      for (final id in (result.keys.toList()..sort()))
        {'kind': 'node', 'value': result[id]!.toJson()},
      for (final id in (tombstones.keys.toList()..sort()))
        {'kind': 'tombstone', 'value': tombstones[id]!.toJson()},
    ];
  }

  List<Map<String, Object?>> _mergeSubscriptions(
    LibrarySnapshot local,
    _RemoteEnvelope remote,
    _VectorRelation relation,
  ) {
    final localValues = {
      for (final value in local.subscriptions) value.id: value,
    };
    final remoteValues = <String, Subscription>{};
    for (final record in remote.records) {
      if (record['kind'] != 'subscription' || record['value'] is! Map) continue;
      final value = Subscription.fromJson(
        (record['value']! as Map).cast<String, Object?>(),
      );
      remoteValues[value.id] = value;
    }
    final localTombstones = <String, SyncTombstone>{
      for (final value in local.tombstones)
        if (value.scope == WonitaSyncScope.subscriptions.wireName)
          value.entityId: value,
    };
    final remoteTombstones = _remoteTombstones(
      remote,
      WonitaSyncScope.subscriptions,
    );
    final result = <String, Subscription>{};
    final tombstones = <String, SyncTombstone>{};
    final ids = {
      ...localValues.keys,
      ...remoteValues.keys,
      ...localTombstones.keys,
      ...remoteTombstones.keys,
    }.toList()..sort();
    for (final id in ids) {
      final left = localValues[id];
      final right = remoteValues[id];
      final localTombstone = localTombstones[id];
      final remoteTombstone = remoteTombstones[id];
      if (localTombstone != null || remoteTombstone != null) {
        tombstones[id] = _mergeTombstones(localTombstone, remoteTombstone);
        continue;
      }
      if (left == null) {
        result[id] = right!;
      } else if (right == null || _sameJson(left.toJson(), right.toJson())) {
        result[id] = left;
      } else if (relation == _VectorRelation.remoteDominates) {
        result[id] = right;
      } else if (relation == _VectorRelation.localDominates) {
        result[id] = left;
      } else {
        final leftKey = '${left.updatedAt.microsecondsSinceEpoch}|$deviceId';
        final rightKey =
            '${right.updatedAt.microsecondsSinceEpoch}|${remote.writerDeviceId}';
        final winner = leftKey.compareTo(rightKey) >= 0 ? left : right;
        final loser = identical(winner, left) ? right : left;
        result[id] = winner;
        final seed = [
          'org.wonita.ideall.subscription-conflict.v1',
          jsonEncode(left.toJson()),
          jsonEncode(right.toJson()),
        ]..sort();
        final conflictId = const Uuid().v5(Namespace.url.value, seed.join('|'));
        result[conflictId] = Subscription(
          id: conflictId,
          kind: loser.kind,
          targetId: loser.targetId,
          label: '${loser.label} (conflict)',
          metadata: loser.metadata,
          enabled: loser.enabled,
          createdAt: loser.createdAt,
          updatedAt: loser.updatedAt,
          revision: 1,
        );
      }
    }
    for (final id in tombstones.keys) {
      result.remove(id);
    }
    return [
      for (final id in (result.keys.toList()..sort()))
        {'kind': 'subscription', 'value': result[id]!.toJson()},
      for (final id in (tombstones.keys.toList()..sort()))
        {'kind': 'tombstone', 'value': tombstones[id]!.toJson()},
    ];
  }

  Future<void> _importMerged(List<Map<String, Object?>> records) async {
    final nodes = <LibraryNode>[];
    final subscriptions = <Subscription>[];
    final tombstones = <SyncTombstone>[];
    for (final record in records) {
      final value = record['value'];
      if (value is! Map) continue;
      if (record['kind'] == 'node') {
        nodes.add(LibraryNode.fromJson(value.cast<String, Object?>()));
      } else if (record['kind'] == 'subscription') {
        subscriptions.add(Subscription.fromJson(value.cast<String, Object?>()));
      } else if (record['kind'] == 'tombstone') {
        tombstones.add(SyncTombstone.fromJson(value.cast<String, Object?>()));
      }
    }
    await repository.importSnapshot(
      LibrarySnapshot(
        exportedAt: DateTime.now().toUtc(),
        nodes: nodes,
        subscriptions: subscriptions,
        publicationLinks: const [],
        syncMetadata: const [],
        activity: const [],
        tombstones: tombstones,
      ),
      source: SnapshotImportSource.sync,
    );
  }
}

Map<String, SyncTombstone> _remoteTombstones(
  _RemoteEnvelope remote,
  WonitaSyncScope scope,
) {
  final result = <String, SyncTombstone>{};
  for (final record in remote.records) {
    if (record['kind'] != 'tombstone' || record['value'] is! Map) continue;
    final value = SyncTombstone.fromJson(
      (record['value']! as Map).cast<String, Object?>(),
    );
    if (value.scope != scope.wireName) {
      throw const FormatException('Sync tombstone belongs to another scope.');
    }
    final existing = result[value.entityId];
    result[value.entityId] = existing == null
        ? value
        : _mergeTombstones(existing, value);
  }
  return result;
}

SyncTombstone _mergeTombstones(SyncTombstone? left, SyncTombstone? right) {
  if (left == null) return right!;
  if (right == null) return left;
  if (left.scope != right.scope || left.entityId != right.entityId) {
    throw ArgumentError('Cannot merge tombstones for different entities.');
  }
  if (left.revision != right.revision) {
    return left.revision > right.revision ? left : right;
  }
  final time = left.deletedAt.compareTo(right.deletedAt);
  if (time != 0) return time > 0 ? left : right;
  return left;
}

enum _VectorRelation { equal, localDominates, remoteDominates, concurrent }

_VectorRelation _compareVectors(
  Map<String, int> local,
  Map<String, int> remote,
) {
  var localAhead = false;
  var remoteAhead = false;
  for (final key in {...local.keys, ...remote.keys}) {
    final left = local[key] ?? 0;
    final right = remote[key] ?? 0;
    localAhead |= left > right;
    remoteAhead |= right > left;
  }
  if (localAhead && remoteAhead) return _VectorRelation.concurrent;
  if (localAhead) return _VectorRelation.localDominates;
  if (remoteAhead) return _VectorRelation.remoteDominates;
  return _VectorRelation.equal;
}

Map<String, int> _mergeVectors(Map<String, int> left, Map<String, int> right) {
  return {
    for (final key in ({...left.keys, ...right.keys}.toList()..sort()))
      key: (left[key] ?? 0) > (right[key] ?? 0)
          ? left[key] ?? 0
          : right[key] ?? 0,
  };
}

bool _sameJson(Map<String, Object?> left, Map<String, Object?> right) =>
    jsonEncode(left) == jsonEncode(right);

final class _RemoteEnvelope {
  const _RemoteEnvelope({
    this.writerDeviceId = 'remote',
    this.vector = const {},
    this.records = const [],
  });

  final String writerDeviceId;
  final Map<String, int> vector;
  final List<Map<String, Object?>> records;
}
