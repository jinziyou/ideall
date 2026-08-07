import 'dart:convert';
import 'dart:typed_data';

import '../json.dart';

enum WonitaSyncScope {
  notes('notes'),
  bookmarks('bookmarks'),
  subscriptions('subscriptions');

  const WonitaSyncScope(this.wireName);
  final String wireName;

  static WonitaSyncScope parse(String value) => values.firstWhere(
    (scope) => scope.wireName == value,
    orElse: () => throw FormatException('Unknown sync scope: $value'),
  );
}

final class WonitaSyncProtocolLimits {
  const WonitaSyncProtocolLimits({
    required this.maxRequestsPerMinute,
    required this.stagedGenerationIdleTtlMs,
    required this.maxSyncIdsPerAccount,
    required this.maxStagedGenerationsPerSync,
    required this.maxPartsPerGeneration,
    required this.maxPartCiphertextChars,
    required this.maxGenerationCiphertextChars,
    required this.maxAccountCiphertextChars,
  });

  factory WonitaSyncProtocolLimits.fromJson(
    JsonMap json,
  ) => WonitaSyncProtocolLimits(
    maxRequestsPerMinute: jsonInt(json, 'max_requests_per_minute'),
    stagedGenerationIdleTtlMs: jsonInt(json, 'staged_generation_idle_ttl_ms'),
    maxSyncIdsPerAccount: jsonInt(json, 'max_sync_ids_per_account'),
    maxStagedGenerationsPerSync: jsonInt(
      json,
      'max_staged_generations_per_sync',
    ),
    maxPartsPerGeneration: jsonInt(json, 'max_parts_per_generation'),
    maxPartCiphertextChars: jsonInt(json, 'max_part_ciphertext_chars'),
    maxGenerationCiphertextChars: jsonInt(
      json,
      'max_generation_ciphertext_chars',
    ),
    maxAccountCiphertextChars: jsonInt(json, 'max_account_ciphertext_chars'),
  );

  final int maxRequestsPerMinute;
  final int stagedGenerationIdleTtlMs;
  final int maxSyncIdsPerAccount;
  final int maxStagedGenerationsPerSync;
  final int maxPartsPerGeneration;
  final int maxPartCiphertextChars;
  final int maxGenerationCiphertextChars;
  final int maxAccountCiphertextChars;
}

final class WonitaEncryptedSyncPart {
  const WonitaEncryptedSyncPart({required this.iv, required this.ciphertext});

  factory WonitaEncryptedSyncPart.fromJson(JsonMap json) =>
      WonitaEncryptedSyncPart(
        iv: jsonString(json, 'iv'),
        ciphertext: jsonString(json, 'ciphertext'),
      );

  final String iv;
  final String ciphertext;

  JsonMap toJson() => {'iv': iv, 'ciphertext': ciphertext};
}

final class WonitaSyncPartReceipt {
  const WonitaSyncPartReceipt({
    required this.generation,
    required this.partIndex,
    required this.ciphertextChars,
    required this.contentSha256,
    required this.created,
  });

  factory WonitaSyncPartReceipt.fromJson(JsonMap json) => WonitaSyncPartReceipt(
    generation: jsonString(json, 'generation'),
    partIndex: jsonInt(json, 'part_index'),
    ciphertextChars: jsonInt(json, 'ciphertext_chars'),
    contentSha256: jsonString(json, 'content_sha256'),
    created: jsonBool(json, 'created'),
  );

  final String generation;
  final int partIndex;
  final int ciphertextChars;
  final String contentSha256;
  final bool created;
}

final class WonitaSyncGenerationPart {
  const WonitaSyncGenerationPart({
    required this.generation,
    required this.partIndex,
    required this.encrypted,
    required this.contentSha256,
  });

  factory WonitaSyncGenerationPart.fromJson(JsonMap json) =>
      WonitaSyncGenerationPart(
        generation: jsonString(json, 'generation'),
        partIndex: jsonInt(json, 'part_index'),
        encrypted: WonitaEncryptedSyncPart.fromJson(json),
        contentSha256: jsonString(json, 'content_sha256'),
      );

  final String generation;
  final int partIndex;
  final WonitaEncryptedSyncPart encrypted;
  final String contentSha256;
}

final class WonitaSyncManifest {
  const WonitaSyncManifest({
    required this.generation,
    required this.partCount,
    required this.totalCiphertextChars,
    required this.partsSha256,
    required this.version,
    required this.updatedAtMs,
  });

  factory WonitaSyncManifest.fromJson(JsonMap json) => WonitaSyncManifest(
    generation: jsonString(json, 'generation'),
    partCount: jsonInt(json, 'part_count'),
    totalCiphertextChars: jsonInt(json, 'total_ciphertext_chars'),
    partsSha256: jsonString(json, 'parts_sha256'),
    version: jsonInt(json, 'version'),
    updatedAtMs: jsonInt(json, 'updated_at_ms'),
  );

  final String generation;
  final int partCount;
  final int totalCiphertextChars;
  final String partsSha256;
  final int version;
  final int updatedAtMs;
}

final class WonitaSyncUploadResult {
  const WonitaSyncUploadResult({
    required this.scope,
    required this.syncId,
    required this.manifest,
  });

  final WonitaSyncScope scope;
  final String syncId;
  final WonitaSyncManifest manifest;
}

final class WonitaSyncDownload {
  const WonitaSyncDownload({
    required this.scope,
    required this.syncId,
    required this.manifest,
    required this.payload,
  });

  final WonitaSyncScope scope;
  final String syncId;
  final WonitaSyncManifest manifest;
  final Uint8List payload;
}

/// Versioned, JSON-only snapshot format used above the encrypted transport.
/// It intentionally has no attachment or arbitrary-file representation.
final class WonitaSyncSnapshot {
  WonitaSyncSnapshot({
    required this.scope,
    required this.exportedAtMs,
    required List<JsonMap> records,
  }) : records = List<JsonMap>.unmodifiable(
         records.map((record) => Map<String, Object?>.unmodifiable(record)),
       );

  static const int schemaVersion = 1;

  factory WonitaSyncSnapshot.fromBytes(List<int> bytes) {
    final json = jsonMap(
      jsonDecode(utf8.decode(bytes)),
      context: 'sync snapshot',
    );
    final schema = jsonInt(json, 'schema');
    if (schema != schemaVersion) {
      throw FormatException('Unsupported sync snapshot schema: $schema');
    }
    return WonitaSyncSnapshot(
      scope: WonitaSyncScope.parse(jsonString(json, 'scope')),
      exportedAtMs: jsonInt(json, 'exported_at_ms'),
      records: jsonList(json['records'], context: 'sync snapshot records')
          .map((record) => jsonMap(record, context: 'sync record'))
          .toList(growable: false),
    );
  }

  final WonitaSyncScope scope;
  final int exportedAtMs;
  final List<JsonMap> records;

  Uint8List toBytes() => Uint8List.fromList(
    utf8.encode(
      jsonEncode(<String, Object?>{
        'schema': schemaVersion,
        'scope': scope.wireName,
        'exported_at_ms': exportedAtMs,
        'records': records,
      }),
    ),
  );
}
