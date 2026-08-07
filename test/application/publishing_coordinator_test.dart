import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/src/application/publishing_coordinator.dart';

void main() {
  test('draft idempotency key is stable for the lifetime of a local node', () {
    final first = PublishingCoordinator.draftRequestIdForNode('node-1');

    expect(PublishingCoordinator.draftRequestIdForNode('node-1'), first);
    expect(PublishingCoordinator.draftRequestIdForNode('node-2'), isNot(first));
    expect(
      first,
      matches(
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ),
      ),
    );
  });

  test('public publication URL safely encodes the publication id', () {
    final uri = PublishingCoordinator.publicUriFor('publication/with space');

    expect(uri.scheme, 'https');
    expect(uri.host, 'www.wonita.link');
    expect(
      uri.toString(),
      'https://www.wonita.link/community/publications/publication%2Fwith%20space',
    );
  });
}
