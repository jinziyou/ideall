import 'dart:async';

import 'package:dio/dio.dart';

import 'api_envelope.dart';
import 'api_paths.dart';
import 'auth/auth_models.dart';
import 'auth/session_store.dart';
import 'json.dart';

typedef WonitaClock = DateTime Function();

/// Shared HTTP entry point with bearer injection, rotating refresh, and a
/// single retry for authenticated 401 responses.
final class WonitaClient {
  WonitaClient({
    Uri? baseUri,
    required WonitaSessionStore sessionStore,
    Dio? dio,
    Dio? refreshDio,
    WonitaClock? clock,
  }) : _store = sessionStore,
       _clock = clock ?? DateTime.now,
       publicDio = refreshDio ?? Dio(),
       dio = dio ?? Dio() {
    final resolved = _normalizedBaseUrl(baseUri ?? productionBaseUri);
    this.dio.options
      ..baseUrl = resolved
      ..headers['Accept'] = 'application/json';
    publicDio.options
      ..baseUrl = resolved
      ..headers['Accept'] = 'application/json';
    this.dio.interceptors.add(_WonitaAuthInterceptor(this));
  }

  static final Uri productionBaseUri = Uri.parse('https://api.wonita.link');
  static const Duration refreshWindow = Duration(seconds: 30);

  final Dio dio;
  final Dio publicDio;
  final WonitaSessionStore _store;
  final WonitaClock _clock;
  Future<WonitaSession>? _refreshing;

  WonitaSessionStore get sessionStore => _store;

  Future<WonitaSession> refreshSession() {
    final current = _refreshing;
    if (current != null) return current;
    final operation = _performRefresh();
    _refreshing = operation;
    unawaited(
      operation.then<void>(
        (_) {
          if (identical(_refreshing, operation)) _refreshing = null;
        },
        onError: (Object _, StackTrace _) {
          if (identical(_refreshing, operation)) _refreshing = null;
        },
      ),
    );
    return operation;
  }

  Future<WonitaSession> _performRefresh() async {
    final existing = await _store.read();
    final refreshToken = existing?.refreshToken;
    if (existing == null ||
        refreshToken == null ||
        !existing.canRefreshAt(_clock())) {
      throw const WonitaAuthenticationException(
        'No refreshable Wonita session',
      );
    }
    try {
      final response = await publicDio.post<Object?>(
        WonitaApiPaths.authRefresh,
        data: <String, Object?>{'refresh_token': refreshToken},
      );
      final tokens = decodeWonitaData(
        response,
        (value) => WonitaAuthTokens.fromJson(
          jsonMap(value, context: 'refresh response'),
        ),
      );
      if (tokens.refreshToken == null || tokens.refreshToken!.isEmpty) {
        throw const FormatException('Refresh response omitted rotating token');
      }
      final replacement = WonitaSession.fromTokens(tokens, now: _clock());
      await _store.write(replacement);
      return replacement;
    } on DioException catch (error) {
      if (error.response?.statusCode == 401) await _store.clear();
      rethrow;
    }
  }

  static String _normalizedBaseUrl(Uri uri) {
    if (!uri.hasScheme || !uri.hasAuthority) {
      throw ArgumentError.value(uri, 'baseUri', 'must be an absolute URI');
    }
    if (uri.scheme != 'http' && uri.scheme != 'https') {
      throw ArgumentError.value(uri, 'baseUri', 'must use HTTP or HTTPS');
    }
    final normalized = uri.replace(query: null, fragment: null).toString();
    return normalized.endsWith('/')
        ? normalized.substring(0, normalized.length - 1)
        : normalized;
  }
}

final class WonitaAuthenticationException implements Exception {
  const WonitaAuthenticationException(this.message);

  final String message;

  @override
  String toString() => 'WonitaAuthenticationException: $message';
}

final class WonitaApiException implements Exception {
  const WonitaApiException({required this.message, this.statusCode});

  factory WonitaApiException.fromDio(DioException error) => WonitaApiException(
    message:
        wonitaErrorMessage(error.response?.data) ??
        error.message ??
        'Wonita request failed',
    statusCode: error.response?.statusCode,
  );

  final String message;
  final int? statusCode;

  @override
  String toString() => statusCode == null
      ? 'WonitaApiException: $message'
      : 'WonitaApiException($statusCode): $message';
}

final class _WonitaAuthInterceptor extends Interceptor {
  _WonitaAuthInterceptor(this.client);

  static const String _retryKey = 'wonita.auth.retry';
  final WonitaClient client;

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    try {
      var session = await client._store.read();
      if (session != null &&
          session.accessExpiresWithin(
            client._clock(),
            WonitaClient.refreshWindow,
          ) &&
          session.canRefreshAt(client._clock())) {
        try {
          session = await client.refreshSession();
        } on Object {
          // A transient refresh failure should not discard an access token that
          // may still be accepted. A 401 refresh already clears the store.
          session = await client._store.read() ?? session;
        }
      }
      if (session != null) {
        options.headers['Authorization'] =
            '${session.tokenType} ${session.accessToken}';
      }
      handler.next(options);
    } on Object catch (error, stackTrace) {
      handler.reject(
        DioException(
          requestOptions: options,
          error: error,
          stackTrace: stackTrace,
          type: DioExceptionType.unknown,
        ),
      );
    }
  }

  @override
  void onError(DioException error, ErrorInterceptorHandler handler) async {
    final request = error.requestOptions;
    if (error.response?.statusCode != 401 || request.extra[_retryKey] == true) {
      handler.next(error);
      return;
    }

    try {
      final usedAuthorization = request.headers['Authorization']?.toString();
      var session = await client._store.read();
      if (session == null || !session.canRefreshAt(client._clock())) {
        handler.next(error);
        return;
      }

      final currentAuthorization =
          '${session.tokenType} ${session.accessToken}';
      // Another request may already have rotated the token before this 401 was
      // observed. Retrying with that stored token avoids consuming the fresh
      // single-use refresh token a second time.
      if (usedAuthorization == currentAuthorization) {
        session = await client.refreshSession();
      }

      request
        ..headers['Authorization'] =
            '${session.tokenType} ${session.accessToken}'
        ..extra[_retryKey] = true;
      final response = await client.dio.fetch<Object?>(request);
      handler.resolve(response);
    } on Object {
      handler.next(error);
    }
  }
}
