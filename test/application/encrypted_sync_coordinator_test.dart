import 'package:dio/dio.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/src/application/encrypted_sync_coordinator.dart';
import 'package:ideall/src/data/data.dart';
import 'package:ideall/src/domain/domain.dart';
import 'package:ideall/src/wonita/wonita.dart';

void main() {
  test('a remote tombstone wins over a concurrent stale edit', () async {
    final server = _MemorySyncServer();
    final databaseA = IdeallDatabase.forTesting(NativeDatabase.memory());
    final databaseB = IdeallDatabase.forTesting(NativeDatabase.memory());
    addTearDown(databaseA.close);
    addTearDown(databaseB.close);
    var idA = 0;
    var idB = 0;
    final repositoryA = DriftLibraryRepository(
      databaseA,
      clock: () => DateTime.utc(2026, 8, 6, 10),
      idGenerator: () => 'a-${idA++}',
    );
    final repositoryB = DriftLibraryRepository(
      databaseB,
      clock: () => DateTime.utc(2026, 8, 6, 11),
      idGenerator: () => 'b-${idB++}',
    );
    final coordinatorA = EncryptedSyncCoordinator(
      repository: repositoryA,
      remote: WonitaSyncService(dio: server.client()),
      deviceId: 'device-a',
    );
    final coordinatorB = EncryptedSyncCoordinator(
      repository: repositoryB,
      remote: WonitaSyncService(dio: server.client()),
      deviceId: 'device-b',
    );
    final code = WonitaSyncCode.parse('00112233445566778899aabbccddeeff');

    await repositoryA.createNode(
      CreateNodeInput(id: 'note', kind: NodeKind.note, title: 'Original'),
    );
    await repositoryA.upsertSubscription(
      Subscription(
        id: 'subscription',
        kind: 'publisher',
        targetId: 'publisher-1',
        label: 'Original subscription',
        metadata: const {},
        enabled: true,
        createdAt: DateTime.utc(2026, 8, 6, 10),
        updatedAt: DateTime.utc(2026, 8, 6, 10),
        revision: 1,
      ),
    );
    await coordinatorA.syncAll(code);
    await coordinatorB.syncAll(code);
    expect((await repositoryB.getNode('note'))!.title, 'Original');
    expect(
      (await repositoryB.watchSubscriptions().first).single.label,
      'Original subscription',
    );

    await repositoryB.updateNode(id: 'note', title: 'Offline edit');
    await repositoryB.upsertSubscription(
      Subscription(
        id: 'subscription',
        kind: 'publisher',
        targetId: 'publisher-1',
        label: 'Offline subscription edit',
        metadata: const {},
        enabled: true,
        createdAt: DateTime.utc(2026, 8, 6, 10),
        updatedAt: DateTime.utc(2026, 8, 6, 11),
        revision: 2,
      ),
    );
    await repositoryA.deletePermanently('note');
    await repositoryA.removeSubscription('subscription');
    await coordinatorA.syncAll(code);

    await coordinatorB.syncAll(code);

    expect(await repositoryB.getNode('note'), isNull);
    expect(await repositoryB.watchSubscriptions().first, isEmpty);
    expect((await repositoryB.getSyncMetadata('notes'))!.dirty, isFalse);
    expect(
      (await repositoryB.getSyncMetadata('subscriptions'))!.dirty,
      isFalse,
    );
    final localTombstone = (await repositoryB.exportSnapshot()).tombstones
        .singleWhere((value) => value.entityId == 'note');
    expect(localTombstone.scope, 'notes');
    final remote = await WonitaSyncService(
      dio: server.client(),
    ).downloadSnapshot(code: code, scope: WonitaSyncScope.notes);
    expect(
      remote!.records.where((record) => record['kind'] == 'node'),
      isEmpty,
    );
    expect(
      remote.records
          .where((record) => record['kind'] == 'tombstone')
          .single['value'],
      containsPair('entity_id', 'note'),
    );
    final remoteSubscriptions = await WonitaSyncService(
      dio: server.client(),
    ).downloadSnapshot(code: code, scope: WonitaSyncScope.subscriptions);
    expect(
      remoteSubscriptions!.records.where(
        (record) => record['kind'] == 'subscription',
      ),
      isEmpty,
    );
    expect(
      remoteSubscriptions.records
          .where((record) => record['kind'] == 'tombstone')
          .single['value'],
      containsPair('entity_id', 'subscription'),
    );
  });
}

final class _MemorySyncServer {
  final Map<String, _ManifestState> _manifests = {};
  final Map<String, Map<String, Object?>> _parts = {};

  Dio client() {
    final dio = Dio(BaseOptions(baseUrl: 'https://sync.test'));
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final manifestMatch = RegExp(
            r'^/v2/app/sync/([^/]+)/manifest$',
          ).firstMatch(options.path);
          final partMatch = RegExp(
            r'^/v2/app/sync/([^/]+)/generations/([^/]+)/parts/(\d+)$',
          ).firstMatch(options.path);
          final generationMatch = RegExp(
            r'^/v2/app/sync/([^/]+)/generations/([^/]+)$',
          ).firstMatch(options.path);

          if (manifestMatch != null && options.method == 'GET') {
            final syncId = manifestMatch.group(1)!;
            final manifest = _manifests[syncId];
            if (manifest == null) {
              _reject(handler, options, 404);
            } else {
              _resolve(handler, options, manifest.toJson());
            }
            return;
          }
          if (partMatch != null && options.method == 'PUT') {
            final syncId = partMatch.group(1)!;
            final generation = partMatch.group(2)!;
            final index = int.parse(partMatch.group(3)!);
            final value = (options.data as Map).cast<String, Object?>();
            _parts[_partKey(syncId, generation, index)] = value;
            _resolve(handler, options, <String, Object?>{
              'generation': generation,
              'part_index': index,
              'ciphertext_chars': (value['ciphertext']! as String).length,
              'content_sha256': 'test-part-$index',
              'created': true,
            });
            return;
          }
          if (partMatch != null && options.method == 'GET') {
            final syncId = partMatch.group(1)!;
            final generation = partMatch.group(2)!;
            final index = int.parse(partMatch.group(3)!);
            final value = _parts[_partKey(syncId, generation, index)];
            if (value == null) {
              _reject(handler, options, 404);
            } else {
              _resolve(handler, options, <String, Object?>{
                'generation': generation,
                'part_index': index,
                ...value,
                'content_sha256': 'test-part-$index',
              });
            }
            return;
          }
          if (manifestMatch != null && options.method == 'PUT') {
            final syncId = manifestMatch.group(1)!;
            final current = _manifests[syncId];
            final expected = options.queryParameters['expected']! as int;
            if (expected != (current?.version ?? 0)) {
              _reject(handler, options, 409);
              return;
            }
            final value = (options.data as Map).cast<String, Object?>();
            final generation = value['generation']! as String;
            final partCount = value['part_count']! as int;
            final totalChars = Iterable<int>.generate(partCount)
                .map(
                  (index) =>
                      (_parts[_partKey(
                                syncId,
                                generation,
                                index,
                              )]!['ciphertext']!
                              as String)
                          .length,
                )
                .fold<int>(0, (sum, length) => sum + length);
            final next = _ManifestState(
              generation: generation,
              partCount: partCount,
              totalCiphertextChars: totalChars,
              version: (current?.version ?? 0) + 1,
            );
            _manifests[syncId] = next;
            _resolve(handler, options, next.toJson());
            return;
          }
          if (generationMatch != null && options.method == 'DELETE') {
            _resolve(handler, options, const <String, Object?>{});
            return;
          }
          _reject(handler, options, 404);
        },
      ),
    );
    return dio;
  }

  static String _partKey(String syncId, String generation, int index) =>
      '$syncId/$generation/$index';

  static void _resolve(
    RequestInterceptorHandler handler,
    RequestOptions options,
    Object? value,
  ) {
    handler.resolve(
      Response<Object?>(
        requestOptions: options,
        statusCode: 200,
        data: <String, Object?>{'data': value},
      ),
    );
  }

  static void _reject(
    RequestInterceptorHandler handler,
    RequestOptions options,
    int statusCode,
  ) {
    handler.reject(
      DioException(
        requestOptions: options,
        response: Response<Object?>(
          requestOptions: options,
          statusCode: statusCode,
        ),
      ),
    );
  }
}

final class _ManifestState {
  const _ManifestState({
    required this.generation,
    required this.partCount,
    required this.totalCiphertextChars,
    required this.version,
  });

  final String generation;
  final int partCount;
  final int totalCiphertextChars;
  final int version;

  Map<String, Object?> toJson() => <String, Object?>{
    'generation': generation,
    'part_count': partCount,
    'total_ciphertext_chars': totalCiphertextChars,
    'parts_sha256': 'test-manifest',
    'version': version,
    'updated_at_ms': 1786000000000,
  };
}
