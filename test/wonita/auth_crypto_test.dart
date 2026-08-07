import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/src/wonita/wonita.dart';

void main() {
  test(
    'auth payload is nonce || ciphertext || tag using the raw X25519 key',
    () async {
      final exchange = X25519();
      final serverPair = await exchange.newKeyPair();
      final serverPublic = await serverPair.extractPublicKey();
      final crypto = WonitaAuthCrypto(keyExchange: exchange);
      final client = await crypto.newKeyPair();
      final nonce = List<int>.generate(24, (index) => index);

      final encoded = await crypto.encryptPassword(
        clientKeyPair: client.keyPair,
        serverPublicKeyHex: hexEncode(serverPublic.bytes),
        password: 'correct horse battery staple',
        nonce: nonce,
      );
      final wire = hexDecode(encoded);
      expect(wire.sublist(0, 24), nonce);

      final clientPublic = await client.keyPair.extractPublicKey();
      final shared = await exchange.sharedSecretKey(
        keyPair: serverPair,
        remotePublicKey: clientPublic,
      );
      final box = SecretBox(
        wire.sublist(24, wire.length - 16),
        nonce: wire.sublist(0, 24),
        mac: Mac(wire.sublist(wire.length - 16)),
      );
      final cleartext = await Xchacha20.poly1305Aead().decrypt(
        box,
        secretKey: shared,
      );
      expect(utf8.decode(cleartext), 'correct horse battery staple');
    },
  );

  test('hex decoder fails closed instead of silently inserting zeroes', () {
    expect(() => hexDecode('abc'), throwsFormatException);
    expect(() => hexDecode('zz'), throwsFormatException);
    expect(hexEncode(hexDecode('00aBff')), '00abff');
  });

  test(
    'session envelope round-trips access and rotating refresh together',
    () async {
      final session = WonitaSession.fromTokens(
        const WonitaAuthTokens(
          accessToken: 'access',
          tokenType: 'Bearer',
          expiresInSeconds: 60,
          refreshToken: 'wnt_ref_secret',
          refreshExpiresInSeconds: 3600,
        ),
        now: DateTime.fromMillisecondsSinceEpoch(1000),
      );
      final decoded = WonitaSession.fromJson(session.toJson());
      expect(decoded.accessToken, 'access');
      expect(decoded.accessExpiresAtMs, 61000);
      expect(decoded.refreshToken, 'wnt_ref_secret');
      expect(decoded.refreshExpiresAtMs, 3601000);

      final store = MemoryWonitaSessionStore();
      await store.write(decoded);
      expect((await store.read())?.refreshToken, 'wnt_ref_secret');
      await store.clear();
      expect(await store.read(), isNull);
    },
  );
}
