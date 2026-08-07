import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/src/wonita/wonita.dart';

void main() {
  test('concurrent refresh calls share one rotating-token request', () async {
    final adapter = _RefreshAdapter();
    final refreshDio = Dio()..httpClientAdapter = adapter;
    final store = MemoryWonitaSessionStore(
      const WonitaSession(
        accessToken: 'old-access',
        tokenType: 'Bearer',
        createdAtMs: 0,
        accessExpiresAtMs: 1000,
        refreshToken: 'old-refresh',
        refreshExpiresAtMs: 100000,
      ),
    );
    final client = WonitaClient(
      baseUri: Uri.parse('https://api.example.test'),
      sessionStore: store,
      dio: Dio(),
      refreshDio: refreshDio,
      clock: () => DateTime.fromMillisecondsSinceEpoch(10),
    );

    final first = client.refreshSession();
    final second = client.refreshSession();
    final sessions = await Future.wait(<Future<WonitaSession>>[first, second]);

    expect(adapter.calls, 1);
    expect(adapter.seenRefreshToken, 'old-refresh');
    expect(sessions[0].accessToken, 'new-access');
    expect(identical(sessions[0], sessions[1]), isTrue);
    expect((await store.read())?.refreshToken, 'new-refresh');
  });
}

final class _RefreshAdapter implements HttpClientAdapter {
  int calls = 0;
  String? seenRefreshToken;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls++;
    expect(options.path, WonitaApiPaths.authRefresh);
    seenRefreshToken =
        (options.data as Map<String, Object?>)['refresh_token'] as String?;
    return ResponseBody.fromString(
      jsonEncode(<String, Object?>{
        'data': <String, Object?>{
          'token': 'new-access',
          'token_type': 'Bearer',
          'expires_in_secs': 60,
          'refresh_token': 'new-refresh',
          'refresh_expires_in_secs': 600,
        },
        'meta': <String, Object?>{'generated_at_ms': 10, 'has_more': false},
      }),
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
