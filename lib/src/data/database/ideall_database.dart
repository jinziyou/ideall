import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'ideall_database.g.dart';

@DataClassName('LibraryNodeRow')
@TableIndex(name: 'node_parent_status_idx', columns: {#parentId, #status})
@TableIndex(name: 'node_updated_idx', columns: {#updatedAtMs})
class LibraryNodeRows extends Table {
  TextColumn get id => text()();

  TextColumn get parentId => text().nullable().references(
    LibraryNodeRows,
    #id,
    onDelete: KeyAction.cascade,
  )();

  TextColumn get kind => text()();

  TextColumn get title => text()();

  TextColumn get deltaJson => text()();

  TextColumn get plainText => text().withDefault(const Constant(''))();

  TextColumn get url => text().nullable()();

  TextColumn get tagsJson => text().withDefault(const Constant('[]'))();

  TextColumn get tagsText => text().withDefault(const Constant(''))();

  TextColumn get status => text().withDefault(const Constant('active'))();

  IntColumn get createdAtMs => integer()();

  IntColumn get updatedAtMs => integer()();

  IntColumn get deletedAtMs => integer().nullable()();

  IntColumn get revision => integer().withDefault(const Constant(1))();

  IntColumn get sortOrder => integer().withDefault(const Constant(0))();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

@DataClassName('SubscriptionRow')
@TableIndex(name: 'subscription_target_idx', columns: {#kind, #targetId})
class SubscriptionRows extends Table {
  TextColumn get id => text()();

  TextColumn get kind => text()();

  TextColumn get targetId => text()();

  TextColumn get label => text()();

  TextColumn get metadataJson => text().withDefault(const Constant('{}'))();

  BoolColumn get enabled => boolean().withDefault(const Constant(true))();

  IntColumn get createdAtMs => integer()();

  IntColumn get updatedAtMs => integer()();

  IntColumn get revision => integer().withDefault(const Constant(1))();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

@DataClassName('PublicationLinkRow')
@TableIndex(name: 'publication_node_idx', columns: {#nodeId})
class PublicationLinkRows extends Table {
  TextColumn get publicationId => text()();

  TextColumn get nodeId => text().nullable().references(
    LibraryNodeRows,
    #id,
    onDelete: KeyAction.setNull,
  )();

  IntColumn get version => integer()();

  TextColumn get state => text()();

  TextColumn get visibility => text()();

  TextColumn get publicUrl => text().nullable()();

  IntColumn get lastPublishedAtMs => integer().nullable()();

  IntColumn get updatedAtMs => integer()();

  @override
  Set<Column<Object>> get primaryKey => {publicationId};
}

@DataClassName('SyncMetadataRow')
class SyncMetadataRows extends Table {
  TextColumn get scope => text()();

  TextColumn get localGeneration => text().nullable()();

  TextColumn get remoteGeneration => text().nullable()();

  TextColumn get manifestEtag => text().nullable()();

  TextColumn get vectorJson => text().withDefault(const Constant('{}'))();

  BoolColumn get dirty => boolean().withDefault(const Constant(false))();

  IntColumn get lastSyncedAtMs => integer().nullable()();

  TextColumn get error => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {scope};
}

@DataClassName('SyncTombstoneRow')
@TableIndex(name: 'sync_tombstone_deleted_idx', columns: {#deletedAtMs})
class SyncTombstoneRows extends Table {
  TextColumn get scope => text()();

  TextColumn get entityId => text()();

  IntColumn get deletedAtMs => integer()();

  IntColumn get revision => integer().withDefault(const Constant(1))();

  @override
  Set<Column<Object>> get primaryKey => {scope, entityId};
}

@DataClassName('ActivityRow')
@TableIndex(name: 'activity_time_idx', columns: {#occurredAtMs})
class ActivityRows extends Table {
  TextColumn get id => text()();

  TextColumn get type => text()();

  TextColumn get nodeId => text().nullable().references(
    LibraryNodeRows,
    #id,
    onDelete: KeyAction.setNull,
  )();

  IntColumn get occurredAtMs => integer()();

  TextColumn get detailsJson => text().withDefault(const Constant('{}'))();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// The app's fresh local store. Its explicit name intentionally differs from
/// the legacy app's `ideall.db` and no code in this layer ever opens that file.
@DriftDatabase(
  tables: [
    LibraryNodeRows,
    SubscriptionRows,
    PublicationLinkRows,
    SyncMetadataRows,
    SyncTombstoneRows,
    ActivityRows,
  ],
)
final class IdeallDatabase extends _$IdeallDatabase {
  IdeallDatabase() : super(driftDatabase(name: databaseBaseName));

  IdeallDatabase.forTesting(super.executor);

  static const databaseBaseName = 'ideall_terminal_v1';
  static const databaseFileName = '$databaseBaseName.sqlite';

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (migrator) async {
      await migrator.createAll();
      await _createSearchInfrastructure();
    },
    onUpgrade: (migrator, from, to) async {
      if (from < 2) {
        await migrator.createTable(syncTombstoneRows);
      }
    },
    beforeOpen: (details) async {
      await customStatement('PRAGMA foreign_keys = ON');
      if (!details.wasCreated) {
        await _createSearchInfrastructure();
      }
    },
  );

  Future<void> _createSearchInfrastructure() async {
    await customStatement('''
      CREATE VIRTUAL TABLE IF NOT EXISTS node_search USING fts5(
        title,
        plain_text,
        tags_text,
        content='library_node_rows',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      )
    ''');
    await customStatement('''
      CREATE TRIGGER IF NOT EXISTS node_search_insert
      AFTER INSERT ON library_node_rows BEGIN
        INSERT INTO node_search(rowid, title, plain_text, tags_text)
        VALUES (new.rowid, new.title, new.plain_text, new.tags_text);
      END
    ''');
    await customStatement('''
      CREATE TRIGGER IF NOT EXISTS node_search_delete
      AFTER DELETE ON library_node_rows BEGIN
        INSERT INTO node_search(node_search, rowid, title, plain_text, tags_text)
        VALUES ('delete', old.rowid, old.title, old.plain_text, old.tags_text);
      END
    ''');
    await customStatement('''
      CREATE TRIGGER IF NOT EXISTS node_search_update
      AFTER UPDATE ON library_node_rows BEGIN
        INSERT INTO node_search(node_search, rowid, title, plain_text, tags_text)
        VALUES ('delete', old.rowid, old.title, old.plain_text, old.tags_text);
        INSERT INTO node_search(rowid, title, plain_text, tags_text)
        VALUES (new.rowid, new.title, new.plain_text, new.tags_text);
      END
    ''');
    await customStatement(
      "INSERT INTO node_search(node_search) VALUES ('rebuild')",
    );
  }

  /// Rebuilds the contentless FTS index from the canonical node rows.
  Future<void> rebuildSearchIndex() => customStatement(
    "INSERT INTO node_search(node_search) VALUES ('rebuild')",
  );
}
