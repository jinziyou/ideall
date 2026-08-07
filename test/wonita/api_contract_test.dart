import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/src/wonita/wonita.dart';

void main() {
  group('WonitaApiPaths', () {
    test('encodes every dynamic path segment', () {
      expect(
        WonitaApiPaths.authHandshake('client/a?b'),
        '/v2/app/auth/handshake/client%2Fa%3Fb',
      );
      expect(
        WonitaApiPaths.article('article:one/two'),
        '/v2/data/corpus/articles/article%3Aone%2Ftwo',
      );
      expect(
        WonitaApiPaths.publicationVersion('pub:abc', 7),
        '/v2/app/me/publications/pub%3Aabc/versions/7',
      );
      expect(
        WonitaApiPaths.publicationRestore('pub:abc'),
        '/v2/app/me/publications/pub%3Aabc/restore',
      );
    });

    test('keeps the three sync scopes in isolated ids', () {
      const generation = '00000000000000000000000000000000';
      expect(
        WonitaApiPaths.syncPart('abc_def-12345678', generation, 4),
        '/v2/app/sync/abc_def-12345678/generations/$generation/parts/4',
      );
    });
  });

  test('success envelope exposes data and cursor metadata', () {
    final response = Response<Object?>(
      requestOptions: RequestOptions(path: '/test'),
      data: <String, Object?>{
        'data': <Object?>[
          <String, Object?>{'value': 3},
        ],
        'meta': <String, Object?>{
          'generated_at_ms': 10,
          'has_more': true,
          'next_cursor': 'next',
        },
      },
    );
    final page = decodeWonitaPage(
      response,
      (value) => (value! as Map<String, Object?>)['value']! as int,
    );
    expect(page.items, [3]);
    expect(page.meta.hasMore, isTrue);
    expect(page.meta.nextCursor, 'next');
  });

  test('nested error envelope yields a displayable message', () {
    expect(
      wonitaErrorMessage(<String, Object?>{
        'error': <String, Object?>{
          'code': 'conflict',
          'message': 'version conflict',
        },
      }),
      'version conflict',
    );
  });
}
