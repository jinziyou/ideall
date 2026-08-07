/// Canonical Wonita V2 paths.
///
/// Path segments are always encoded here so callers cannot accidentally turn
/// an identifier into a different route (for example an id containing `/`).
abstract final class WonitaApiPaths {
  static const String authLogin = '/v2/app/auth/login';
  static const String authRegister = '/v2/app/auth/register';
  static const String authRefresh = '/v2/app/auth/refresh';
  static const String authLogout = '/v2/app/auth/logout';
  static const String authSession = '/v2/app/auth/session';
  static const String myProfile = '/v2/app/me/profile';

  static const String articleQuery = '/v2/data/corpus/articles/query';

  static const String myPublications = '/v2/app/me/publications';
  static const String publicationDrafts = '/v2/app/me/publications/drafts';

  static const String syncLimits = '/v2/app/sync/limits';

  static String authHandshake(String clientId) =>
      '/v2/app/auth/handshake/${_segment(clientId)}';

  static String article(String articleId) =>
      '/v2/data/corpus/articles/${_segment(articleId)}';

  static String myPublication(String publicationId) =>
      '/v2/app/me/publications/${_segment(publicationId)}';

  static String publicationState(String publicationId) =>
      '${myPublication(publicationId)}/state';

  static String publicationVersions(String publicationId) =>
      '${myPublication(publicationId)}/versions';

  static String publicationVersion(String publicationId, int version) =>
      '${publicationVersions(publicationId)}/$version';

  static String publicationRestore(String publicationId) =>
      '${myPublication(publicationId)}/restore';

  static String publicPublication(String publicationId) =>
      '/v2/app/community/publications/${_segment(publicationId)}';

  static String syncManifest(String syncId) =>
      '/v2/app/sync/${_segment(syncId)}/manifest';

  static String syncGeneration(String syncId, String generation) =>
      '/v2/app/sync/${_segment(syncId)}/generations/${_segment(generation)}';

  static String syncPart(String syncId, String generation, int partIndex) =>
      '${syncGeneration(syncId, generation)}/parts/$partIndex';

  static String _segment(String value) => Uri.encodeComponent(value);
}
