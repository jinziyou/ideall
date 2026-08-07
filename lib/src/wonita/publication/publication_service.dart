import 'package:dio/dio.dart';

import '../api_envelope.dart';
import '../api_paths.dart';
import '../json.dart';
import 'publication_models.dart';

final class WonitaPublicationService {
  const WonitaPublicationService({
    required this.authenticatedDio,
    required this.publicDio,
  });

  final Dio authenticatedDio;
  final Dio publicDio;

  Future<List<WonitaPublication>> listMine() async {
    final response = await authenticatedDio.get<Object?>(
      WonitaApiPaths.myPublications,
    );
    return decodeWonitaData(response, _publicationList);
  }

  Future<WonitaPublication> createDraft(NewWonitaPublicationDraft draft) async {
    final response = await authenticatedDio.post<Object?>(
      WonitaApiPaths.publicationDrafts,
      data: draft.toJson(),
    );
    return decodeWonitaData(response, _publication);
  }

  Future<WonitaPublication> createLegacyPublished(
    LegacyWonitaPublication publication,
  ) async {
    final response = await authenticatedDio.post<Object?>(
      WonitaApiPaths.myPublications,
      data: publication.toJson(),
    );
    return decodeWonitaData(response, _publication);
  }

  Future<WonitaPublication> getMine(String publicationId) async {
    final response = await authenticatedDio.get<Object?>(
      WonitaApiPaths.myPublication(publicationId),
    );
    return decodeWonitaData(response, _publication);
  }

  Future<WonitaPublication> update({
    required String publicationId,
    required int expectedVersion,
    required UpdateWonitaPublication publication,
  }) async {
    final response = await authenticatedDio.put<Object?>(
      WonitaApiPaths.myPublication(publicationId),
      queryParameters: <String, Object?>{'expected': expectedVersion},
      data: publication.toJson(),
    );
    return decodeWonitaData(response, _publication);
  }

  Future<WonitaPublication> changeState({
    required String publicationId,
    required int expectedVersion,
    required PublicationState state,
    required PublicationVisibility visibility,
  }) async {
    final response = await authenticatedDio.put<Object?>(
      WonitaApiPaths.publicationState(publicationId),
      queryParameters: <String, Object?>{'expected': expectedVersion},
      data: <String, Object?>{
        'state': state.wireName,
        'visibility': visibility.wireName,
      },
    );
    return decodeWonitaData(response, _publication);
  }

  Future<List<WonitaPublicationVersion>> versions(
    String publicationId, {
    int limit = 50,
    int? beforeVersion,
  }) async {
    final response = await authenticatedDio.get<Object?>(
      WonitaApiPaths.publicationVersions(publicationId),
      queryParameters: omitNulls(<String, Object?>{
        'limit': limit.clamp(1, 100),
        'before_version': beforeVersion,
      }),
    );
    return decodeWonitaData(
      response,
      (value) => jsonList(value, context: 'publication versions')
          .map(
            (item) => WonitaPublicationVersion.fromJson(
              jsonMap(item, context: 'publication version'),
            ),
          )
          .toList(growable: false),
    );
  }

  Future<WonitaPublicationVersion> version(
    String publicationId,
    int version,
  ) async {
    final response = await authenticatedDio.get<Object?>(
      WonitaApiPaths.publicationVersion(publicationId, version),
    );
    return decodeWonitaData(
      response,
      (value) => WonitaPublicationVersion.fromJson(
        jsonMap(value, context: 'publication version'),
      ),
    );
  }

  /// Restoring never mutates history; the server appends a new version and
  /// returns the resulting publication head.
  Future<WonitaPublication> restore({
    required String publicationId,
    required int version,
    required int expectedVersion,
  }) async {
    final response = await authenticatedDio.put<Object?>(
      WonitaApiPaths.publicationRestore(publicationId),
      queryParameters: <String, Object?>{'expected': expectedVersion},
      data: <String, Object?>{'version': version},
    );
    return decodeWonitaData(response, _publication);
  }

  Future<void> delete(String publicationId, {int? expectedVersion}) async {
    await authenticatedDio.delete<Object?>(
      WonitaApiPaths.myPublication(publicationId),
      queryParameters: expectedVersion == null
          ? null
          : <String, Object?>{'expected': expectedVersion},
    );
  }

  /// Exact-id public read. Both public and unlisted publications are reachable;
  /// drafts, archived records, and private records must remain server-hidden.
  Future<WonitaPublication> getPublic(String publicationId) async {
    final response = await publicDio.get<Object?>(
      WonitaApiPaths.publicPublication(publicationId),
    );
    return decodeWonitaData(response, _publication);
  }

  static WonitaPublication _publication(Object? value) =>
      WonitaPublication.fromJson(jsonMap(value, context: 'publication'));

  static List<WonitaPublication> _publicationList(Object? value) => jsonList(
    value,
    context: 'publications',
  ).map(_publication).toList(growable: false);
}
