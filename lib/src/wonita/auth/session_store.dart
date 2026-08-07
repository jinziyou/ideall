import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../json.dart';
import 'auth_models.dart';

abstract interface class WonitaSessionStore {
  Future<WonitaSession?> read();

  Future<void> write(WonitaSession session);

  Future<void> clear();
}

/// Stores the complete session as one encrypted JSON envelope.
final class SecureWonitaSessionStore implements WonitaSessionStore {
  SecureWonitaSessionStore({
    FlutterSecureStorage? storage,
    this.storageKey = 'org.wonita.ideall.session.v1',
  }) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  final String storageKey;

  @override
  Future<WonitaSession?> read() async {
    final value = await _storage.read(key: storageKey);
    if (value == null || value.isEmpty) return null;
    try {
      return WonitaSession.fromJson(jsonMap(jsonDecode(value)));
    } on FormatException {
      // A partial/corrupt credential must never be used. Removing only this
      // new namespaced key leaves every ideall2 credential and database alone.
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(WonitaSession session) =>
      _storage.write(key: storageKey, value: jsonEncode(session.toJson()));

  @override
  Future<void> clear() => _storage.delete(key: storageKey);
}

/// Lightweight store for tests and dependency-injected previews.
final class MemoryWonitaSessionStore implements WonitaSessionStore {
  MemoryWonitaSessionStore([this.value]);

  WonitaSession? value;

  @override
  Future<void> clear() async => value = null;

  @override
  Future<WonitaSession?> read() async => value;

  @override
  Future<void> write(WonitaSession session) async => value = session;
}
