/// Converts the supported Ideall Quill subset into stable, portable Markdown.
/// Unsupported embeds are deliberately omitted: the MVP never stores arbitrary
/// files or executable content.
String deltaToMarkdown(List<dynamic> delta) {
  final output = StringBuffer();
  final line = StringBuffer();

  void flushLine(Map<String, dynamic> attributes) {
    final value = line.toString();
    line.clear();

    final header = attributes['header'];
    final list = attributes['list'];
    final quote = attributes['blockquote'] == true;
    final codeBlock = attributes['code-block'] != null;

    if (codeBlock) {
      output
        ..writeln('```')
        ..writeln(value)
        ..writeln('```');
      return;
    }
    if (header is int && header >= 1 && header <= 3) {
      output.writeln('${List.filled(header, '#').join()} $value');
    } else if (quote) {
      output.writeln('> $value');
    } else if (list == 'ordered') {
      output.writeln('1. $value');
    } else if (list == 'bullet') {
      output.writeln('- $value');
    } else if (list == 'checked') {
      output.writeln('- [x] $value');
    } else if (list == 'unchecked') {
      output.writeln('- [ ] $value');
    } else {
      output.writeln(value);
    }
  }

  for (final rawOperation in delta) {
    if (rawOperation is! Map) continue;
    final operation = Map<String, dynamic>.from(rawOperation);
    final insert = operation['insert'];
    final attributes = operation['attributes'] is Map
        ? Map<String, dynamic>.from(operation['attributes'] as Map)
        : const <String, dynamic>{};

    if (insert is Map) {
      final embed = Map<String, dynamic>.from(insert);
      if (embed.containsKey('divider')) {
        if (line.isNotEmpty) flushLine(const {});
        output.writeln('---');
      }
      continue;
    }
    if (insert is! String) continue;

    final fragments = insert.split('\n');
    for (var index = 0; index < fragments.length; index++) {
      final fragment = fragments[index];
      if (fragment.isNotEmpty) line.write(_inline(fragment, attributes));
      if (index < fragments.length - 1) flushLine(attributes);
    }
  }
  if (line.isNotEmpty) flushLine(const {});
  return output.toString().trimRight();
}

String _inline(String value, Map<String, dynamic> attributes) {
  var text = value.replaceAll('\\', '\\\\');
  final inlineCode = attributes['code'] == true;
  if (!inlineCode) {
    text = text
        .replaceAll('*', '\\*')
        .replaceAll('_', '\\_')
        .replaceAll('[', '\\[')
        .replaceAll(']', '\\]');
  }
  if (inlineCode) text = '`${text.replaceAll('`', '\\`')}`';
  if (attributes['bold'] == true) text = '**$text**';
  if (attributes['italic'] == true) text = '_${text}_';
  if (attributes['strike'] == true) text = '~~$text~~';
  final link = attributes['link'];
  if (link is String && _isSafeHttpUrl(link)) text = '[$text]($link)';
  return text;
}

bool _isSafeHttpUrl(String value) {
  final uri = Uri.tryParse(value);
  return uri != null && (uri.scheme == 'http' || uri.scheme == 'https');
}
