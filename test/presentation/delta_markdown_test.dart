import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/src/presentation/editor/delta_markdown.dart';

void main() {
  test('projects supported inline and block formats to markdown', () {
    final markdown = deltaToMarkdown([
      {'insert': 'Heading'},
      {
        'insert': '\n',
        'attributes': {'header': 2},
      },
      {
        'insert': 'bold',
        'attributes': {'bold': true},
      },
      {'insert': ' and '},
      {
        'insert': 'linked',
        'attributes': {'link': 'https://wonita.link'},
      },
      {'insert': '\n'},
      {'insert': 'task'},
      {
        'insert': '\n',
        'attributes': {'list': 'unchecked'},
      },
      {
        'insert': {'divider': ''},
      },
      {'insert': '\n'},
    ]);

    expect(markdown, contains('## Heading'));
    expect(markdown, contains('**bold** and [linked](https://wonita.link)'));
    expect(markdown, contains('- [ ] task'));
    expect(markdown, contains('---'));
  });

  test('drops unsafe links but keeps their visible text', () {
    final markdown = deltaToMarkdown([
      {
        'insert': 'do not run',
        'attributes': {'link': 'javascript:alert(1)'},
      },
      {'insert': '\n'},
    ]);

    expect(markdown, 'do not run');
  });
}
