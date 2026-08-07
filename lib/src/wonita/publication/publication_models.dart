import '../json.dart';

enum PublicationState {
  draft('draft'),
  published('published'),
  archived('archived');

  const PublicationState(this.wireName);
  final String wireName;

  static PublicationState parse(String value) => values.firstWhere(
    (item) => item.wireName == value,
    orElse: () => throw FormatException('Unknown publication state: $value'),
  );
}

enum PublicationVisibility {
  private('private'),
  unlisted('unlisted'),
  public('public');

  const PublicationVisibility(this.wireName);
  final String wireName;

  static PublicationVisibility parse(String value) => values.firstWhere(
    (item) => item.wireName == value,
    orElse: () =>
        throw FormatException('Unknown publication visibility: $value'),
  );
}

enum PublicationBodyFormat {
  plainText('plain_text'),
  markdown('markdown');

  const PublicationBodyFormat(this.wireName);
  final String wireName;

  static PublicationBodyFormat parse(String value) => values.firstWhere(
    (item) => item.wireName == value,
    orElse: () =>
        throw FormatException('Unknown publication body format: $value'),
  );
}

final class WonitaPublication {
  const WonitaPublication({
    required this.publicationId,
    required this.ownerAccountId,
    required this.title,
    required this.url,
    required this.body,
    required this.bodyFormat,
    required this.state,
    required this.visibility,
    required this.version,
    required this.createdAtMs,
    required this.updatedAtMs,
    this.publishedAtMs,
  });

  /// Defaults make the parser compatible with Wonita's legacy publication
  /// response while the lifecycle migration rolls out: old rows were direct
  /// public/plain-text publications at version 1.
  factory WonitaPublication.fromJson(JsonMap json) => WonitaPublication(
    publicationId: jsonString(json, 'publication_id'),
    ownerAccountId: jsonString(json, 'owner_account_id'),
    title: jsonString(json, 'title'),
    url: jsonString(json, 'url', fallback: ''),
    body: jsonString(json, 'body', fallback: ''),
    bodyFormat: PublicationBodyFormat.parse(
      jsonString(json, 'body_format', fallback: 'plain_text'),
    ),
    state: PublicationState.parse(
      jsonString(json, 'state', fallback: 'published'),
    ),
    visibility: PublicationVisibility.parse(
      jsonString(json, 'visibility', fallback: 'public'),
    ),
    version: jsonInt(json, 'version', fallback: 1),
    createdAtMs: jsonInt(json, 'created_at_ms'),
    updatedAtMs: jsonInt(json, 'updated_at_ms'),
    publishedAtMs: jsonIntOrNull(json, 'published_at_ms'),
  );

  final String publicationId;
  final String ownerAccountId;
  final String title;
  final String url;
  final String body;
  final PublicationBodyFormat bodyFormat;
  final PublicationState state;
  final PublicationVisibility visibility;
  final int version;
  final int createdAtMs;
  final int updatedAtMs;
  final int? publishedAtMs;
}

final class WonitaPublicationVersion {
  const WonitaPublicationVersion({
    required this.publicationId,
    required this.version,
    required this.title,
    required this.url,
    required this.body,
    required this.bodyFormat,
    required this.state,
    required this.visibility,
    required this.revisionCreatedAtMs,
    this.publishedAtMs,
  });

  factory WonitaPublicationVersion.fromJson(JsonMap json) =>
      WonitaPublicationVersion(
        publicationId: jsonString(json, 'publication_id'),
        version: jsonInt(json, 'version'),
        title: jsonString(json, 'title'),
        url: jsonString(json, 'url', fallback: ''),
        body: jsonString(json, 'body', fallback: ''),
        bodyFormat: PublicationBodyFormat.parse(
          jsonString(json, 'body_format', fallback: 'plain_text'),
        ),
        state: PublicationState.parse(
          jsonString(json, 'state', fallback: 'draft'),
        ),
        visibility: PublicationVisibility.parse(
          jsonString(json, 'visibility', fallback: 'private'),
        ),
        revisionCreatedAtMs: jsonInt(json, 'revision_created_at_ms'),
        publishedAtMs: jsonIntOrNull(json, 'published_at_ms'),
      );

  final String publicationId;
  final int version;
  final String title;
  final String url;
  final String body;
  final PublicationBodyFormat bodyFormat;
  final PublicationState state;
  final PublicationVisibility visibility;
  final int revisionCreatedAtMs;
  final int? publishedAtMs;
}

final class NewWonitaPublicationDraft {
  const NewWonitaPublicationDraft({
    required this.clientRequestId,
    required this.title,
    this.body = '',
    this.url = '',
    this.bodyFormat = PublicationBodyFormat.markdown,
  });

  final String clientRequestId;
  final String title;
  final String url;
  final String body;
  final PublicationBodyFormat bodyFormat;

  JsonMap toJson() => {
    'client_request_id': clientRequestId,
    'title': title,
    'url': url,
    'body': body,
    'body_format': bodyFormat.wireName,
  };
}

final class UpdateWonitaPublication {
  const UpdateWonitaPublication({
    required this.title,
    required this.body,
    this.url = '',
    this.bodyFormat = PublicationBodyFormat.markdown,
  });

  final String title;
  final String url;
  final String body;
  final PublicationBodyFormat bodyFormat;

  JsonMap toJson() => {
    'title': title,
    'url': url,
    'body': body,
    'body_format': bodyFormat.wireName,
  };
}

/// Payload for the existing direct-publication endpoint. Kept for compatibility
/// with older Wonita servers and intentionally not used for cloud drafts.
final class LegacyWonitaPublication {
  const LegacyWonitaPublication({
    required this.title,
    this.url = '',
    this.body = '',
  });

  final String title;
  final String url;
  final String body;

  JsonMap toJson() => {'title': title, 'url': url, 'body': body};
}
