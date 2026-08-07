typedef JsonMap = Map<String, Object?>;

JsonMap jsonMap(Object? value, {String context = 'JSON value'}) {
  if (value is Map<String, Object?>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  throw FormatException('$context must be an object');
}

List<Object?> jsonList(Object? value, {String context = 'JSON value'}) {
  if (value is List<Object?>) return value;
  if (value is List) return value.cast<Object?>();
  throw FormatException('$context must be an array');
}

String jsonString(JsonMap map, String key, {String? fallback}) {
  final value = map[key];
  if (value is String) return value;
  if (value == null && fallback != null) return fallback;
  throw FormatException('$key must be a string');
}

String? jsonStringOrNull(JsonMap map, String key) {
  final value = map[key];
  if (value == null) return null;
  if (value is String) return value;
  throw FormatException('$key must be a string or null');
}

int jsonInt(JsonMap map, String key, {int? fallback}) {
  final value = map[key];
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value == null && fallback != null) return fallback;
  throw FormatException('$key must be an integer');
}

int? jsonIntOrNull(JsonMap map, String key) {
  final value = map[key];
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  throw FormatException('$key must be an integer or null');
}

double jsonDouble(JsonMap map, String key, {double? fallback}) {
  final value = map[key];
  if (value is num) return value.toDouble();
  if (value == null && fallback != null) return fallback;
  throw FormatException('$key must be a number');
}

bool jsonBool(JsonMap map, String key, {bool? fallback}) {
  final value = map[key];
  if (value is bool) return value;
  if (value == null && fallback != null) return fallback;
  throw FormatException('$key must be a boolean');
}

List<String> jsonStringList(JsonMap map, String key) {
  final value = map[key];
  if (value == null) return const <String>[];
  return jsonList(value, context: key)
      .map((item) {
        if (item is! String) throw FormatException('$key must contain strings');
        return item;
      })
      .toList(growable: false);
}

JsonMap omitNulls(JsonMap input) => Map<String, Object?>.fromEntries(
  input.entries.where((entry) => entry.value != null),
);
