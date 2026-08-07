import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import 'auth_models.dart';

final class WonitaClientKeyPair {
  const WonitaClientKeyPair({
    required this.keyPair,
    required this.publicKeyHex,
  });

  final SimpleKeyPair keyPair;
  final String publicKeyHex;
}

/// Implements Wonita's login wire format exactly:
/// X25519 followed by XChaCha20-Poly1305 using the raw 32-byte shared secret.
final class WonitaAuthCrypto {
  WonitaAuthCrypto({X25519? keyExchange, Xchacha20? cipher})
    : _keyExchange = keyExchange ?? X25519(),
      _cipher = cipher ?? Xchacha20.poly1305Aead();

  final X25519 _keyExchange;
  final Xchacha20 _cipher;

  String newClientId() => hexEncode(_secureRandomBytes(16));

  Future<WonitaClientKeyPair> newKeyPair() async {
    final keyPair = await _keyExchange.newKeyPair();
    final publicKey = await keyPair.extractPublicKey();
    return WonitaClientKeyPair(
      keyPair: keyPair,
      publicKeyHex: hexEncode(publicKey.bytes),
    );
  }

  Future<String> encryptPassword({
    required SimpleKeyPair clientKeyPair,
    required String serverPublicKeyHex,
    required String password,
    List<int>? nonce,
  }) async {
    final serverBytes = hexDecode(serverPublicKeyHex);
    if (serverBytes.length != 32) {
      throw const FormatException('Wonita server public key must be 32 bytes');
    }
    final actualNonce = nonce ?? _cipher.newNonce();
    if (actualNonce.length != 24) {
      throw ArgumentError.value(nonce, 'nonce', 'must be exactly 24 bytes');
    }
    final sharedSecret = await _keyExchange.sharedSecretKey(
      keyPair: clientKeyPair,
      remotePublicKey: SimplePublicKey(serverBytes, type: KeyPairType.x25519),
    );
    final box = await _cipher.encrypt(
      utf8.encode(password),
      secretKey: sharedSecret,
      nonce: actualNonce,
    );
    // cryptography keeps the tag separate; Wonita expects nonce || cipher ||
    // Poly1305 tag, all lowercase hexadecimal.
    return hexEncode(<int>[...box.nonce, ...box.cipherText, ...box.mac.bytes]);
  }

  Future<WonitaAuthCredentials> credentials({
    required String email,
    required String password,
    required String serverPublicKeyHex,
    required String clientId,
    required WonitaClientKeyPair clientKeyPair,
  }) async => WonitaAuthCredentials(
    clientId: clientId,
    clientSecret: clientKeyPair.publicKeyHex,
    email: email,
    encryptedPassword: await encryptPassword(
      clientKeyPair: clientKeyPair.keyPair,
      serverPublicKeyHex: serverPublicKeyHex,
      password: password,
    ),
  );
}

String hexEncode(Iterable<int> bytes) =>
    bytes.map((byte) => (byte & 0xff).toRadixString(16).padLeft(2, '0')).join();

Uint8List hexDecode(String value) {
  final clean = value.trim();
  if (clean.length.isOdd || !RegExp(r'^[0-9a-fA-F]*$').hasMatch(clean)) {
    throw const FormatException('Invalid hexadecimal string');
  }
  final result = Uint8List(clean.length ~/ 2);
  for (var index = 0; index < result.length; index++) {
    result[index] = int.parse(
      clean.substring(index * 2, index * 2 + 2),
      radix: 16,
    );
  }
  return result;
}

Uint8List _secureRandomBytes(int length) {
  final random = Random.secure();
  return Uint8List.fromList(
    List<int>.generate(length, (_) => random.nextInt(256), growable: false),
  );
}
