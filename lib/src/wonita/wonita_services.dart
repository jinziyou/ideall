import 'auth/auth_service.dart';
import 'auth/session_store.dart';
import 'corpus/corpus_service.dart';
import 'publication/publication_service.dart';
import 'sync/sync_service.dart';
import 'wonita_client.dart';

/// Convenience composition root for UI/application providers.
final class WonitaServices {
  factory WonitaServices({Uri? baseUri, WonitaSessionStore? sessionStore}) {
    final client = WonitaClient(
      baseUri: baseUri,
      sessionStore: sessionStore ?? SecureWonitaSessionStore(),
    );
    return WonitaServices._(
      client: client,
      auth: WonitaAuthService(client: client),
      corpus: WonitaCorpusService(client.publicDio),
      publications: WonitaPublicationService(
        authenticatedDio: client.dio,
        publicDio: client.publicDio,
      ),
      sync: WonitaSyncService(dio: client.dio),
    );
  }

  const WonitaServices._({
    required this.client,
    required this.auth,
    required this.corpus,
    required this.publications,
    required this.sync,
  });

  final WonitaClient client;
  final WonitaAuthService auth;
  final WonitaCorpusService corpus;
  final WonitaPublicationService publications;
  final WonitaSyncService sync;
}
