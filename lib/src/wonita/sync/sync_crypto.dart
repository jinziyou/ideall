import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import '../auth/auth_crypto.dart' show hexDecode, hexEncode;
import 'sync_models.dart';

final class WonitaSyncCode {
  WonitaSyncCode._(this.value, Uint8List bytes)
    : _bytes = Uint8List.fromList(bytes);

  factory WonitaSyncCode.parse(String value) {
    final normalized = value.trim().toLowerCase();
    if (!RegExp(r'^[0-9a-f]{32}$').hasMatch(normalized)) {
      throw const FormatException(
        'Sync code must be exactly 32 hexadecimal characters',
      );
    }
    return WonitaSyncCode._(normalized, hexDecode(normalized));
  }

  factory WonitaSyncCode.generate() =>
      WonitaSyncCode.parse(hexEncode(_secureRandomBytes(16)));

  final String value;
  final Uint8List _bytes;

  @override
  String toString() => 'WonitaSyncCode(••••)';
}

final class WonitaDerivedSyncKeys {
  const WonitaDerivedSyncKeys({
    required this.syncId,
    required this.encryptionKey,
  });

  final String syncId;
  final SecretKey encryptionKey;
}

/// Client-side crypto for the ideall-only sync namespace.
final class WonitaSyncCrypto {
  WonitaSyncCrypto({Hkdf? hkdf, AesGcm? cipher})
    : _hkdf = hkdf ?? Hkdf(hmac: Hmac.sha256(), outputLength: 32),
      _cipher = cipher ?? AesGcm.with256bits();

  static const String namespace = 'ideall-sync-v1';
  static const int schemaVersion = 1;
  static const int aesGcmTagBytes = 16;

  final Hkdf _hkdf;
  final AesGcm _cipher;

  Future<WonitaDerivedSyncKeys> deriveKeys(
    WonitaSyncCode code,
    WonitaSyncScope scope,
  ) async {
    final source = SecretKey(code._bytes);
    final salt = utf8.encode(namespace);
    final idKey = await _hkdf.deriveKey(
      secretKey: source,
      nonce: salt,
      info: utf8.encode('ideall-sync-${scope.wireName}-id-v1'),
    );
    final encryptionKey = await _hkdf.deriveKey(
      secretKey: source,
      nonce: salt,
      info: utf8.encode('ideall-sync-${scope.wireName}-enc-v1'),
    );
    return WonitaDerivedSyncKeys(
      syncId: hexEncode(await idKey.extractBytes()),
      encryptionKey: encryptionKey,
    );
  }

  List<int> associatedData({
    required WonitaSyncScope scope,
    required String generation,
    required int partIndex,
  }) {
    _validateGeneration(generation);
    if (partIndex < 0) {
      throw ArgumentError.value(partIndex, 'partIndex', 'must be non-negative');
    }
    return utf8.encode(
      '$namespace\u0000schema=$schemaVersion\u0000scope=${scope.wireName}'
      '\u0000generation=$generation\u0000part=$partIndex',
    );
  }

  Future<WonitaEncryptedSyncPart> encryptPart({
    required List<int> cleartext,
    required SecretKey encryptionKey,
    required WonitaSyncScope scope,
    required String generation,
    required int partIndex,
    List<int>? nonce,
  }) async {
    final actualNonce = nonce ?? _cipher.newNonce();
    if (actualNonce.length != 12) {
      throw ArgumentError.value(nonce, 'nonce', 'must be exactly 12 bytes');
    }
    final box = await _cipher.encrypt(
      cleartext,
      secretKey: encryptionKey,
      nonce: actualNonce,
      aad: associatedData(
        scope: scope,
        generation: generation,
        partIndex: partIndex,
      ),
    );
    return WonitaEncryptedSyncPart(
      iv: base64.encode(box.nonce),
      // The backend contract stores ciphertext and the GCM tag in one Base64
      // value; cryptography exposes them separately.
      ciphertext: base64.encode(<int>[...box.cipherText, ...box.mac.bytes]),
    );
  }

  Future<Uint8List> decryptPart({
    required WonitaEncryptedSyncPart encrypted,
    required SecretKey encryptionKey,
    required WonitaSyncScope scope,
    required String generation,
    required int partIndex,
  }) async {
    final nonce = _canonicalBase64Decode(encrypted.iv, 'iv');
    if (nonce.length != 12) {
      throw const FormatException('Encrypted sync IV must be 12 bytes');
    }
    final sealed = _canonicalBase64Decode(encrypted.ciphertext, 'ciphertext');
    if (sealed.length < aesGcmTagBytes) {
      throw const FormatException('Encrypted sync part is missing its GCM tag');
    }
    final tagOffset = sealed.length - aesGcmTagBytes;
    final box = SecretBox(
      sealed.sublist(0, tagOffset),
      nonce: nonce,
      mac: Mac(sealed.sublist(tagOffset)),
    );
    final cleartext = await _cipher.decrypt(
      box,
      secretKey: encryptionKey,
      aad: associatedData(
        scope: scope,
        generation: generation,
        partIndex: partIndex,
      ),
    );
    return Uint8List.fromList(cleartext);
  }

  String newGeneration() => hexEncode(_secureRandomBytes(16));

  static void _validateGeneration(String value) {
    if (!RegExp(r'^[0-9a-f]{32}$').hasMatch(value)) {
      throw const FormatException('Sync generation must be lowercase 32-hex');
    }
  }

  static Uint8List _canonicalBase64Decode(String value, String name) {
    try {
      final decoded = base64.decode(value);
      if (base64.encode(decoded) != value) {
        throw FormatException('$name must be canonical standard Base64');
      }
      return decoded;
    } on FormatException {
      throw FormatException('$name must be canonical standard Base64');
    }
  }
}

Uint8List _secureRandomBytes(int length) {
  final random = Random.secure();
  return Uint8List.fromList(
    List<int>.generate(length, (_) => random.nextInt(256), growable: false),
  );
}
