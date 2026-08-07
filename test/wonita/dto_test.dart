import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/src/wonita/wonita.dart';

void main() {
  test('legacy publication is interpreted as public published version one', () {
    final publication = WonitaPublication.fromJson(<String, Object?>{
      'publication_id': 'pub:0011',
      'owner_account_id': 'usr:0011',
      'title': 'A title',
      'url': '',
      'body': 'body',
      'created_at_ms': 10,
      'updated_at_ms': 11,
    });
    expect(publication.state, PublicationState.published);
    expect(publication.visibility, PublicationVisibility.public);
    expect(publication.bodyFormat, PublicationBodyFormat.plainText);
    expect(publication.version, 1);
  });

  test('draft and update payloads preserve body whitespace', () {
    const body = '  heading\n\nbody  ';
    final draft = const NewWonitaPublicationDraft(
      clientRequestId: 'request-1',
      title: 'Title',
      body: body,
    ).toJson();
    expect(draft['body'], body);
    expect(draft['body_format'], 'markdown');
    expect(draft.containsKey('visibility'), isFalse);

    final update = const UpdateWonitaPublication(
      title: 'Title',
      body: body,
    ).toJson();
    expect(update['body'], body);
    expect(update.containsKey('visibility'), isFalse);
  });

  test('historical revision uses its immutable revision timestamp', () {
    final version = WonitaPublicationVersion.fromJson(<String, Object?>{
      'publication_id': 'pub:0011',
      'version': 4,
      'title': 'Older title',
      'url': '',
      'body': 'older body',
      'state': 'draft',
      'visibility': 'private',
      'body_format': 'markdown',
      'published_at_ms': null,
      'revision_created_at_ms': 1234,
    });
    expect(version.version, 4);
    expect(version.revisionCreatedAtMs, 1234);
  });

  test('anonymous article query omits empty filters and caps limit at 50', () {
    const query = WonitaArticleQuery(
      query: '  climate  ',
      topics: <String>[],
      limit: 200,
      cursor: '',
    );
    expect(query.toJson(), <String, Object?>{'q': 'climate', 'limit': 50});
  });
}
