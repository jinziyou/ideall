import '../json.dart';

final class WonitaAuthCredentials {
  const WonitaAuthCredentials({
    required this.clientId,
    required this.clientSecret,
    required this.email,
    required this.encryptedPassword,
  });

  final String clientId;
  final String clientSecret;
  final String email;
  final String encryptedPassword;

  JsonMap toJson() => {
    'client_id': clientId,
    'client_secret': clientSecret,
    'email': email,
    'encrypted_password': encryptedPassword,
  };
}

final class WonitaAuthTokens {
  const WonitaAuthTokens({
    required this.accessToken,
    required this.tokenType,
    required this.expiresInSeconds,
    required this.refreshToken,
    required this.refreshExpiresInSeconds,
  });

  factory WonitaAuthTokens.fromJson(JsonMap json) => WonitaAuthTokens(
    accessToken: jsonString(json, 'token'),
    tokenType: jsonString(json, 'token_type', fallback: 'Bearer'),
    expiresInSeconds: jsonIntOrNull(json, 'expires_in_secs'),
    refreshToken: jsonStringOrNull(json, 'refresh_token'),
    refreshExpiresInSeconds: jsonIntOrNull(json, 'refresh_expires_in_secs'),
  );

  final String accessToken;
  final String tokenType;
  final int? expiresInSeconds;
  final String? refreshToken;
  final int? refreshExpiresInSeconds;
}

final class WonitaAccount {
  const WonitaAccount({
    required this.accountId,
    required this.email,
    required this.displayName,
  });

  factory WonitaAccount.fromJson(JsonMap json) => WonitaAccount(
    accountId: jsonString(json, 'account_id'),
    email: jsonString(json, 'email'),
    displayName: jsonString(json, 'display_name'),
  );

  final String accountId;
  final String email;
  final String displayName;
}

/// The only value persisted for a Wonita login.
///
/// Access and rotating refresh credentials are deliberately written together,
/// which prevents a crash between two secure-storage writes from pairing a new
/// access token with an already consumed refresh token.
final class WonitaSession {
  const WonitaSession({
    required this.accessToken,
    required this.tokenType,
    required this.createdAtMs,
    this.accessExpiresAtMs,
    this.refreshToken,
    this.refreshExpiresAtMs,
  });

  static const int schemaVersion = 1;

  factory WonitaSession.fromTokens(
    WonitaAuthTokens tokens, {
    required DateTime now,
  }) {
    final nowMs = now.millisecondsSinceEpoch;
    return WonitaSession(
      accessToken: tokens.accessToken,
      tokenType: tokens.tokenType,
      createdAtMs: nowMs,
      accessExpiresAtMs: tokens.expiresInSeconds == null
          ? null
          : nowMs + tokens.expiresInSeconds! * 1000,
      refreshToken: tokens.refreshToken,
      refreshExpiresAtMs: tokens.refreshExpiresInSeconds == null
          ? null
          : nowMs + tokens.refreshExpiresInSeconds! * 1000,
    );
  }

  factory WonitaSession.fromJson(JsonMap json) {
    final schema = jsonInt(json, 'schema');
    if (schema != schemaVersion) {
      throw FormatException('Unsupported Wonita session schema: $schema');
    }
    return WonitaSession(
      accessToken: jsonString(json, 'access_token'),
      tokenType: jsonString(json, 'token_type', fallback: 'Bearer'),
      createdAtMs: jsonInt(json, 'created_at_ms'),
      accessExpiresAtMs: jsonIntOrNull(json, 'access_expires_at_ms'),
      refreshToken: jsonStringOrNull(json, 'refresh_token'),
      refreshExpiresAtMs: jsonIntOrNull(json, 'refresh_expires_at_ms'),
    );
  }

  final String accessToken;
  final String tokenType;
  final int createdAtMs;
  final int? accessExpiresAtMs;
  final String? refreshToken;
  final int? refreshExpiresAtMs;

  bool canRefreshAt(DateTime now) {
    final token = refreshToken;
    if (token == null || token.isEmpty) return false;
    final expiresAt = refreshExpiresAtMs;
    return expiresAt == null || now.millisecondsSinceEpoch < expiresAt;
  }

  bool accessExpiresWithin(DateTime now, Duration window) {
    final expiresAt = accessExpiresAtMs;
    return expiresAt != null &&
        now.millisecondsSinceEpoch + window.inMilliseconds >= expiresAt;
  }

  JsonMap toJson() => omitNulls({
    'schema': schemaVersion,
    'access_token': accessToken,
    'token_type': tokenType,
    'created_at_ms': createdAtMs,
    'access_expires_at_ms': accessExpiresAtMs,
    'refresh_token': refreshToken,
    'refresh_expires_at_ms': refreshExpiresAtMs,
  });
}
