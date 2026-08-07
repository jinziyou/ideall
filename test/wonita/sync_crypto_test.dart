import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/src/wonita/wonita.dart';

void main() {
  const generation = '0123456789abcdef0123456789abcdef';

  test(
    'HKDF namespace is deterministic and isolated by scope and purpose',
    () async {
      final crypto = WonitaSyncCrypto();
      final code = WonitaSyncCode.parse('00112233445566778899aabbccddeeff');
      final notes1 = await crypto.deriveKeys(code, WonitaSyncScope.notes);
      final notes2 = await crypto.deriveKeys(code, WonitaSyncScope.notes);
      final bookmarks = await crypto.deriveKeys(
        code,
        WonitaSyncScope.bookmarks,
      );

      expect(notes1.syncId, notes2.syncId);
      expect(notes1.syncId, matches(RegExp(r'^[0-9a-f]{64}$')));
      expect(notes1.syncId, isNot(bookmarks.syncId));
      expect(
        await notes1.encryptionKey.extractBytes(),
        await notes2.encryptionKey.extractBytes(),
      );
      expect(
        await notes1.encryptionKey.extractBytes(),
        isNot(await bookmarks.encryptionKey.extractBytes()),
      );
      expect(
        notes1.syncId,
        isNot(hexEncode(await notes1.encryptionKey.extractBytes())),
      );
      expect(code.toString(), isNot(contains(code.value)));
    },
  );

  test(
    'AES-GCM part round-trips with canonical 12-byte IV wire format',
    () async {
      final crypto = WonitaSyncCrypto();
      final keys = await crypto.deriveKeys(
        WonitaSyncCode.parse('00112233445566778899aabbccddeeff'),
        WonitaSyncScope.notes,
      );
      final encrypted = await crypto.encryptPart(
        cleartext: utf8.encode('hello, encrypted sync'),
        encryptionKey: keys.encryptionKey,
        scope: WonitaSyncScope.notes,
        generation: generation,
        partIndex: 2,
        nonce: List<int>.generate(12, (index) => index + 1),
      );

      expect(base64.decode(encrypted.iv).length, 12);
      expect(base64.encode(base64.decode(encrypted.iv)), encrypted.iv);
      expect(
        base64.encode(base64.decode(encrypted.ciphertext)),
        encrypted.ciphertext,
      );
      expect(
        utf8.decode(
          await crypto.decryptPart(
            encrypted: encrypted,
            encryptionKey: keys.encryptionKey,
            scope: WonitaSyncScope.notes,
            generation: generation,
            partIndex: 2,
          ),
        ),
        'hello, encrypted sync',
      );

      await expectLater(
        crypto.decryptPart(
          encrypted: encrypted,
          encryptionKey: keys.encryptionKey,
          scope: WonitaSyncScope.notes,
          generation: generation,
          partIndex: 3,
        ),
        throwsA(isA<SecretBoxAuthenticationError>()),
      );
    },
  );

  test('AAD binds schema, scope, generation, and part', () {
    final aad = utf8.decode(
      WonitaSyncCrypto().associatedData(
        scope: WonitaSyncScope.subscriptions,
        generation: generation,
        partIndex: 9,
      ),
    );
    expect(aad, startsWith('ideall-sync-v1\u0000schema=1'));
    expect(aad, contains('\u0000scope=subscriptions'));
    expect(aad, contains('\u0000generation=$generation'));
    expect(aad, endsWith('\u0000part=9'));
  });

  test('snapshot is JSON-only and validates its scope', () {
    final snapshot = WonitaSyncSnapshot(
      scope: WonitaSyncScope.bookmarks,
      exportedAtMs: 123,
      records: <Map<String, Object?>>[
        <String, Object?>{'id': 'bookmark-1', 'url': 'https://example.com'},
      ],
    );
    final decoded = WonitaSyncSnapshot.fromBytes(snapshot.toBytes());
    expect(decoded.scope, WonitaSyncScope.bookmarks);
    expect(decoded.exportedAtMs, 123);
    expect(decoded.records.single['id'], 'bookmark-1');
  });
}
