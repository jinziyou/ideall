import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/src/data/data.dart';
import 'package:ideall/src/domain/domain.dart';

void main() {
  late IdeallDatabase database;
  late DriftLibraryRepository repository;
  var nextId = 0;
  final now = DateTime.utc(2026, 8, 6, 12);

  setUp(() {
    database = IdeallDatabase.forTesting(NativeDatabase.memory());
    repository = DriftLibraryRepository(
      database,
      clock: () => now,
      idGenerator: () => 'generated-${nextId++}',
    );
  });

  tearDown(() => database.close());

  test('uses a fresh explicit database filename', () {
    expect(IdeallDatabase.databaseFileName, 'ideall_terminal_v1.sqlite');
    expect(IdeallDatabase.databaseFileName, isNot('ideall.db'));
  });

  test('creates, updates, moves, trashes and restores a hierarchy', () async {
    final folder = await repository.createNode(
      CreateNodeInput(id: 'folder', kind: NodeKind.folder, title: 'Work'),
    );
    final note = await repository.createNode(
      CreateNodeInput(
        id: 'note',
        parentId: folder.id,
        kind: NodeKind.note,
        title: 'Idea',
        document: DocumentContent.fromDelta([
          {'insert': 'First draft\n'},
        ]),
        tags: const ['Draft', 'draft', 'Research'],
      ),
    );

    expect(
      (await repository.watchChildren(parentId: folder.id).first).single.id,
      note.id,
    );
    expect(note.tags, ['Draft', 'Research']);

    final updated = await repository.updateNode(
      id: note.id,
      title: 'Better idea',
      document: DocumentContent.fromDelta([
        {'insert': 'Second draft\n'},
      ]),
      expectedRevision: 1,
    );
    expect(updated.revision, 2);
    expect(updated.document.plainText, 'Second draft');
    await expectLater(
      repository.updateNode(
        id: note.id,
        title: 'Stale edit',
        expectedRevision: 1,
      ),
      throwsA(isA<RevisionConflictException>()),
    );

    final childFolder = await repository.createNode(
      CreateNodeInput(
        id: 'child-folder',
        parentId: folder.id,
        kind: NodeKind.folder,
        title: 'Child',
      ),
    );
    await expectLater(
      repository.moveNode(folder.id, childFolder.id),
      throwsA(isA<HierarchyCycleException>()),
    );

    await repository.trashNode(folder.id);
    expect((await repository.getNode(note.id))!.status, NodeStatus.trashed);
    expect(
      (await repository.watchTrash().first).map((node) => node.id),
      containsAll(['folder', 'note', 'child-folder']),
    );

    await repository.restoreNode(folder.id);
    expect((await repository.getNode(note.id))!.status, NodeStatus.active);
    expect((await repository.getSyncMetadata('notes'))!.dirty, isTrue);
  });

  test('permanent folder deletion cascades while retaining activity', () async {
    await repository.createNode(
      CreateNodeInput(id: 'folder', kind: NodeKind.folder, title: 'Folder'),
    );
    await repository.createNode(
      CreateNodeInput(
        id: 'note',
        parentId: 'folder',
        kind: NodeKind.note,
        title: 'Note',
      ),
    );

    await repository.deletePermanently('folder');

    expect(await repository.getNode('folder'), isNull);
    expect(await repository.getNode('note'), isNull);
    final deletion = (await repository.watchActivity().first).firstWhere(
      (entry) => entry.type == ActivityType.deleted,
    );
    expect(deletion.nodeId, isNull);
    expect(deletion.details['node_count'], 2);
    final tombstones = (await repository.exportSnapshot()).tombstones;
    expect(
      tombstones.map((value) => '${value.scope}:${value.entityId}'),
      containsAll(['notes:folder', 'notes:note']),
    );
    expect(tombstones.every((value) => value.revision == 2), isTrue);
  });

  test(
    'tree deletion records tombstones in each affected sync scope',
    () async {
      await repository.createNode(
        CreateNodeInput(id: 'folder', kind: NodeKind.folder, title: 'Folder'),
      );
      await repository.createNode(
        CreateNodeInput(
          id: 'bookmark',
          parentId: 'folder',
          kind: NodeKind.bookmark,
          title: 'Link',
          url: 'https://example.com',
        ),
      );

      await repository.deletePermanently('folder');

      final tombstones = (await repository.exportSnapshot()).tombstones;
      expect(
        tombstones.map((value) => '${value.scope}:${value.entityId}'),
        containsAll(['notes:folder', 'bookmarks:bookmark']),
      );
      expect((await repository.getSyncMetadata('notes'))!.dirty, isTrue);
      expect((await repository.getSyncMetadata('bookmarks'))!.dirty, isTrue);
    },
  );

  test('subscription removal persists a sync tombstone', () async {
    await repository.upsertSubscription(
      Subscription(
        id: 'sub',
        kind: 'publisher',
        targetId: 'publisher-1',
        label: 'Publisher',
        metadata: const {},
        enabled: true,
        createdAt: now,
        updatedAt: now,
        revision: 4,
      ),
    );

    await repository.removeSubscription('sub');

    expect(await repository.watchSubscriptions().first, isEmpty);
    final tombstone = (await repository.exportSnapshot()).tombstones.single;
    expect(tombstone.scope, 'subscriptions');
    expect(tombstone.entityId, 'sub');
    expect(tombstone.revision, 5);
  });

  test(
    'search indexes title, Delta plain text and tags and hides trash',
    () async {
      await repository.createNode(
        CreateNodeInput(
          id: 'one',
          kind: NodeKind.note,
          title: 'Orchard plan',
          document: DocumentContent.fromDelta([
            {'insert': 'Grow pears carefully\n'},
          ]),
          tags: const ['gardening'],
        ),
      );
      await repository.createNode(
        CreateNodeInput(
          id: 'two',
          kind: NodeKind.note,
          title: 'Other',
          document: DocumentContent.fromDelta([
            {'insert': 'No fruit here\n'},
          ]),
          tags: const ['orchard'],
        ),
      );

      expect((await repository.search('pears')).single.node.id, 'one');
      expect(
        (await repository.search('orchard')).map((hit) => hit.node.id),
        containsAll(['one', 'two']),
      );

      await repository.trashNode('one');
      expect(await repository.search('pears'), isEmpty);
    },
  );

  test('snapshot round-trips all syncable record families', () async {
    await repository.createNode(
      CreateNodeInput(id: 'note', kind: NodeKind.note, title: 'Portable'),
    );
    await repository.upsertSubscription(
      Subscription(
        id: 'sub',
        kind: 'publisher',
        targetId: 'publisher-1',
        label: 'Publisher',
        metadata: const {'color': 'green'},
        enabled: true,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      ),
    );
    await repository.upsertPublicationLink(
      PublicationLink(
        publicationId: 'publication-1',
        nodeId: 'note',
        version: 3,
        state: PublicationState.published,
        visibility: PublicationVisibility.unlisted,
        publicUrl:
            'https://www.wonita.link/community/publications/publication-1',
        lastPublishedAt: now,
        updatedAt: now,
      ),
    );

    final encoded = (await repository.exportSnapshot()).toJsonString();
    final decoded = LibrarySnapshot.fromJsonString(encoded);
    final targetDatabase = IdeallDatabase.forTesting(NativeDatabase.memory());
    final target = DriftLibraryRepository(
      targetDatabase,
      clock: () => now,
      idGenerator: () => 'target-${nextId++}',
    );
    addTearDown(targetDatabase.close);

    final result = await target.importSnapshot(
      decoded,
      mode: ImportMode.replace,
    );

    expect(result.nodes, 1);
    expect((await target.getNode('note'))!.title, 'Portable');
    expect((await target.watchSubscriptions().first).single.id, 'sub');
    expect((await target.getPublicationLink('publication-1'))!.version, 3);
  });

  test('a propagated tombstone prevents stale snapshot resurrection', () async {
    await repository.createNode(
      CreateNodeInput(id: 'note', kind: NodeKind.note, title: 'Stale copy'),
    );
    final staleSnapshot = await repository.exportSnapshot();
    await repository.deletePermanently('note');
    final deletedSnapshot = await repository.exportSnapshot();

    final targetDatabase = IdeallDatabase.forTesting(NativeDatabase.memory());
    final target = DriftLibraryRepository(
      targetDatabase,
      clock: () => now,
      idGenerator: () => 'target-${nextId++}',
    );
    addTearDown(targetDatabase.close);
    await target.importSnapshot(staleSnapshot, mode: ImportMode.replace);
    expect(await target.getNode('note'), isNotNull);

    await target.importSnapshot(
      deletedSnapshot,
      source: SnapshotImportSource.sync,
    );
    expect(await target.getNode('note'), isNull);

    await target.importSnapshot(staleSnapshot);
    expect(await target.getNode('note'), isNull);
    expect((await target.exportSnapshot()).tombstones.single.entityId, 'note');
  });

  test(
    'user merge keeps newer local records and local sync metadata',
    () async {
      final created = await repository.createNode(
        CreateNodeInput(id: 'note', kind: NodeKind.note, title: 'Current'),
      );
      await repository.updateNode(
        id: created.id,
        title: 'Current revision',
        expectedRevision: created.revision,
      );
      await repository.upsertSyncMetadata(
        SyncMetadata(
          scope: 'notes',
          versionVector: const {'this-device': 7},
          dirty: false,
        ),
      );
      final older = LibraryNode(
        id: 'note',
        kind: NodeKind.note,
        title: 'Old backup',
        document: DocumentContent.empty(),
        tags: const [],
        status: NodeStatus.active,
        createdAt: now.subtract(const Duration(days: 1)),
        updatedAt: now.subtract(const Duration(hours: 1)),
        revision: 1,
      );

      await repository.importSnapshot(
        LibrarySnapshot(
          exportedAt: now,
          nodes: [older],
          subscriptions: const [],
          publicationLinks: const [],
          syncMetadata: [
            SyncMetadata(
              scope: 'notes',
              versionVector: const {'foreign-device': 99},
              dirty: false,
            ),
          ],
          activity: const [],
        ),
      );

      expect((await repository.getNode('note'))!.title, 'Current revision');
      expect((await repository.getSyncMetadata('notes'))!.versionVector, const {
        'this-device': 7,
      });
    },
  );

  test('snapshot schema 1 remains readable with no tombstones', () {
    final legacy = LibrarySnapshot.fromJson(<String, Object?>{
      'schema': 'org.wonita.ideall.library-snapshot',
      'schema_version': 1,
      'exported_at_ms': now.millisecondsSinceEpoch,
      'nodes': const <Object?>[],
      'subscriptions': const <Object?>[],
      'publication_links': const <Object?>[],
      'sync_metadata': const <Object?>[],
      'activity': const <Object?>[],
    });

    expect(legacy.schemaVersion, 1);
    expect(legacy.tombstones, isEmpty);
  });

  test(
    'database schema 1 migrates without changing the database name',
    () async {
      final legacyExecutor = NativeDatabase.memory(
        setup: (raw) {
          raw.execute('''
          CREATE TABLE library_node_rows (
            id TEXT NOT NULL PRIMARY KEY,
            parent_id TEXT NULL REFERENCES library_node_rows(id)
              ON DELETE CASCADE,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            delta_json TEXT NOT NULL,
            plain_text TEXT NOT NULL DEFAULT '',
            url TEXT NULL,
            tags_json TEXT NOT NULL DEFAULT '[]',
            tags_text TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            deleted_at_ms INTEGER NULL,
            revision INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0
          )
        ''');
          raw.userVersion = 1;
        },
      );
      final migrated = IdeallDatabase.forTesting(legacyExecutor);
      addTearDown(migrated.close);

      expect(await migrated.select(migrated.syncTombstoneRows).get(), isEmpty);
      expect(IdeallDatabase.databaseFileName, 'ideall_terminal_v1.sqlite');
    },
  );
}
