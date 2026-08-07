import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../api_envelope.dart';
import '../api_paths.dart';
import '../json.dart';
import 'sync_crypto.dart';
import 'sync_models.dart';

/// Authenticated partitioned snapshot transport.
///
/// Parts are uploaded to a fresh immutable generation. Only after every part
/// succeeds is the manifest changed with compare-and-swap, so readers never
/// observe half an upload.
final class WonitaSyncService {
  WonitaSyncService({required this.dio, WonitaSyncCrypto? crypto})
    : crypto = crypto ?? WonitaSyncCrypto();

  /// Safely below the server's 262,144-character Base64 ceiling after adding
  /// the 16-byte GCM tag. Callers may lower it for constrained connections.
  static const int defaultPartPlaintextBytes = 180 * 1024;

  final Dio dio;
  final WonitaSyncCrypto crypto;

  Future<WonitaSyncProtocolLimits> limits() async {
    final response = await dio.get<Object?>(WonitaApiPaths.syncLimits);
    return decodeWonitaData(
      response,
      (value) => WonitaSyncProtocolLimits.fromJson(
        jsonMap(value, context: 'sync limits'),
      ),
    );
  }

  Future<WonitaSyncManifest> manifest({
    required WonitaSyncCode code,
    required WonitaSyncScope scope,
  }) async {
    final keys = await crypto.deriveKeys(code, scope);
    return _manifest(keys.syncId);
  }

  Future<WonitaSyncUploadResult> uploadSnapshot({
    required WonitaSyncCode code,
    required WonitaSyncSnapshot snapshot,
    required int expectedVersion,
    int partPlaintextBytes = defaultPartPlaintextBytes,
  }) {
    return uploadPayload(
      code: code,
      scope: snapshot.scope,
      payload: snapshot.toBytes(),
      expectedVersion: expectedVersion,
      partPlaintextBytes: partPlaintextBytes,
    );
  }

  Future<WonitaSyncUploadResult> uploadPayload({
    required WonitaSyncCode code,
    required WonitaSyncScope scope,
    required List<int> payload,
    required int expectedVersion,
    int partPlaintextBytes = defaultPartPlaintextBytes,
  }) async {
    if (expectedVersion < 0) {
      throw ArgumentError.value(
        expectedVersion,
        'expectedVersion',
        'must be non-negative',
      );
    }
    if (partPlaintextBytes <= 0 ||
        partPlaintextBytes > defaultPartPlaintextBytes) {
      throw ArgumentError.value(
        partPlaintextBytes,
        'partPlaintextBytes',
        'must be between 1 and $defaultPartPlaintextBytes',
      );
    }

    final keys = await crypto.deriveKeys(code, scope);
    final generation = crypto.newGeneration();
    final parts = _partition(payload, partPlaintextBytes);
    var committed = false;
    try {
      for (var index = 0; index < parts.length; index++) {
        final encrypted = await crypto.encryptPart(
          cleartext: parts[index],
          encryptionKey: keys.encryptionKey,
          scope: scope,
          generation: generation,
          partIndex: index,
        );
        final response = await dio.put<Object?>(
          WonitaApiPaths.syncPart(keys.syncId, generation, index),
          data: encrypted.toJson(),
        );
        final receipt = decodeWonitaData(
          response,
          (value) => WonitaSyncPartReceipt.fromJson(
            jsonMap(value, context: 'sync part receipt'),
          ),
        );
        if (receipt.generation != generation || receipt.partIndex != index) {
          throw const FormatException(
            'Wonita acknowledged the wrong sync part',
          );
        }
      }

      final response = await dio.put<Object?>(
        WonitaApiPaths.syncManifest(keys.syncId),
        queryParameters: <String, Object?>{'expected': expectedVersion},
        data: <String, Object?>{
          'generation': generation,
          'part_count': parts.length,
        },
      );
      final result = decodeWonitaData(
        response,
        (value) => WonitaSyncManifest.fromJson(
          jsonMap(value, context: 'sync manifest'),
        ),
      );
      committed = true;
      return WonitaSyncUploadResult(
        scope: scope,
        syncId: keys.syncId,
        manifest: result,
      );
    } finally {
      if (!committed) {
        // Best effort only: cleanup must not replace the upload/CAS error.
        try {
          await discardGeneration(syncId: keys.syncId, generation: generation);
        } on Object {
          // The server also expires abandoned generations after its staged TTL.
        }
      }
    }
  }

  Future<WonitaSyncDownload?> download({
    required WonitaSyncCode code,
    required WonitaSyncScope scope,
  }) async {
    final keys = await crypto.deriveKeys(code, scope);
    late final WonitaSyncManifest current;
    try {
      current = await _manifest(keys.syncId);
    } on DioException catch (error) {
      if (error.response?.statusCode == 404) return null;
      rethrow;
    }
    if (current.partCount <= 0) {
      throw const FormatException('Wonita sync manifest has no parts');
    }

    final output = BytesBuilder(copy: false);
    for (var index = 0; index < current.partCount; index++) {
      final response = await dio.get<Object?>(
        WonitaApiPaths.syncPart(keys.syncId, current.generation, index),
      );
      final part = decodeWonitaData(
        response,
        (value) => WonitaSyncGenerationPart.fromJson(
          jsonMap(value, context: 'sync generation part'),
        ),
      );
      if (part.generation != current.generation || part.partIndex != index) {
        throw const FormatException('Wonita returned the wrong sync part');
      }
      output.add(
        await crypto.decryptPart(
          encrypted: part.encrypted,
          encryptionKey: keys.encryptionKey,
          scope: scope,
          generation: current.generation,
          partIndex: index,
        ),
      );
    }
    return WonitaSyncDownload(
      scope: scope,
      syncId: keys.syncId,
      manifest: current,
      payload: output.takeBytes(),
    );
  }

  Future<WonitaSyncSnapshot?> downloadSnapshot({
    required WonitaSyncCode code,
    required WonitaSyncScope scope,
  }) async {
    final result = await download(code: code, scope: scope);
    if (result == null) return null;
    final snapshot = WonitaSyncSnapshot.fromBytes(result.payload);
    if (snapshot.scope != scope) {
      throw const FormatException(
        'Decrypted sync snapshot has the wrong scope',
      );
    }
    return snapshot;
  }

  Future<void> discardGeneration({
    required String syncId,
    required String generation,
  }) async {
    await dio.delete<Object?>(
      WonitaApiPaths.syncGeneration(syncId, generation),
    );
  }

  Future<WonitaSyncManifest> _manifest(String syncId) async {
    final response = await dio.get<Object?>(
      WonitaApiPaths.syncManifest(syncId),
    );
    return decodeWonitaData(
      response,
      (value) =>
          WonitaSyncManifest.fromJson(jsonMap(value, context: 'sync manifest')),
    );
  }

  static List<Uint8List> _partition(List<int> input, int partBytes) {
    if (input.isEmpty) return <Uint8List>[Uint8List(0)];
    final result = <Uint8List>[];
    for (var offset = 0; offset < input.length; offset += partBytes) {
      final candidate = offset + partBytes;
      final end = candidate < input.length ? candidate : input.length;
      result.add(Uint8List.fromList(input.sublist(offset, end)));
    }
    return result;
  }
}
