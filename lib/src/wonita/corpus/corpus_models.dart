import '../json.dart';

final class WonitaArticleQuery {
  const WonitaArticleQuery({
    this.query,
    this.publisherId,
    this.entityIds,
    this.sourceCategory,
    this.platformType,
    this.publisherCountryPrefix,
    this.language,
    this.topics,
    this.geoScope,
    this.fromMs,
    this.toMs,
    this.limit = 25,
    this.cursor,
  });

  final String? query;
  final String? publisherId;
  final List<String>? entityIds;
  final String? sourceCategory;
  final String? platformType;
  final String? publisherCountryPrefix;
  final String? language;
  final List<String>? topics;
  final List<String>? geoScope;
  final int? fromMs;
  final int? toMs;
  final int limit;
  final String? cursor;

  WonitaArticleQuery withCursor(String? value) => WonitaArticleQuery(
    query: query,
    publisherId: publisherId,
    entityIds: entityIds,
    sourceCategory: sourceCategory,
    platformType: platformType,
    publisherCountryPrefix: publisherCountryPrefix,
    language: language,
    topics: topics,
    geoScope: geoScope,
    fromMs: fromMs,
    toMs: toMs,
    limit: limit,
    cursor: value,
  );

  JsonMap toJson() => omitNulls({
    'q': _nonEmpty(query),
    'publisher_id': _nonEmpty(publisherId),
    'entity_ids': _nonEmptyList(entityIds),
    'source_category': _nonEmpty(sourceCategory),
    'platform_type': _nonEmpty(platformType),
    'publisher_country_prefix': _nonEmpty(publisherCountryPrefix),
    'language': _nonEmpty(language),
    'topics': _nonEmptyList(topics),
    'geo_scope': _nonEmptyList(geoScope),
    'from_ms': fromMs,
    'to_ms': toMs,
    'limit': limit.clamp(1, 50),
    'cursor': _nonEmpty(cursor),
  });

  static String? _nonEmpty(String? value) {
    final trimmed = value?.trim();
    return trimmed == null || trimmed.isEmpty ? null : trimmed;
  }

  static List<String>? _nonEmptyList(List<String>? value) =>
      value == null || value.isEmpty ? null : List<String>.unmodifiable(value);
}

final class WonitaEntityMention {
  const WonitaEntityMention({
    required this.entityId,
    required this.label,
    required this.qid,
    required this.canonicalName,
    required this.surface,
    required this.confidence,
  });

  factory WonitaEntityMention.fromJson(JsonMap json) => WonitaEntityMention(
    entityId: jsonString(json, 'entity_id'),
    label: jsonString(json, 'label'),
    qid: jsonString(json, 'qid'),
    canonicalName: jsonString(json, 'canonical_name'),
    surface: jsonString(json, 'surface'),
    confidence: jsonDouble(json, 'confidence'),
  );

  final String entityId;
  final String label;
  final String qid;
  final String canonicalName;
  final String surface;
  final double confidence;
}

final class WonitaArticle {
  const WonitaArticle({
    required this.articleId,
    required this.revisionId,
    required this.versionMs,
    required this.canonicalUrl,
    required this.title,
    required this.body,
    required this.language,
    required this.publisherId,
    required this.publisherDomain,
    required this.sourceId,
    required this.sourceCategory,
    required this.platformType,
    required this.publisherCountry,
    required this.publishedAtMs,
    required this.collectedAtMs,
    required this.topics,
    required this.geoScope,
    required this.entities,
    required this.enclosures,
  });

  factory WonitaArticle.fromJson(JsonMap json) => WonitaArticle(
    articleId: jsonString(json, 'article_id'),
    revisionId: jsonString(json, 'revision_id'),
    versionMs: jsonInt(json, 'version_ms'),
    canonicalUrl: jsonString(json, 'canonical_url'),
    title: jsonString(json, 'title'),
    body: jsonString(json, 'body'),
    language: jsonString(json, 'language'),
    publisherId: jsonString(json, 'publisher_id'),
    publisherDomain: jsonString(json, 'publisher_domain'),
    sourceId: jsonString(json, 'source_id'),
    sourceCategory: jsonString(json, 'source_category'),
    platformType: jsonString(json, 'platform_type'),
    publisherCountry: jsonString(json, 'publisher_country'),
    publishedAtMs: jsonInt(json, 'published_at_ms'),
    collectedAtMs: jsonInt(json, 'collected_at_ms'),
    topics: jsonStringList(json, 'topics'),
    geoScope: jsonStringList(json, 'geo_scope'),
    entities: json['entities'] == null
        ? const <WonitaEntityMention>[]
        : jsonList(json['entities'], context: 'entities')
              .map((value) => WonitaEntityMention.fromJson(jsonMap(value)))
              .toList(growable: false),
    enclosures: json['enclosures'] == null
        ? const <Object?>[]
        : List<Object?>.unmodifiable(
            jsonList(json['enclosures'], context: 'enclosures'),
          ),
  );

  final String articleId;
  final String revisionId;
  final int versionMs;
  final String canonicalUrl;
  final String title;
  final String body;
  final String language;
  final String publisherId;
  final String publisherDomain;
  final String sourceId;
  final String sourceCategory;
  final String platformType;
  final String publisherCountry;
  final int publishedAtMs;
  final int collectedAtMs;
  final List<String> topics;
  final List<String> geoScope;
  final List<WonitaEntityMention> entities;
  final List<Object?> enclosures;
}
