import 'dart:convert';

import 'package:uuid/uuid.dart';

import 'models.dart';

/// A deterministic, lossless result for two concurrent versions of a node.
///
/// The winning value remains at the stable node id. The losing value is copied
/// to a UUID-v5 derived from both versions so that every device independently
/// creates the same conflict copy and duplicate sync rounds remain idempotent.
final class NodeConflictResolution {
  const NodeConflictResolution({
    required this.winner,
    required this.conflictCopy,
  });

  final LibraryNode winner;
  final LibraryNode conflictCopy;
}

NodeConflictResolution resolveNodeConflict({
  required LibraryNode local,
  required LibraryNode remote,
  required String localDeviceId,
  required String remoteDeviceId,
}) {
  if (local.id != remote.id) {
    throw ArgumentError('Concurrent nodes must share the same stable id.');
  }

  final localKey = _orderingKey(local, localDeviceId);
  final remoteKey = _orderingKey(remote, remoteDeviceId);
  final localWins = localKey.compareTo(remoteKey) >= 0;
  final winner = localWins ? local : remote;
  final loser = localWins ? remote : local;
  final loserDevice = localWins ? remoteDeviceId : localDeviceId;
  final versions = [
    '${_canonicalNode(local)}|$localDeviceId',
    '${_canonicalNode(remote)}|$remoteDeviceId',
  ]..sort();
  final conflictSeed = [
    'org.wonita.ideall.conflict-copy.v1',
    local.id,
    ...versions,
  ].join('|');
  final conflictId = const Uuid().v5(Namespace.url.value, conflictSeed);
  final label = loserDevice.trim().isEmpty
      ? 'unknown'
      : loserDevice.trim().substring(0, loserDevice.trim().length.clamp(0, 8));
  final conflictTitle = '${loser.title} (conflict $label)';
  final resolvedAt = local.updatedAt.isAfter(remote.updatedAt)
      ? local.updatedAt
      : remote.updatedAt;

  return NodeConflictResolution(
    winner: winner,
    conflictCopy: loser.copyWith(
      id: conflictId,
      title: conflictTitle,
      createdAt: resolvedAt,
      updatedAt: resolvedAt,
      clearDeletedAt: loser.status != NodeStatus.trashed,
      revision: 1,
    ),
  );
}

String _orderingKey(LibraryNode node, String deviceId) => [
  node.updatedAt.microsecondsSinceEpoch.toString().padLeft(20, '0'),
  node.revision.toString().padLeft(12, '0'),
  _canonicalNode(node),
  deviceId,
].join('|');

String _canonicalNode(LibraryNode node) {
  final value = node.toJson();
  return jsonEncode(_canonicalize(value));
}

Object? _canonicalize(Object? value) {
  if (value is Map) {
    final keys = value.keys.map((key) => key.toString()).toList()..sort();
    return <String, Object?>{
      for (final key in keys) key: _canonicalize(value[key]),
    };
  }
  if (value is List) return value.map(_canonicalize).toList();
  return value;
}
