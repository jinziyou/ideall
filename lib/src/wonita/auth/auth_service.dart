import 'package:dio/dio.dart';

import '../api_envelope.dart';
import '../api_paths.dart';
import '../json.dart';
import '../wonita_client.dart';
import 'auth_crypto.dart';
import 'auth_models.dart';

final class WonitaAuthService {
  WonitaAuthService({
    required this.client,
    WonitaAuthCrypto? crypto,
    WonitaClock? clock,
  }) : _crypto = crypto ?? WonitaAuthCrypto(),
       _clock = clock ?? DateTime.now;

  final WonitaClient client;
  final WonitaAuthCrypto _crypto;
  final WonitaClock _clock;

  Future<WonitaSession> login({
    required String email,
    required String password,
  }) => _authenticate(
    path: WonitaApiPaths.authLogin,
    email: email,
    password: password,
  );

  Future<WonitaSession> register({
    required String email,
    required String password,
  }) => _authenticate(
    path: WonitaApiPaths.authRegister,
    email: email,
    password: password,
  );

  Future<WonitaSession> refresh() => client.refreshSession();

  Future<WonitaAccount> currentAccount() async {
    final response = await client.dio.get<Object?>(WonitaApiPaths.authSession);
    return decodeWonitaData(
      response,
      (value) =>
          WonitaAccount.fromJson(jsonMap(value, context: 'session response')),
    );
  }

  Future<WonitaAccount> updateProfile(String displayName) async {
    final response = await client.dio.put<Object?>(
      WonitaApiPaths.myProfile,
      data: <String, Object?>{'display_name': displayName.trim()},
    );
    return decodeWonitaData(
      response,
      (value) =>
          WonitaAccount.fromJson(jsonMap(value, context: 'profile response')),
    );
  }

  Future<void> logout() async {
    final session = await client.sessionStore.read();
    try {
      // Logout is intentionally accepted without an access token so an expired
      // app can still revoke its long-lived server session.
      await client.publicDio.post<Object?>(
        WonitaApiPaths.authLogout,
        data: <String, Object?>{'refresh_token': session?.refreshToken},
      );
    } on DioException {
      // Local sign-out must remain available offline. A failed best-effort
      // revocation does not keep credentials on this device.
    } finally {
      await client.sessionStore.clear();
    }
  }

  Future<WonitaSession> _authenticate({
    required String path,
    required String email,
    required String password,
  }) async {
    final clientId = _crypto.newClientId();
    final keyPair = await _crypto.newKeyPair();
    final handshake = await client.publicDio.get<Object?>(
      WonitaApiPaths.authHandshake(clientId),
    );
    final serverPublicKey = decodeWonitaData(
      handshake,
      (value) => jsonString(
        jsonMap(value, context: 'handshake response'),
        'public_key',
      ),
    );
    final credentials = await _crypto.credentials(
      email: email.trim(),
      password: password,
      serverPublicKeyHex: serverPublicKey,
      clientId: clientId,
      clientKeyPair: keyPair,
    );
    final response = await client.publicDio.post<Object?>(
      path,
      data: credentials.toJson(),
      options: Options(contentType: Headers.jsonContentType),
    );
    final tokens = decodeWonitaData(
      response,
      (value) => WonitaAuthTokens.fromJson(
        jsonMap(value, context: 'authentication response'),
      ),
    );
    final session = WonitaSession.fromTokens(tokens, now: _clock());
    await client.sessionStore.write(session);
    return session;
  }
}
