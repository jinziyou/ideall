import 'package:dio/dio.dart';

import 'json.dart';

final class WonitaMeta {
  const WonitaMeta({
    required this.generatedAtMs,
    required this.hasMore,
    this.nextCursor,
    this.projectionWatermark,
  });

  factory WonitaMeta.fromJson(JsonMap json) => WonitaMeta(
    generatedAtMs: jsonInt(json, 'generated_at_ms', fallback: 0),
    hasMore: jsonBool(json, 'has_more', fallback: false),
    nextCursor: jsonStringOrNull(json, 'next_cursor'),
    projectionWatermark: json['projection_watermark'] == null
        ? null
        : jsonMap(json['projection_watermark']),
  );

  final int generatedAtMs;
  final bool hasMore;
  final String? nextCursor;
  final JsonMap? projectionWatermark;
}

final class WonitaPage<T> {
  const WonitaPage({required this.items, required this.meta});

  final List<T> items;
  final WonitaMeta meta;
}

/// Unwraps Wonita's stable `{data, meta}` success envelope.
T decodeWonitaData<T>(
  Response<Object?> response,
  T Function(Object? value) decode,
) {
  if (response.statusCode == 204 || response.data == null) {
    return decode(null);
  }
  final envelope = jsonMap(response.data, context: 'Wonita response');
  if (!envelope.containsKey('data')) {
    throw const FormatException('Wonita response is missing data');
  }
  return decode(envelope['data']);
}

WonitaPage<T> decodeWonitaPage<T>(
  Response<Object?> response,
  T Function(Object? value) decodeItem,
) {
  final envelope = jsonMap(response.data, context: 'Wonita response');
  final items = jsonList(
    envelope['data'],
    context: 'Wonita response data',
  ).map(decodeItem).toList(growable: false);
  final metaValue = envelope['meta'];
  final meta = metaValue == null
      ? const WonitaMeta(generatedAtMs: 0, hasMore: false)
      : WonitaMeta.fromJson(jsonMap(metaValue, context: 'Wonita meta'));
  return WonitaPage(items: items, meta: meta);
}

String? wonitaErrorMessage(Object? body) {
  if (body is String && body.isNotEmpty) return body;
  if (body is! Map) return null;
  final json = jsonMap(body);
  final error = json['error'];
  if (error is Map) {
    final message = jsonMap(error)['message'];
    if (message is String && message.isNotEmpty) return message;
  }
  for (final key in const ['detail', 'message', 'error']) {
    final value = json[key];
    if (value is String && value.isNotEmpty) return value;
  }
  return null;
}
