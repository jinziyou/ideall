import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/src/domain/domain.dart';

void main() {
  LibraryNode node({
    required String title,
    required DateTime updatedAt,
    required int revision,
  }) => LibraryNode(
    id: 'stable-id',
    kind: NodeKind.note,
    title: title,
    document: DocumentContent.fromDelta([
      {'insert': '$title\n'},
    ]),
    tags: const [],
    status: NodeStatus.active,
    createdAt: DateTime.utc(2026),
    updatedAt: updatedAt,
    revision: revision,
  );

  test('conflict copy is deterministic, idempotent and preserves loser', () {
    final local = node(
      title: 'Local words',
      updatedAt: DateTime.utc(2026, 8, 6, 10),
      revision: 2,
    );
    final remote = node(
      title: 'Remote words',
      updatedAt: DateTime.utc(2026, 8, 6, 11),
      revision: 2,
    );

    final first = resolveNodeConflict(
      local: local,
      remote: remote,
      localDeviceId: 'laptop-1234',
      remoteDeviceId: 'phone-5678',
    );
    final second = resolveNodeConflict(
      local: remote,
      remote: local,
      localDeviceId: 'phone-5678',
      remoteDeviceId: 'laptop-1234',
    );

    expect(first.winner.title, 'Remote words');
    expect(first.conflictCopy.title, 'Local words (conflict laptop-1)');
    expect(first.conflictCopy.document.plainText, 'Local words');
    expect(first.conflictCopy.id, second.conflictCopy.id);
    expect(second.winner.title, first.winner.title);
    expect(first.conflictCopy.id, isNot('stable-id'));
    expect(first.conflictCopy.revision, 1);
  });
}
