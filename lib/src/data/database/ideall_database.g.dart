// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ideall_database.dart';

// ignore_for_file: type=lint
class $LibraryNodeRowsTable extends LibraryNodeRows
    with TableInfo<$LibraryNodeRowsTable, LibraryNodeRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LibraryNodeRowsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _parentIdMeta = const VerificationMeta(
    'parentId',
  );
  @override
  late final GeneratedColumn<String> parentId = GeneratedColumn<String>(
    'parent_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'REFERENCES library_node_rows (id) ON DELETE CASCADE',
    ),
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _titleMeta = const VerificationMeta('title');
  @override
  late final GeneratedColumn<String> title = GeneratedColumn<String>(
    'title',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _deltaJsonMeta = const VerificationMeta(
    'deltaJson',
  );
  @override
  late final GeneratedColumn<String> deltaJson = GeneratedColumn<String>(
    'delta_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _plainTextMeta = const VerificationMeta(
    'plainText',
  );
  @override
  late final GeneratedColumn<String> plainText = GeneratedColumn<String>(
    'plain_text',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _urlMeta = const VerificationMeta('url');
  @override
  late final GeneratedColumn<String> url = GeneratedColumn<String>(
    'url',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _tagsJsonMeta = const VerificationMeta(
    'tagsJson',
  );
  @override
  late final GeneratedColumn<String> tagsJson = GeneratedColumn<String>(
    'tags_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('[]'),
  );
  static const VerificationMeta _tagsTextMeta = const VerificationMeta(
    'tagsText',
  );
  @override
  late final GeneratedColumn<String> tagsText = GeneratedColumn<String>(
    'tags_text',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('active'),
  );
  static const VerificationMeta _createdAtMsMeta = const VerificationMeta(
    'createdAtMs',
  );
  @override
  late final GeneratedColumn<int> createdAtMs = GeneratedColumn<int>(
    'created_at_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMsMeta = const VerificationMeta(
    'updatedAtMs',
  );
  @override
  late final GeneratedColumn<int> updatedAtMs = GeneratedColumn<int>(
    'updated_at_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _deletedAtMsMeta = const VerificationMeta(
    'deletedAtMs',
  );
  @override
  late final GeneratedColumn<int> deletedAtMs = GeneratedColumn<int>(
    'deleted_at_ms',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _revisionMeta = const VerificationMeta(
    'revision',
  );
  @override
  late final GeneratedColumn<int> revision = GeneratedColumn<int>(
    'revision',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(1),
  );
  static const VerificationMeta _sortOrderMeta = const VerificationMeta(
    'sortOrder',
  );
  @override
  late final GeneratedColumn<int> sortOrder = GeneratedColumn<int>(
    'sort_order',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    parentId,
    kind,
    title,
    deltaJson,
    plainText,
    url,
    tagsJson,
    tagsText,
    status,
    createdAtMs,
    updatedAtMs,
    deletedAtMs,
    revision,
    sortOrder,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'library_node_rows';
  @override
  VerificationContext validateIntegrity(
    Insertable<LibraryNodeRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('parent_id')) {
      context.handle(
        _parentIdMeta,
        parentId.isAcceptableOrUnknown(data['parent_id']!, _parentIdMeta),
      );
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('title')) {
      context.handle(
        _titleMeta,
        title.isAcceptableOrUnknown(data['title']!, _titleMeta),
      );
    } else if (isInserting) {
      context.missing(_titleMeta);
    }
    if (data.containsKey('delta_json')) {
      context.handle(
        _deltaJsonMeta,
        deltaJson.isAcceptableOrUnknown(data['delta_json']!, _deltaJsonMeta),
      );
    } else if (isInserting) {
      context.missing(_deltaJsonMeta);
    }
    if (data.containsKey('plain_text')) {
      context.handle(
        _plainTextMeta,
        plainText.isAcceptableOrUnknown(data['plain_text']!, _plainTextMeta),
      );
    }
    if (data.containsKey('url')) {
      context.handle(
        _urlMeta,
        url.isAcceptableOrUnknown(data['url']!, _urlMeta),
      );
    }
    if (data.containsKey('tags_json')) {
      context.handle(
        _tagsJsonMeta,
        tagsJson.isAcceptableOrUnknown(data['tags_json']!, _tagsJsonMeta),
      );
    }
    if (data.containsKey('tags_text')) {
      context.handle(
        _tagsTextMeta,
        tagsText.isAcceptableOrUnknown(data['tags_text']!, _tagsTextMeta),
      );
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    }
    if (data.containsKey('created_at_ms')) {
      context.handle(
        _createdAtMsMeta,
        createdAtMs.isAcceptableOrUnknown(
          data['created_at_ms']!,
          _createdAtMsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_createdAtMsMeta);
    }
    if (data.containsKey('updated_at_ms')) {
      context.handle(
        _updatedAtMsMeta,
        updatedAtMs.isAcceptableOrUnknown(
          data['updated_at_ms']!,
          _updatedAtMsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMsMeta);
    }
    if (data.containsKey('deleted_at_ms')) {
      context.handle(
        _deletedAtMsMeta,
        deletedAtMs.isAcceptableOrUnknown(
          data['deleted_at_ms']!,
          _deletedAtMsMeta,
        ),
      );
    }
    if (data.containsKey('revision')) {
      context.handle(
        _revisionMeta,
        revision.isAcceptableOrUnknown(data['revision']!, _revisionMeta),
      );
    }
    if (data.containsKey('sort_order')) {
      context.handle(
        _sortOrderMeta,
        sortOrder.isAcceptableOrUnknown(data['sort_order']!, _sortOrderMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  LibraryNodeRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LibraryNodeRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      parentId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}parent_id'],
      ),
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      title: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}title'],
      )!,
      deltaJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}delta_json'],
      )!,
      plainText: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}plain_text'],
      )!,
      url: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}url'],
      ),
      tagsJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}tags_json'],
      )!,
      tagsText: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}tags_text'],
      )!,
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      createdAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}created_at_ms'],
      )!,
      updatedAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}updated_at_ms'],
      )!,
      deletedAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}deleted_at_ms'],
      ),
      revision: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}revision'],
      )!,
      sortOrder: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}sort_order'],
      )!,
    );
  }

  @override
  $LibraryNodeRowsTable createAlias(String alias) {
    return $LibraryNodeRowsTable(attachedDatabase, alias);
  }
}

class LibraryNodeRow extends DataClass implements Insertable<LibraryNodeRow> {
  final String id;
  final String? parentId;
  final String kind;
  final String title;
  final String deltaJson;
  final String plainText;
  final String? url;
  final String tagsJson;
  final String tagsText;
  final String status;
  final int createdAtMs;
  final int updatedAtMs;
  final int? deletedAtMs;
  final int revision;
  final int sortOrder;
  const LibraryNodeRow({
    required this.id,
    this.parentId,
    required this.kind,
    required this.title,
    required this.deltaJson,
    required this.plainText,
    this.url,
    required this.tagsJson,
    required this.tagsText,
    required this.status,
    required this.createdAtMs,
    required this.updatedAtMs,
    this.deletedAtMs,
    required this.revision,
    required this.sortOrder,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    if (!nullToAbsent || parentId != null) {
      map['parent_id'] = Variable<String>(parentId);
    }
    map['kind'] = Variable<String>(kind);
    map['title'] = Variable<String>(title);
    map['delta_json'] = Variable<String>(deltaJson);
    map['plain_text'] = Variable<String>(plainText);
    if (!nullToAbsent || url != null) {
      map['url'] = Variable<String>(url);
    }
    map['tags_json'] = Variable<String>(tagsJson);
    map['tags_text'] = Variable<String>(tagsText);
    map['status'] = Variable<String>(status);
    map['created_at_ms'] = Variable<int>(createdAtMs);
    map['updated_at_ms'] = Variable<int>(updatedAtMs);
    if (!nullToAbsent || deletedAtMs != null) {
      map['deleted_at_ms'] = Variable<int>(deletedAtMs);
    }
    map['revision'] = Variable<int>(revision);
    map['sort_order'] = Variable<int>(sortOrder);
    return map;
  }

  LibraryNodeRowsCompanion toCompanion(bool nullToAbsent) {
    return LibraryNodeRowsCompanion(
      id: Value(id),
      parentId: parentId == null && nullToAbsent
          ? const Value.absent()
          : Value(parentId),
      kind: Value(kind),
      title: Value(title),
      deltaJson: Value(deltaJson),
      plainText: Value(plainText),
      url: url == null && nullToAbsent ? const Value.absent() : Value(url),
      tagsJson: Value(tagsJson),
      tagsText: Value(tagsText),
      status: Value(status),
      createdAtMs: Value(createdAtMs),
      updatedAtMs: Value(updatedAtMs),
      deletedAtMs: deletedAtMs == null && nullToAbsent
          ? const Value.absent()
          : Value(deletedAtMs),
      revision: Value(revision),
      sortOrder: Value(sortOrder),
    );
  }

  factory LibraryNodeRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LibraryNodeRow(
      id: serializer.fromJson<String>(json['id']),
      parentId: serializer.fromJson<String?>(json['parentId']),
      kind: serializer.fromJson<String>(json['kind']),
      title: serializer.fromJson<String>(json['title']),
      deltaJson: serializer.fromJson<String>(json['deltaJson']),
      plainText: serializer.fromJson<String>(json['plainText']),
      url: serializer.fromJson<String?>(json['url']),
      tagsJson: serializer.fromJson<String>(json['tagsJson']),
      tagsText: serializer.fromJson<String>(json['tagsText']),
      status: serializer.fromJson<String>(json['status']),
      createdAtMs: serializer.fromJson<int>(json['createdAtMs']),
      updatedAtMs: serializer.fromJson<int>(json['updatedAtMs']),
      deletedAtMs: serializer.fromJson<int?>(json['deletedAtMs']),
      revision: serializer.fromJson<int>(json['revision']),
      sortOrder: serializer.fromJson<int>(json['sortOrder']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'parentId': serializer.toJson<String?>(parentId),
      'kind': serializer.toJson<String>(kind),
      'title': serializer.toJson<String>(title),
      'deltaJson': serializer.toJson<String>(deltaJson),
      'plainText': serializer.toJson<String>(plainText),
      'url': serializer.toJson<String?>(url),
      'tagsJson': serializer.toJson<String>(tagsJson),
      'tagsText': serializer.toJson<String>(tagsText),
      'status': serializer.toJson<String>(status),
      'createdAtMs': serializer.toJson<int>(createdAtMs),
      'updatedAtMs': serializer.toJson<int>(updatedAtMs),
      'deletedAtMs': serializer.toJson<int?>(deletedAtMs),
      'revision': serializer.toJson<int>(revision),
      'sortOrder': serializer.toJson<int>(sortOrder),
    };
  }

  LibraryNodeRow copyWith({
    String? id,
    Value<String?> parentId = const Value.absent(),
    String? kind,
    String? title,
    String? deltaJson,
    String? plainText,
    Value<String?> url = const Value.absent(),
    String? tagsJson,
    String? tagsText,
    String? status,
    int? createdAtMs,
    int? updatedAtMs,
    Value<int?> deletedAtMs = const Value.absent(),
    int? revision,
    int? sortOrder,
  }) => LibraryNodeRow(
    id: id ?? this.id,
    parentId: parentId.present ? parentId.value : this.parentId,
    kind: kind ?? this.kind,
    title: title ?? this.title,
    deltaJson: deltaJson ?? this.deltaJson,
    plainText: plainText ?? this.plainText,
    url: url.present ? url.value : this.url,
    tagsJson: tagsJson ?? this.tagsJson,
    tagsText: tagsText ?? this.tagsText,
    status: status ?? this.status,
    createdAtMs: createdAtMs ?? this.createdAtMs,
    updatedAtMs: updatedAtMs ?? this.updatedAtMs,
    deletedAtMs: deletedAtMs.present ? deletedAtMs.value : this.deletedAtMs,
    revision: revision ?? this.revision,
    sortOrder: sortOrder ?? this.sortOrder,
  );
  LibraryNodeRow copyWithCompanion(LibraryNodeRowsCompanion data) {
    return LibraryNodeRow(
      id: data.id.present ? data.id.value : this.id,
      parentId: data.parentId.present ? data.parentId.value : this.parentId,
      kind: data.kind.present ? data.kind.value : this.kind,
      title: data.title.present ? data.title.value : this.title,
      deltaJson: data.deltaJson.present ? data.deltaJson.value : this.deltaJson,
      plainText: data.plainText.present ? data.plainText.value : this.plainText,
      url: data.url.present ? data.url.value : this.url,
      tagsJson: data.tagsJson.present ? data.tagsJson.value : this.tagsJson,
      tagsText: data.tagsText.present ? data.tagsText.value : this.tagsText,
      status: data.status.present ? data.status.value : this.status,
      createdAtMs: data.createdAtMs.present
          ? data.createdAtMs.value
          : this.createdAtMs,
      updatedAtMs: data.updatedAtMs.present
          ? data.updatedAtMs.value
          : this.updatedAtMs,
      deletedAtMs: data.deletedAtMs.present
          ? data.deletedAtMs.value
          : this.deletedAtMs,
      revision: data.revision.present ? data.revision.value : this.revision,
      sortOrder: data.sortOrder.present ? data.sortOrder.value : this.sortOrder,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LibraryNodeRow(')
          ..write('id: $id, ')
          ..write('parentId: $parentId, ')
          ..write('kind: $kind, ')
          ..write('title: $title, ')
          ..write('deltaJson: $deltaJson, ')
          ..write('plainText: $plainText, ')
          ..write('url: $url, ')
          ..write('tagsJson: $tagsJson, ')
          ..write('tagsText: $tagsText, ')
          ..write('status: $status, ')
          ..write('createdAtMs: $createdAtMs, ')
          ..write('updatedAtMs: $updatedAtMs, ')
          ..write('deletedAtMs: $deletedAtMs, ')
          ..write('revision: $revision, ')
          ..write('sortOrder: $sortOrder')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    parentId,
    kind,
    title,
    deltaJson,
    plainText,
    url,
    tagsJson,
    tagsText,
    status,
    createdAtMs,
    updatedAtMs,
    deletedAtMs,
    revision,
    sortOrder,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LibraryNodeRow &&
          other.id == this.id &&
          other.parentId == this.parentId &&
          other.kind == this.kind &&
          other.title == this.title &&
          other.deltaJson == this.deltaJson &&
          other.plainText == this.plainText &&
          other.url == this.url &&
          other.tagsJson == this.tagsJson &&
          other.tagsText == this.tagsText &&
          other.status == this.status &&
          other.createdAtMs == this.createdAtMs &&
          other.updatedAtMs == this.updatedAtMs &&
          other.deletedAtMs == this.deletedAtMs &&
          other.revision == this.revision &&
          other.sortOrder == this.sortOrder);
}

class LibraryNodeRowsCompanion extends UpdateCompanion<LibraryNodeRow> {
  final Value<String> id;
  final Value<String?> parentId;
  final Value<String> kind;
  final Value<String> title;
  final Value<String> deltaJson;
  final Value<String> plainText;
  final Value<String?> url;
  final Value<String> tagsJson;
  final Value<String> tagsText;
  final Value<String> status;
  final Value<int> createdAtMs;
  final Value<int> updatedAtMs;
  final Value<int?> deletedAtMs;
  final Value<int> revision;
  final Value<int> sortOrder;
  final Value<int> rowid;
  const LibraryNodeRowsCompanion({
    this.id = const Value.absent(),
    this.parentId = const Value.absent(),
    this.kind = const Value.absent(),
    this.title = const Value.absent(),
    this.deltaJson = const Value.absent(),
    this.plainText = const Value.absent(),
    this.url = const Value.absent(),
    this.tagsJson = const Value.absent(),
    this.tagsText = const Value.absent(),
    this.status = const Value.absent(),
    this.createdAtMs = const Value.absent(),
    this.updatedAtMs = const Value.absent(),
    this.deletedAtMs = const Value.absent(),
    this.revision = const Value.absent(),
    this.sortOrder = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LibraryNodeRowsCompanion.insert({
    required String id,
    this.parentId = const Value.absent(),
    required String kind,
    required String title,
    required String deltaJson,
    this.plainText = const Value.absent(),
    this.url = const Value.absent(),
    this.tagsJson = const Value.absent(),
    this.tagsText = const Value.absent(),
    this.status = const Value.absent(),
    required int createdAtMs,
    required int updatedAtMs,
    this.deletedAtMs = const Value.absent(),
    this.revision = const Value.absent(),
    this.sortOrder = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       kind = Value(kind),
       title = Value(title),
       deltaJson = Value(deltaJson),
       createdAtMs = Value(createdAtMs),
       updatedAtMs = Value(updatedAtMs);
  static Insertable<LibraryNodeRow> custom({
    Expression<String>? id,
    Expression<String>? parentId,
    Expression<String>? kind,
    Expression<String>? title,
    Expression<String>? deltaJson,
    Expression<String>? plainText,
    Expression<String>? url,
    Expression<String>? tagsJson,
    Expression<String>? tagsText,
    Expression<String>? status,
    Expression<int>? createdAtMs,
    Expression<int>? updatedAtMs,
    Expression<int>? deletedAtMs,
    Expression<int>? revision,
    Expression<int>? sortOrder,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (parentId != null) 'parent_id': parentId,
      if (kind != null) 'kind': kind,
      if (title != null) 'title': title,
      if (deltaJson != null) 'delta_json': deltaJson,
      if (plainText != null) 'plain_text': plainText,
      if (url != null) 'url': url,
      if (tagsJson != null) 'tags_json': tagsJson,
      if (tagsText != null) 'tags_text': tagsText,
      if (status != null) 'status': status,
      if (createdAtMs != null) 'created_at_ms': createdAtMs,
      if (updatedAtMs != null) 'updated_at_ms': updatedAtMs,
      if (deletedAtMs != null) 'deleted_at_ms': deletedAtMs,
      if (revision != null) 'revision': revision,
      if (sortOrder != null) 'sort_order': sortOrder,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LibraryNodeRowsCompanion copyWith({
    Value<String>? id,
    Value<String?>? parentId,
    Value<String>? kind,
    Value<String>? title,
    Value<String>? deltaJson,
    Value<String>? plainText,
    Value<String?>? url,
    Value<String>? tagsJson,
    Value<String>? tagsText,
    Value<String>? status,
    Value<int>? createdAtMs,
    Value<int>? updatedAtMs,
    Value<int?>? deletedAtMs,
    Value<int>? revision,
    Value<int>? sortOrder,
    Value<int>? rowid,
  }) {
    return LibraryNodeRowsCompanion(
      id: id ?? this.id,
      parentId: parentId ?? this.parentId,
      kind: kind ?? this.kind,
      title: title ?? this.title,
      deltaJson: deltaJson ?? this.deltaJson,
      plainText: plainText ?? this.plainText,
      url: url ?? this.url,
      tagsJson: tagsJson ?? this.tagsJson,
      tagsText: tagsText ?? this.tagsText,
      status: status ?? this.status,
      createdAtMs: createdAtMs ?? this.createdAtMs,
      updatedAtMs: updatedAtMs ?? this.updatedAtMs,
      deletedAtMs: deletedAtMs ?? this.deletedAtMs,
      revision: revision ?? this.revision,
      sortOrder: sortOrder ?? this.sortOrder,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (parentId.present) {
      map['parent_id'] = Variable<String>(parentId.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (title.present) {
      map['title'] = Variable<String>(title.value);
    }
    if (deltaJson.present) {
      map['delta_json'] = Variable<String>(deltaJson.value);
    }
    if (plainText.present) {
      map['plain_text'] = Variable<String>(plainText.value);
    }
    if (url.present) {
      map['url'] = Variable<String>(url.value);
    }
    if (tagsJson.present) {
      map['tags_json'] = Variable<String>(tagsJson.value);
    }
    if (tagsText.present) {
      map['tags_text'] = Variable<String>(tagsText.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (createdAtMs.present) {
      map['created_at_ms'] = Variable<int>(createdAtMs.value);
    }
    if (updatedAtMs.present) {
      map['updated_at_ms'] = Variable<int>(updatedAtMs.value);
    }
    if (deletedAtMs.present) {
      map['deleted_at_ms'] = Variable<int>(deletedAtMs.value);
    }
    if (revision.present) {
      map['revision'] = Variable<int>(revision.value);
    }
    if (sortOrder.present) {
      map['sort_order'] = Variable<int>(sortOrder.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LibraryNodeRowsCompanion(')
          ..write('id: $id, ')
          ..write('parentId: $parentId, ')
          ..write('kind: $kind, ')
          ..write('title: $title, ')
          ..write('deltaJson: $deltaJson, ')
          ..write('plainText: $plainText, ')
          ..write('url: $url, ')
          ..write('tagsJson: $tagsJson, ')
          ..write('tagsText: $tagsText, ')
          ..write('status: $status, ')
          ..write('createdAtMs: $createdAtMs, ')
          ..write('updatedAtMs: $updatedAtMs, ')
          ..write('deletedAtMs: $deletedAtMs, ')
          ..write('revision: $revision, ')
          ..write('sortOrder: $sortOrder, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SubscriptionRowsTable extends SubscriptionRows
    with TableInfo<$SubscriptionRowsTable, SubscriptionRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SubscriptionRowsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _targetIdMeta = const VerificationMeta(
    'targetId',
  );
  @override
  late final GeneratedColumn<String> targetId = GeneratedColumn<String>(
    'target_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _labelMeta = const VerificationMeta('label');
  @override
  late final GeneratedColumn<String> label = GeneratedColumn<String>(
    'label',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _metadataJsonMeta = const VerificationMeta(
    'metadataJson',
  );
  @override
  late final GeneratedColumn<String> metadataJson = GeneratedColumn<String>(
    'metadata_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('{}'),
  );
  static const VerificationMeta _enabledMeta = const VerificationMeta(
    'enabled',
  );
  @override
  late final GeneratedColumn<bool> enabled = GeneratedColumn<bool>(
    'enabled',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("enabled" IN (0, 1))',
    ),
    defaultValue: const Constant(true),
  );
  static const VerificationMeta _createdAtMsMeta = const VerificationMeta(
    'createdAtMs',
  );
  @override
  late final GeneratedColumn<int> createdAtMs = GeneratedColumn<int>(
    'created_at_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMsMeta = const VerificationMeta(
    'updatedAtMs',
  );
  @override
  late final GeneratedColumn<int> updatedAtMs = GeneratedColumn<int>(
    'updated_at_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _revisionMeta = const VerificationMeta(
    'revision',
  );
  @override
  late final GeneratedColumn<int> revision = GeneratedColumn<int>(
    'revision',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(1),
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    kind,
    targetId,
    label,
    metadataJson,
    enabled,
    createdAtMs,
    updatedAtMs,
    revision,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'subscription_rows';
  @override
  VerificationContext validateIntegrity(
    Insertable<SubscriptionRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('target_id')) {
      context.handle(
        _targetIdMeta,
        targetId.isAcceptableOrUnknown(data['target_id']!, _targetIdMeta),
      );
    } else if (isInserting) {
      context.missing(_targetIdMeta);
    }
    if (data.containsKey('label')) {
      context.handle(
        _labelMeta,
        label.isAcceptableOrUnknown(data['label']!, _labelMeta),
      );
    } else if (isInserting) {
      context.missing(_labelMeta);
    }
    if (data.containsKey('metadata_json')) {
      context.handle(
        _metadataJsonMeta,
        metadataJson.isAcceptableOrUnknown(
          data['metadata_json']!,
          _metadataJsonMeta,
        ),
      );
    }
    if (data.containsKey('enabled')) {
      context.handle(
        _enabledMeta,
        enabled.isAcceptableOrUnknown(data['enabled']!, _enabledMeta),
      );
    }
    if (data.containsKey('created_at_ms')) {
      context.handle(
        _createdAtMsMeta,
        createdAtMs.isAcceptableOrUnknown(
          data['created_at_ms']!,
          _createdAtMsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_createdAtMsMeta);
    }
    if (data.containsKey('updated_at_ms')) {
      context.handle(
        _updatedAtMsMeta,
        updatedAtMs.isAcceptableOrUnknown(
          data['updated_at_ms']!,
          _updatedAtMsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMsMeta);
    }
    if (data.containsKey('revision')) {
      context.handle(
        _revisionMeta,
        revision.isAcceptableOrUnknown(data['revision']!, _revisionMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  SubscriptionRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SubscriptionRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      targetId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}target_id'],
      )!,
      label: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}label'],
      )!,
      metadataJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}metadata_json'],
      )!,
      enabled: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}enabled'],
      )!,
      createdAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}created_at_ms'],
      )!,
      updatedAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}updated_at_ms'],
      )!,
      revision: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}revision'],
      )!,
    );
  }

  @override
  $SubscriptionRowsTable createAlias(String alias) {
    return $SubscriptionRowsTable(attachedDatabase, alias);
  }
}

class SubscriptionRow extends DataClass implements Insertable<SubscriptionRow> {
  final String id;
  final String kind;
  final String targetId;
  final String label;
  final String metadataJson;
  final bool enabled;
  final int createdAtMs;
  final int updatedAtMs;
  final int revision;
  const SubscriptionRow({
    required this.id,
    required this.kind,
    required this.targetId,
    required this.label,
    required this.metadataJson,
    required this.enabled,
    required this.createdAtMs,
    required this.updatedAtMs,
    required this.revision,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['kind'] = Variable<String>(kind);
    map['target_id'] = Variable<String>(targetId);
    map['label'] = Variable<String>(label);
    map['metadata_json'] = Variable<String>(metadataJson);
    map['enabled'] = Variable<bool>(enabled);
    map['created_at_ms'] = Variable<int>(createdAtMs);
    map['updated_at_ms'] = Variable<int>(updatedAtMs);
    map['revision'] = Variable<int>(revision);
    return map;
  }

  SubscriptionRowsCompanion toCompanion(bool nullToAbsent) {
    return SubscriptionRowsCompanion(
      id: Value(id),
      kind: Value(kind),
      targetId: Value(targetId),
      label: Value(label),
      metadataJson: Value(metadataJson),
      enabled: Value(enabled),
      createdAtMs: Value(createdAtMs),
      updatedAtMs: Value(updatedAtMs),
      revision: Value(revision),
    );
  }

  factory SubscriptionRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SubscriptionRow(
      id: serializer.fromJson<String>(json['id']),
      kind: serializer.fromJson<String>(json['kind']),
      targetId: serializer.fromJson<String>(json['targetId']),
      label: serializer.fromJson<String>(json['label']),
      metadataJson: serializer.fromJson<String>(json['metadataJson']),
      enabled: serializer.fromJson<bool>(json['enabled']),
      createdAtMs: serializer.fromJson<int>(json['createdAtMs']),
      updatedAtMs: serializer.fromJson<int>(json['updatedAtMs']),
      revision: serializer.fromJson<int>(json['revision']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'kind': serializer.toJson<String>(kind),
      'targetId': serializer.toJson<String>(targetId),
      'label': serializer.toJson<String>(label),
      'metadataJson': serializer.toJson<String>(metadataJson),
      'enabled': serializer.toJson<bool>(enabled),
      'createdAtMs': serializer.toJson<int>(createdAtMs),
      'updatedAtMs': serializer.toJson<int>(updatedAtMs),
      'revision': serializer.toJson<int>(revision),
    };
  }

  SubscriptionRow copyWith({
    String? id,
    String? kind,
    String? targetId,
    String? label,
    String? metadataJson,
    bool? enabled,
    int? createdAtMs,
    int? updatedAtMs,
    int? revision,
  }) => SubscriptionRow(
    id: id ?? this.id,
    kind: kind ?? this.kind,
    targetId: targetId ?? this.targetId,
    label: label ?? this.label,
    metadataJson: metadataJson ?? this.metadataJson,
    enabled: enabled ?? this.enabled,
    createdAtMs: createdAtMs ?? this.createdAtMs,
    updatedAtMs: updatedAtMs ?? this.updatedAtMs,
    revision: revision ?? this.revision,
  );
  SubscriptionRow copyWithCompanion(SubscriptionRowsCompanion data) {
    return SubscriptionRow(
      id: data.id.present ? data.id.value : this.id,
      kind: data.kind.present ? data.kind.value : this.kind,
      targetId: data.targetId.present ? data.targetId.value : this.targetId,
      label: data.label.present ? data.label.value : this.label,
      metadataJson: data.metadataJson.present
          ? data.metadataJson.value
          : this.metadataJson,
      enabled: data.enabled.present ? data.enabled.value : this.enabled,
      createdAtMs: data.createdAtMs.present
          ? data.createdAtMs.value
          : this.createdAtMs,
      updatedAtMs: data.updatedAtMs.present
          ? data.updatedAtMs.value
          : this.updatedAtMs,
      revision: data.revision.present ? data.revision.value : this.revision,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SubscriptionRow(')
          ..write('id: $id, ')
          ..write('kind: $kind, ')
          ..write('targetId: $targetId, ')
          ..write('label: $label, ')
          ..write('metadataJson: $metadataJson, ')
          ..write('enabled: $enabled, ')
          ..write('createdAtMs: $createdAtMs, ')
          ..write('updatedAtMs: $updatedAtMs, ')
          ..write('revision: $revision')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    kind,
    targetId,
    label,
    metadataJson,
    enabled,
    createdAtMs,
    updatedAtMs,
    revision,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SubscriptionRow &&
          other.id == this.id &&
          other.kind == this.kind &&
          other.targetId == this.targetId &&
          other.label == this.label &&
          other.metadataJson == this.metadataJson &&
          other.enabled == this.enabled &&
          other.createdAtMs == this.createdAtMs &&
          other.updatedAtMs == this.updatedAtMs &&
          other.revision == this.revision);
}

class SubscriptionRowsCompanion extends UpdateCompanion<SubscriptionRow> {
  final Value<String> id;
  final Value<String> kind;
  final Value<String> targetId;
  final Value<String> label;
  final Value<String> metadataJson;
  final Value<bool> enabled;
  final Value<int> createdAtMs;
  final Value<int> updatedAtMs;
  final Value<int> revision;
  final Value<int> rowid;
  const SubscriptionRowsCompanion({
    this.id = const Value.absent(),
    this.kind = const Value.absent(),
    this.targetId = const Value.absent(),
    this.label = const Value.absent(),
    this.metadataJson = const Value.absent(),
    this.enabled = const Value.absent(),
    this.createdAtMs = const Value.absent(),
    this.updatedAtMs = const Value.absent(),
    this.revision = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SubscriptionRowsCompanion.insert({
    required String id,
    required String kind,
    required String targetId,
    required String label,
    this.metadataJson = const Value.absent(),
    this.enabled = const Value.absent(),
    required int createdAtMs,
    required int updatedAtMs,
    this.revision = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       kind = Value(kind),
       targetId = Value(targetId),
       label = Value(label),
       createdAtMs = Value(createdAtMs),
       updatedAtMs = Value(updatedAtMs);
  static Insertable<SubscriptionRow> custom({
    Expression<String>? id,
    Expression<String>? kind,
    Expression<String>? targetId,
    Expression<String>? label,
    Expression<String>? metadataJson,
    Expression<bool>? enabled,
    Expression<int>? createdAtMs,
    Expression<int>? updatedAtMs,
    Expression<int>? revision,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (kind != null) 'kind': kind,
      if (targetId != null) 'target_id': targetId,
      if (label != null) 'label': label,
      if (metadataJson != null) 'metadata_json': metadataJson,
      if (enabled != null) 'enabled': enabled,
      if (createdAtMs != null) 'created_at_ms': createdAtMs,
      if (updatedAtMs != null) 'updated_at_ms': updatedAtMs,
      if (revision != null) 'revision': revision,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SubscriptionRowsCompanion copyWith({
    Value<String>? id,
    Value<String>? kind,
    Value<String>? targetId,
    Value<String>? label,
    Value<String>? metadataJson,
    Value<bool>? enabled,
    Value<int>? createdAtMs,
    Value<int>? updatedAtMs,
    Value<int>? revision,
    Value<int>? rowid,
  }) {
    return SubscriptionRowsCompanion(
      id: id ?? this.id,
      kind: kind ?? this.kind,
      targetId: targetId ?? this.targetId,
      label: label ?? this.label,
      metadataJson: metadataJson ?? this.metadataJson,
      enabled: enabled ?? this.enabled,
      createdAtMs: createdAtMs ?? this.createdAtMs,
      updatedAtMs: updatedAtMs ?? this.updatedAtMs,
      revision: revision ?? this.revision,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (targetId.present) {
      map['target_id'] = Variable<String>(targetId.value);
    }
    if (label.present) {
      map['label'] = Variable<String>(label.value);
    }
    if (metadataJson.present) {
      map['metadata_json'] = Variable<String>(metadataJson.value);
    }
    if (enabled.present) {
      map['enabled'] = Variable<bool>(enabled.value);
    }
    if (createdAtMs.present) {
      map['created_at_ms'] = Variable<int>(createdAtMs.value);
    }
    if (updatedAtMs.present) {
      map['updated_at_ms'] = Variable<int>(updatedAtMs.value);
    }
    if (revision.present) {
      map['revision'] = Variable<int>(revision.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SubscriptionRowsCompanion(')
          ..write('id: $id, ')
          ..write('kind: $kind, ')
          ..write('targetId: $targetId, ')
          ..write('label: $label, ')
          ..write('metadataJson: $metadataJson, ')
          ..write('enabled: $enabled, ')
          ..write('createdAtMs: $createdAtMs, ')
          ..write('updatedAtMs: $updatedAtMs, ')
          ..write('revision: $revision, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $PublicationLinkRowsTable extends PublicationLinkRows
    with TableInfo<$PublicationLinkRowsTable, PublicationLinkRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PublicationLinkRowsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _publicationIdMeta = const VerificationMeta(
    'publicationId',
  );
  @override
  late final GeneratedColumn<String> publicationId = GeneratedColumn<String>(
    'publication_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nodeIdMeta = const VerificationMeta('nodeId');
  @override
  late final GeneratedColumn<String> nodeId = GeneratedColumn<String>(
    'node_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'REFERENCES library_node_rows (id) ON DELETE SET NULL',
    ),
  );
  static const VerificationMeta _versionMeta = const VerificationMeta(
    'version',
  );
  @override
  late final GeneratedColumn<int> version = GeneratedColumn<int>(
    'version',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _stateMeta = const VerificationMeta('state');
  @override
  late final GeneratedColumn<String> state = GeneratedColumn<String>(
    'state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _visibilityMeta = const VerificationMeta(
    'visibility',
  );
  @override
  late final GeneratedColumn<String> visibility = GeneratedColumn<String>(
    'visibility',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _publicUrlMeta = const VerificationMeta(
    'publicUrl',
  );
  @override
  late final GeneratedColumn<String> publicUrl = GeneratedColumn<String>(
    'public_url',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastPublishedAtMsMeta = const VerificationMeta(
    'lastPublishedAtMs',
  );
  @override
  late final GeneratedColumn<int> lastPublishedAtMs = GeneratedColumn<int>(
    'last_published_at_ms',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _updatedAtMsMeta = const VerificationMeta(
    'updatedAtMs',
  );
  @override
  late final GeneratedColumn<int> updatedAtMs = GeneratedColumn<int>(
    'updated_at_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    publicationId,
    nodeId,
    version,
    state,
    visibility,
    publicUrl,
    lastPublishedAtMs,
    updatedAtMs,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'publication_link_rows';
  @override
  VerificationContext validateIntegrity(
    Insertable<PublicationLinkRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('publication_id')) {
      context.handle(
        _publicationIdMeta,
        publicationId.isAcceptableOrUnknown(
          data['publication_id']!,
          _publicationIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_publicationIdMeta);
    }
    if (data.containsKey('node_id')) {
      context.handle(
        _nodeIdMeta,
        nodeId.isAcceptableOrUnknown(data['node_id']!, _nodeIdMeta),
      );
    }
    if (data.containsKey('version')) {
      context.handle(
        _versionMeta,
        version.isAcceptableOrUnknown(data['version']!, _versionMeta),
      );
    } else if (isInserting) {
      context.missing(_versionMeta);
    }
    if (data.containsKey('state')) {
      context.handle(
        _stateMeta,
        state.isAcceptableOrUnknown(data['state']!, _stateMeta),
      );
    } else if (isInserting) {
      context.missing(_stateMeta);
    }
    if (data.containsKey('visibility')) {
      context.handle(
        _visibilityMeta,
        visibility.isAcceptableOrUnknown(data['visibility']!, _visibilityMeta),
      );
    } else if (isInserting) {
      context.missing(_visibilityMeta);
    }
    if (data.containsKey('public_url')) {
      context.handle(
        _publicUrlMeta,
        publicUrl.isAcceptableOrUnknown(data['public_url']!, _publicUrlMeta),
      );
    }
    if (data.containsKey('last_published_at_ms')) {
      context.handle(
        _lastPublishedAtMsMeta,
        lastPublishedAtMs.isAcceptableOrUnknown(
          data['last_published_at_ms']!,
          _lastPublishedAtMsMeta,
        ),
      );
    }
    if (data.containsKey('updated_at_ms')) {
      context.handle(
        _updatedAtMsMeta,
        updatedAtMs.isAcceptableOrUnknown(
          data['updated_at_ms']!,
          _updatedAtMsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMsMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {publicationId};
  @override
  PublicationLinkRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PublicationLinkRow(
      publicationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}publication_id'],
      )!,
      nodeId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}node_id'],
      ),
      version: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}version'],
      )!,
      state: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}state'],
      )!,
      visibility: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}visibility'],
      )!,
      publicUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}public_url'],
      ),
      lastPublishedAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}last_published_at_ms'],
      ),
      updatedAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}updated_at_ms'],
      )!,
    );
  }

  @override
  $PublicationLinkRowsTable createAlias(String alias) {
    return $PublicationLinkRowsTable(attachedDatabase, alias);
  }
}

class PublicationLinkRow extends DataClass
    implements Insertable<PublicationLinkRow> {
  final String publicationId;
  final String? nodeId;
  final int version;
  final String state;
  final String visibility;
  final String? publicUrl;
  final int? lastPublishedAtMs;
  final int updatedAtMs;
  const PublicationLinkRow({
    required this.publicationId,
    this.nodeId,
    required this.version,
    required this.state,
    required this.visibility,
    this.publicUrl,
    this.lastPublishedAtMs,
    required this.updatedAtMs,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['publication_id'] = Variable<String>(publicationId);
    if (!nullToAbsent || nodeId != null) {
      map['node_id'] = Variable<String>(nodeId);
    }
    map['version'] = Variable<int>(version);
    map['state'] = Variable<String>(state);
    map['visibility'] = Variable<String>(visibility);
    if (!nullToAbsent || publicUrl != null) {
      map['public_url'] = Variable<String>(publicUrl);
    }
    if (!nullToAbsent || lastPublishedAtMs != null) {
      map['last_published_at_ms'] = Variable<int>(lastPublishedAtMs);
    }
    map['updated_at_ms'] = Variable<int>(updatedAtMs);
    return map;
  }

  PublicationLinkRowsCompanion toCompanion(bool nullToAbsent) {
    return PublicationLinkRowsCompanion(
      publicationId: Value(publicationId),
      nodeId: nodeId == null && nullToAbsent
          ? const Value.absent()
          : Value(nodeId),
      version: Value(version),
      state: Value(state),
      visibility: Value(visibility),
      publicUrl: publicUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(publicUrl),
      lastPublishedAtMs: lastPublishedAtMs == null && nullToAbsent
          ? const Value.absent()
          : Value(lastPublishedAtMs),
      updatedAtMs: Value(updatedAtMs),
    );
  }

  factory PublicationLinkRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PublicationLinkRow(
      publicationId: serializer.fromJson<String>(json['publicationId']),
      nodeId: serializer.fromJson<String?>(json['nodeId']),
      version: serializer.fromJson<int>(json['version']),
      state: serializer.fromJson<String>(json['state']),
      visibility: serializer.fromJson<String>(json['visibility']),
      publicUrl: serializer.fromJson<String?>(json['publicUrl']),
      lastPublishedAtMs: serializer.fromJson<int?>(json['lastPublishedAtMs']),
      updatedAtMs: serializer.fromJson<int>(json['updatedAtMs']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'publicationId': serializer.toJson<String>(publicationId),
      'nodeId': serializer.toJson<String?>(nodeId),
      'version': serializer.toJson<int>(version),
      'state': serializer.toJson<String>(state),
      'visibility': serializer.toJson<String>(visibility),
      'publicUrl': serializer.toJson<String?>(publicUrl),
      'lastPublishedAtMs': serializer.toJson<int?>(lastPublishedAtMs),
      'updatedAtMs': serializer.toJson<int>(updatedAtMs),
    };
  }

  PublicationLinkRow copyWith({
    String? publicationId,
    Value<String?> nodeId = const Value.absent(),
    int? version,
    String? state,
    String? visibility,
    Value<String?> publicUrl = const Value.absent(),
    Value<int?> lastPublishedAtMs = const Value.absent(),
    int? updatedAtMs,
  }) => PublicationLinkRow(
    publicationId: publicationId ?? this.publicationId,
    nodeId: nodeId.present ? nodeId.value : this.nodeId,
    version: version ?? this.version,
    state: state ?? this.state,
    visibility: visibility ?? this.visibility,
    publicUrl: publicUrl.present ? publicUrl.value : this.publicUrl,
    lastPublishedAtMs: lastPublishedAtMs.present
        ? lastPublishedAtMs.value
        : this.lastPublishedAtMs,
    updatedAtMs: updatedAtMs ?? this.updatedAtMs,
  );
  PublicationLinkRow copyWithCompanion(PublicationLinkRowsCompanion data) {
    return PublicationLinkRow(
      publicationId: data.publicationId.present
          ? data.publicationId.value
          : this.publicationId,
      nodeId: data.nodeId.present ? data.nodeId.value : this.nodeId,
      version: data.version.present ? data.version.value : this.version,
      state: data.state.present ? data.state.value : this.state,
      visibility: data.visibility.present
          ? data.visibility.value
          : this.visibility,
      publicUrl: data.publicUrl.present ? data.publicUrl.value : this.publicUrl,
      lastPublishedAtMs: data.lastPublishedAtMs.present
          ? data.lastPublishedAtMs.value
          : this.lastPublishedAtMs,
      updatedAtMs: data.updatedAtMs.present
          ? data.updatedAtMs.value
          : this.updatedAtMs,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PublicationLinkRow(')
          ..write('publicationId: $publicationId, ')
          ..write('nodeId: $nodeId, ')
          ..write('version: $version, ')
          ..write('state: $state, ')
          ..write('visibility: $visibility, ')
          ..write('publicUrl: $publicUrl, ')
          ..write('lastPublishedAtMs: $lastPublishedAtMs, ')
          ..write('updatedAtMs: $updatedAtMs')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    publicationId,
    nodeId,
    version,
    state,
    visibility,
    publicUrl,
    lastPublishedAtMs,
    updatedAtMs,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PublicationLinkRow &&
          other.publicationId == this.publicationId &&
          other.nodeId == this.nodeId &&
          other.version == this.version &&
          other.state == this.state &&
          other.visibility == this.visibility &&
          other.publicUrl == this.publicUrl &&
          other.lastPublishedAtMs == this.lastPublishedAtMs &&
          other.updatedAtMs == this.updatedAtMs);
}

class PublicationLinkRowsCompanion extends UpdateCompanion<PublicationLinkRow> {
  final Value<String> publicationId;
  final Value<String?> nodeId;
  final Value<int> version;
  final Value<String> state;
  final Value<String> visibility;
  final Value<String?> publicUrl;
  final Value<int?> lastPublishedAtMs;
  final Value<int> updatedAtMs;
  final Value<int> rowid;
  const PublicationLinkRowsCompanion({
    this.publicationId = const Value.absent(),
    this.nodeId = const Value.absent(),
    this.version = const Value.absent(),
    this.state = const Value.absent(),
    this.visibility = const Value.absent(),
    this.publicUrl = const Value.absent(),
    this.lastPublishedAtMs = const Value.absent(),
    this.updatedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  PublicationLinkRowsCompanion.insert({
    required String publicationId,
    this.nodeId = const Value.absent(),
    required int version,
    required String state,
    required String visibility,
    this.publicUrl = const Value.absent(),
    this.lastPublishedAtMs = const Value.absent(),
    required int updatedAtMs,
    this.rowid = const Value.absent(),
  }) : publicationId = Value(publicationId),
       version = Value(version),
       state = Value(state),
       visibility = Value(visibility),
       updatedAtMs = Value(updatedAtMs);
  static Insertable<PublicationLinkRow> custom({
    Expression<String>? publicationId,
    Expression<String>? nodeId,
    Expression<int>? version,
    Expression<String>? state,
    Expression<String>? visibility,
    Expression<String>? publicUrl,
    Expression<int>? lastPublishedAtMs,
    Expression<int>? updatedAtMs,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (publicationId != null) 'publication_id': publicationId,
      if (nodeId != null) 'node_id': nodeId,
      if (version != null) 'version': version,
      if (state != null) 'state': state,
      if (visibility != null) 'visibility': visibility,
      if (publicUrl != null) 'public_url': publicUrl,
      if (lastPublishedAtMs != null) 'last_published_at_ms': lastPublishedAtMs,
      if (updatedAtMs != null) 'updated_at_ms': updatedAtMs,
      if (rowid != null) 'rowid': rowid,
    });
  }

  PublicationLinkRowsCompanion copyWith({
    Value<String>? publicationId,
    Value<String?>? nodeId,
    Value<int>? version,
    Value<String>? state,
    Value<String>? visibility,
    Value<String?>? publicUrl,
    Value<int?>? lastPublishedAtMs,
    Value<int>? updatedAtMs,
    Value<int>? rowid,
  }) {
    return PublicationLinkRowsCompanion(
      publicationId: publicationId ?? this.publicationId,
      nodeId: nodeId ?? this.nodeId,
      version: version ?? this.version,
      state: state ?? this.state,
      visibility: visibility ?? this.visibility,
      publicUrl: publicUrl ?? this.publicUrl,
      lastPublishedAtMs: lastPublishedAtMs ?? this.lastPublishedAtMs,
      updatedAtMs: updatedAtMs ?? this.updatedAtMs,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (publicationId.present) {
      map['publication_id'] = Variable<String>(publicationId.value);
    }
    if (nodeId.present) {
      map['node_id'] = Variable<String>(nodeId.value);
    }
    if (version.present) {
      map['version'] = Variable<int>(version.value);
    }
    if (state.present) {
      map['state'] = Variable<String>(state.value);
    }
    if (visibility.present) {
      map['visibility'] = Variable<String>(visibility.value);
    }
    if (publicUrl.present) {
      map['public_url'] = Variable<String>(publicUrl.value);
    }
    if (lastPublishedAtMs.present) {
      map['last_published_at_ms'] = Variable<int>(lastPublishedAtMs.value);
    }
    if (updatedAtMs.present) {
      map['updated_at_ms'] = Variable<int>(updatedAtMs.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PublicationLinkRowsCompanion(')
          ..write('publicationId: $publicationId, ')
          ..write('nodeId: $nodeId, ')
          ..write('version: $version, ')
          ..write('state: $state, ')
          ..write('visibility: $visibility, ')
          ..write('publicUrl: $publicUrl, ')
          ..write('lastPublishedAtMs: $lastPublishedAtMs, ')
          ..write('updatedAtMs: $updatedAtMs, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SyncMetadataRowsTable extends SyncMetadataRows
    with TableInfo<$SyncMetadataRowsTable, SyncMetadataRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SyncMetadataRowsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _scopeMeta = const VerificationMeta('scope');
  @override
  late final GeneratedColumn<String> scope = GeneratedColumn<String>(
    'scope',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _localGenerationMeta = const VerificationMeta(
    'localGeneration',
  );
  @override
  late final GeneratedColumn<String> localGeneration = GeneratedColumn<String>(
    'local_generation',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _remoteGenerationMeta = const VerificationMeta(
    'remoteGeneration',
  );
  @override
  late final GeneratedColumn<String> remoteGeneration = GeneratedColumn<String>(
    'remote_generation',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _manifestEtagMeta = const VerificationMeta(
    'manifestEtag',
  );
  @override
  late final GeneratedColumn<String> manifestEtag = GeneratedColumn<String>(
    'manifest_etag',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _vectorJsonMeta = const VerificationMeta(
    'vectorJson',
  );
  @override
  late final GeneratedColumn<String> vectorJson = GeneratedColumn<String>(
    'vector_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('{}'),
  );
  static const VerificationMeta _dirtyMeta = const VerificationMeta('dirty');
  @override
  late final GeneratedColumn<bool> dirty = GeneratedColumn<bool>(
    'dirty',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("dirty" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _lastSyncedAtMsMeta = const VerificationMeta(
    'lastSyncedAtMs',
  );
  @override
  late final GeneratedColumn<int> lastSyncedAtMs = GeneratedColumn<int>(
    'last_synced_at_ms',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _errorMeta = const VerificationMeta('error');
  @override
  late final GeneratedColumn<String> error = GeneratedColumn<String>(
    'error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    scope,
    localGeneration,
    remoteGeneration,
    manifestEtag,
    vectorJson,
    dirty,
    lastSyncedAtMs,
    error,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sync_metadata_rows';
  @override
  VerificationContext validateIntegrity(
    Insertable<SyncMetadataRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('scope')) {
      context.handle(
        _scopeMeta,
        scope.isAcceptableOrUnknown(data['scope']!, _scopeMeta),
      );
    } else if (isInserting) {
      context.missing(_scopeMeta);
    }
    if (data.containsKey('local_generation')) {
      context.handle(
        _localGenerationMeta,
        localGeneration.isAcceptableOrUnknown(
          data['local_generation']!,
          _localGenerationMeta,
        ),
      );
    }
    if (data.containsKey('remote_generation')) {
      context.handle(
        _remoteGenerationMeta,
        remoteGeneration.isAcceptableOrUnknown(
          data['remote_generation']!,
          _remoteGenerationMeta,
        ),
      );
    }
    if (data.containsKey('manifest_etag')) {
      context.handle(
        _manifestEtagMeta,
        manifestEtag.isAcceptableOrUnknown(
          data['manifest_etag']!,
          _manifestEtagMeta,
        ),
      );
    }
    if (data.containsKey('vector_json')) {
      context.handle(
        _vectorJsonMeta,
        vectorJson.isAcceptableOrUnknown(data['vector_json']!, _vectorJsonMeta),
      );
    }
    if (data.containsKey('dirty')) {
      context.handle(
        _dirtyMeta,
        dirty.isAcceptableOrUnknown(data['dirty']!, _dirtyMeta),
      );
    }
    if (data.containsKey('last_synced_at_ms')) {
      context.handle(
        _lastSyncedAtMsMeta,
        lastSyncedAtMs.isAcceptableOrUnknown(
          data['last_synced_at_ms']!,
          _lastSyncedAtMsMeta,
        ),
      );
    }
    if (data.containsKey('error')) {
      context.handle(
        _errorMeta,
        error.isAcceptableOrUnknown(data['error']!, _errorMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {scope};
  @override
  SyncMetadataRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SyncMetadataRow(
      scope: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}scope'],
      )!,
      localGeneration: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}local_generation'],
      ),
      remoteGeneration: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}remote_generation'],
      ),
      manifestEtag: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}manifest_etag'],
      ),
      vectorJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}vector_json'],
      )!,
      dirty: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}dirty'],
      )!,
      lastSyncedAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}last_synced_at_ms'],
      ),
      error: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}error'],
      ),
    );
  }

  @override
  $SyncMetadataRowsTable createAlias(String alias) {
    return $SyncMetadataRowsTable(attachedDatabase, alias);
  }
}

class SyncMetadataRow extends DataClass implements Insertable<SyncMetadataRow> {
  final String scope;
  final String? localGeneration;
  final String? remoteGeneration;
  final String? manifestEtag;
  final String vectorJson;
  final bool dirty;
  final int? lastSyncedAtMs;
  final String? error;
  const SyncMetadataRow({
    required this.scope,
    this.localGeneration,
    this.remoteGeneration,
    this.manifestEtag,
    required this.vectorJson,
    required this.dirty,
    this.lastSyncedAtMs,
    this.error,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['scope'] = Variable<String>(scope);
    if (!nullToAbsent || localGeneration != null) {
      map['local_generation'] = Variable<String>(localGeneration);
    }
    if (!nullToAbsent || remoteGeneration != null) {
      map['remote_generation'] = Variable<String>(remoteGeneration);
    }
    if (!nullToAbsent || manifestEtag != null) {
      map['manifest_etag'] = Variable<String>(manifestEtag);
    }
    map['vector_json'] = Variable<String>(vectorJson);
    map['dirty'] = Variable<bool>(dirty);
    if (!nullToAbsent || lastSyncedAtMs != null) {
      map['last_synced_at_ms'] = Variable<int>(lastSyncedAtMs);
    }
    if (!nullToAbsent || error != null) {
      map['error'] = Variable<String>(error);
    }
    return map;
  }

  SyncMetadataRowsCompanion toCompanion(bool nullToAbsent) {
    return SyncMetadataRowsCompanion(
      scope: Value(scope),
      localGeneration: localGeneration == null && nullToAbsent
          ? const Value.absent()
          : Value(localGeneration),
      remoteGeneration: remoteGeneration == null && nullToAbsent
          ? const Value.absent()
          : Value(remoteGeneration),
      manifestEtag: manifestEtag == null && nullToAbsent
          ? const Value.absent()
          : Value(manifestEtag),
      vectorJson: Value(vectorJson),
      dirty: Value(dirty),
      lastSyncedAtMs: lastSyncedAtMs == null && nullToAbsent
          ? const Value.absent()
          : Value(lastSyncedAtMs),
      error: error == null && nullToAbsent
          ? const Value.absent()
          : Value(error),
    );
  }

  factory SyncMetadataRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SyncMetadataRow(
      scope: serializer.fromJson<String>(json['scope']),
      localGeneration: serializer.fromJson<String?>(json['localGeneration']),
      remoteGeneration: serializer.fromJson<String?>(json['remoteGeneration']),
      manifestEtag: serializer.fromJson<String?>(json['manifestEtag']),
      vectorJson: serializer.fromJson<String>(json['vectorJson']),
      dirty: serializer.fromJson<bool>(json['dirty']),
      lastSyncedAtMs: serializer.fromJson<int?>(json['lastSyncedAtMs']),
      error: serializer.fromJson<String?>(json['error']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'scope': serializer.toJson<String>(scope),
      'localGeneration': serializer.toJson<String?>(localGeneration),
      'remoteGeneration': serializer.toJson<String?>(remoteGeneration),
      'manifestEtag': serializer.toJson<String?>(manifestEtag),
      'vectorJson': serializer.toJson<String>(vectorJson),
      'dirty': serializer.toJson<bool>(dirty),
      'lastSyncedAtMs': serializer.toJson<int?>(lastSyncedAtMs),
      'error': serializer.toJson<String?>(error),
    };
  }

  SyncMetadataRow copyWith({
    String? scope,
    Value<String?> localGeneration = const Value.absent(),
    Value<String?> remoteGeneration = const Value.absent(),
    Value<String?> manifestEtag = const Value.absent(),
    String? vectorJson,
    bool? dirty,
    Value<int?> lastSyncedAtMs = const Value.absent(),
    Value<String?> error = const Value.absent(),
  }) => SyncMetadataRow(
    scope: scope ?? this.scope,
    localGeneration: localGeneration.present
        ? localGeneration.value
        : this.localGeneration,
    remoteGeneration: remoteGeneration.present
        ? remoteGeneration.value
        : this.remoteGeneration,
    manifestEtag: manifestEtag.present ? manifestEtag.value : this.manifestEtag,
    vectorJson: vectorJson ?? this.vectorJson,
    dirty: dirty ?? this.dirty,
    lastSyncedAtMs: lastSyncedAtMs.present
        ? lastSyncedAtMs.value
        : this.lastSyncedAtMs,
    error: error.present ? error.value : this.error,
  );
  SyncMetadataRow copyWithCompanion(SyncMetadataRowsCompanion data) {
    return SyncMetadataRow(
      scope: data.scope.present ? data.scope.value : this.scope,
      localGeneration: data.localGeneration.present
          ? data.localGeneration.value
          : this.localGeneration,
      remoteGeneration: data.remoteGeneration.present
          ? data.remoteGeneration.value
          : this.remoteGeneration,
      manifestEtag: data.manifestEtag.present
          ? data.manifestEtag.value
          : this.manifestEtag,
      vectorJson: data.vectorJson.present
          ? data.vectorJson.value
          : this.vectorJson,
      dirty: data.dirty.present ? data.dirty.value : this.dirty,
      lastSyncedAtMs: data.lastSyncedAtMs.present
          ? data.lastSyncedAtMs.value
          : this.lastSyncedAtMs,
      error: data.error.present ? data.error.value : this.error,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SyncMetadataRow(')
          ..write('scope: $scope, ')
          ..write('localGeneration: $localGeneration, ')
          ..write('remoteGeneration: $remoteGeneration, ')
          ..write('manifestEtag: $manifestEtag, ')
          ..write('vectorJson: $vectorJson, ')
          ..write('dirty: $dirty, ')
          ..write('lastSyncedAtMs: $lastSyncedAtMs, ')
          ..write('error: $error')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    scope,
    localGeneration,
    remoteGeneration,
    manifestEtag,
    vectorJson,
    dirty,
    lastSyncedAtMs,
    error,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SyncMetadataRow &&
          other.scope == this.scope &&
          other.localGeneration == this.localGeneration &&
          other.remoteGeneration == this.remoteGeneration &&
          other.manifestEtag == this.manifestEtag &&
          other.vectorJson == this.vectorJson &&
          other.dirty == this.dirty &&
          other.lastSyncedAtMs == this.lastSyncedAtMs &&
          other.error == this.error);
}

class SyncMetadataRowsCompanion extends UpdateCompanion<SyncMetadataRow> {
  final Value<String> scope;
  final Value<String?> localGeneration;
  final Value<String?> remoteGeneration;
  final Value<String?> manifestEtag;
  final Value<String> vectorJson;
  final Value<bool> dirty;
  final Value<int?> lastSyncedAtMs;
  final Value<String?> error;
  final Value<int> rowid;
  const SyncMetadataRowsCompanion({
    this.scope = const Value.absent(),
    this.localGeneration = const Value.absent(),
    this.remoteGeneration = const Value.absent(),
    this.manifestEtag = const Value.absent(),
    this.vectorJson = const Value.absent(),
    this.dirty = const Value.absent(),
    this.lastSyncedAtMs = const Value.absent(),
    this.error = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SyncMetadataRowsCompanion.insert({
    required String scope,
    this.localGeneration = const Value.absent(),
    this.remoteGeneration = const Value.absent(),
    this.manifestEtag = const Value.absent(),
    this.vectorJson = const Value.absent(),
    this.dirty = const Value.absent(),
    this.lastSyncedAtMs = const Value.absent(),
    this.error = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : scope = Value(scope);
  static Insertable<SyncMetadataRow> custom({
    Expression<String>? scope,
    Expression<String>? localGeneration,
    Expression<String>? remoteGeneration,
    Expression<String>? manifestEtag,
    Expression<String>? vectorJson,
    Expression<bool>? dirty,
    Expression<int>? lastSyncedAtMs,
    Expression<String>? error,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (scope != null) 'scope': scope,
      if (localGeneration != null) 'local_generation': localGeneration,
      if (remoteGeneration != null) 'remote_generation': remoteGeneration,
      if (manifestEtag != null) 'manifest_etag': manifestEtag,
      if (vectorJson != null) 'vector_json': vectorJson,
      if (dirty != null) 'dirty': dirty,
      if (lastSyncedAtMs != null) 'last_synced_at_ms': lastSyncedAtMs,
      if (error != null) 'error': error,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SyncMetadataRowsCompanion copyWith({
    Value<String>? scope,
    Value<String?>? localGeneration,
    Value<String?>? remoteGeneration,
    Value<String?>? manifestEtag,
    Value<String>? vectorJson,
    Value<bool>? dirty,
    Value<int?>? lastSyncedAtMs,
    Value<String?>? error,
    Value<int>? rowid,
  }) {
    return SyncMetadataRowsCompanion(
      scope: scope ?? this.scope,
      localGeneration: localGeneration ?? this.localGeneration,
      remoteGeneration: remoteGeneration ?? this.remoteGeneration,
      manifestEtag: manifestEtag ?? this.manifestEtag,
      vectorJson: vectorJson ?? this.vectorJson,
      dirty: dirty ?? this.dirty,
      lastSyncedAtMs: lastSyncedAtMs ?? this.lastSyncedAtMs,
      error: error ?? this.error,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (scope.present) {
      map['scope'] = Variable<String>(scope.value);
    }
    if (localGeneration.present) {
      map['local_generation'] = Variable<String>(localGeneration.value);
    }
    if (remoteGeneration.present) {
      map['remote_generation'] = Variable<String>(remoteGeneration.value);
    }
    if (manifestEtag.present) {
      map['manifest_etag'] = Variable<String>(manifestEtag.value);
    }
    if (vectorJson.present) {
      map['vector_json'] = Variable<String>(vectorJson.value);
    }
    if (dirty.present) {
      map['dirty'] = Variable<bool>(dirty.value);
    }
    if (lastSyncedAtMs.present) {
      map['last_synced_at_ms'] = Variable<int>(lastSyncedAtMs.value);
    }
    if (error.present) {
      map['error'] = Variable<String>(error.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SyncMetadataRowsCompanion(')
          ..write('scope: $scope, ')
          ..write('localGeneration: $localGeneration, ')
          ..write('remoteGeneration: $remoteGeneration, ')
          ..write('manifestEtag: $manifestEtag, ')
          ..write('vectorJson: $vectorJson, ')
          ..write('dirty: $dirty, ')
          ..write('lastSyncedAtMs: $lastSyncedAtMs, ')
          ..write('error: $error, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SyncTombstoneRowsTable extends SyncTombstoneRows
    with TableInfo<$SyncTombstoneRowsTable, SyncTombstoneRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SyncTombstoneRowsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _scopeMeta = const VerificationMeta('scope');
  @override
  late final GeneratedColumn<String> scope = GeneratedColumn<String>(
    'scope',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _entityIdMeta = const VerificationMeta(
    'entityId',
  );
  @override
  late final GeneratedColumn<String> entityId = GeneratedColumn<String>(
    'entity_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _deletedAtMsMeta = const VerificationMeta(
    'deletedAtMs',
  );
  @override
  late final GeneratedColumn<int> deletedAtMs = GeneratedColumn<int>(
    'deleted_at_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _revisionMeta = const VerificationMeta(
    'revision',
  );
  @override
  late final GeneratedColumn<int> revision = GeneratedColumn<int>(
    'revision',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(1),
  );
  @override
  List<GeneratedColumn> get $columns => [
    scope,
    entityId,
    deletedAtMs,
    revision,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sync_tombstone_rows';
  @override
  VerificationContext validateIntegrity(
    Insertable<SyncTombstoneRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('scope')) {
      context.handle(
        _scopeMeta,
        scope.isAcceptableOrUnknown(data['scope']!, _scopeMeta),
      );
    } else if (isInserting) {
      context.missing(_scopeMeta);
    }
    if (data.containsKey('entity_id')) {
      context.handle(
        _entityIdMeta,
        entityId.isAcceptableOrUnknown(data['entity_id']!, _entityIdMeta),
      );
    } else if (isInserting) {
      context.missing(_entityIdMeta);
    }
    if (data.containsKey('deleted_at_ms')) {
      context.handle(
        _deletedAtMsMeta,
        deletedAtMs.isAcceptableOrUnknown(
          data['deleted_at_ms']!,
          _deletedAtMsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_deletedAtMsMeta);
    }
    if (data.containsKey('revision')) {
      context.handle(
        _revisionMeta,
        revision.isAcceptableOrUnknown(data['revision']!, _revisionMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {scope, entityId};
  @override
  SyncTombstoneRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SyncTombstoneRow(
      scope: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}scope'],
      )!,
      entityId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}entity_id'],
      )!,
      deletedAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}deleted_at_ms'],
      )!,
      revision: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}revision'],
      )!,
    );
  }

  @override
  $SyncTombstoneRowsTable createAlias(String alias) {
    return $SyncTombstoneRowsTable(attachedDatabase, alias);
  }
}

class SyncTombstoneRow extends DataClass
    implements Insertable<SyncTombstoneRow> {
  final String scope;
  final String entityId;
  final int deletedAtMs;
  final int revision;
  const SyncTombstoneRow({
    required this.scope,
    required this.entityId,
    required this.deletedAtMs,
    required this.revision,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['scope'] = Variable<String>(scope);
    map['entity_id'] = Variable<String>(entityId);
    map['deleted_at_ms'] = Variable<int>(deletedAtMs);
    map['revision'] = Variable<int>(revision);
    return map;
  }

  SyncTombstoneRowsCompanion toCompanion(bool nullToAbsent) {
    return SyncTombstoneRowsCompanion(
      scope: Value(scope),
      entityId: Value(entityId),
      deletedAtMs: Value(deletedAtMs),
      revision: Value(revision),
    );
  }

  factory SyncTombstoneRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SyncTombstoneRow(
      scope: serializer.fromJson<String>(json['scope']),
      entityId: serializer.fromJson<String>(json['entityId']),
      deletedAtMs: serializer.fromJson<int>(json['deletedAtMs']),
      revision: serializer.fromJson<int>(json['revision']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'scope': serializer.toJson<String>(scope),
      'entityId': serializer.toJson<String>(entityId),
      'deletedAtMs': serializer.toJson<int>(deletedAtMs),
      'revision': serializer.toJson<int>(revision),
    };
  }

  SyncTombstoneRow copyWith({
    String? scope,
    String? entityId,
    int? deletedAtMs,
    int? revision,
  }) => SyncTombstoneRow(
    scope: scope ?? this.scope,
    entityId: entityId ?? this.entityId,
    deletedAtMs: deletedAtMs ?? this.deletedAtMs,
    revision: revision ?? this.revision,
  );
  SyncTombstoneRow copyWithCompanion(SyncTombstoneRowsCompanion data) {
    return SyncTombstoneRow(
      scope: data.scope.present ? data.scope.value : this.scope,
      entityId: data.entityId.present ? data.entityId.value : this.entityId,
      deletedAtMs: data.deletedAtMs.present
          ? data.deletedAtMs.value
          : this.deletedAtMs,
      revision: data.revision.present ? data.revision.value : this.revision,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SyncTombstoneRow(')
          ..write('scope: $scope, ')
          ..write('entityId: $entityId, ')
          ..write('deletedAtMs: $deletedAtMs, ')
          ..write('revision: $revision')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(scope, entityId, deletedAtMs, revision);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SyncTombstoneRow &&
          other.scope == this.scope &&
          other.entityId == this.entityId &&
          other.deletedAtMs == this.deletedAtMs &&
          other.revision == this.revision);
}

class SyncTombstoneRowsCompanion extends UpdateCompanion<SyncTombstoneRow> {
  final Value<String> scope;
  final Value<String> entityId;
  final Value<int> deletedAtMs;
  final Value<int> revision;
  final Value<int> rowid;
  const SyncTombstoneRowsCompanion({
    this.scope = const Value.absent(),
    this.entityId = const Value.absent(),
    this.deletedAtMs = const Value.absent(),
    this.revision = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SyncTombstoneRowsCompanion.insert({
    required String scope,
    required String entityId,
    required int deletedAtMs,
    this.revision = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : scope = Value(scope),
       entityId = Value(entityId),
       deletedAtMs = Value(deletedAtMs);
  static Insertable<SyncTombstoneRow> custom({
    Expression<String>? scope,
    Expression<String>? entityId,
    Expression<int>? deletedAtMs,
    Expression<int>? revision,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (scope != null) 'scope': scope,
      if (entityId != null) 'entity_id': entityId,
      if (deletedAtMs != null) 'deleted_at_ms': deletedAtMs,
      if (revision != null) 'revision': revision,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SyncTombstoneRowsCompanion copyWith({
    Value<String>? scope,
    Value<String>? entityId,
    Value<int>? deletedAtMs,
    Value<int>? revision,
    Value<int>? rowid,
  }) {
    return SyncTombstoneRowsCompanion(
      scope: scope ?? this.scope,
      entityId: entityId ?? this.entityId,
      deletedAtMs: deletedAtMs ?? this.deletedAtMs,
      revision: revision ?? this.revision,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (scope.present) {
      map['scope'] = Variable<String>(scope.value);
    }
    if (entityId.present) {
      map['entity_id'] = Variable<String>(entityId.value);
    }
    if (deletedAtMs.present) {
      map['deleted_at_ms'] = Variable<int>(deletedAtMs.value);
    }
    if (revision.present) {
      map['revision'] = Variable<int>(revision.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SyncTombstoneRowsCompanion(')
          ..write('scope: $scope, ')
          ..write('entityId: $entityId, ')
          ..write('deletedAtMs: $deletedAtMs, ')
          ..write('revision: $revision, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $ActivityRowsTable extends ActivityRows
    with TableInfo<$ActivityRowsTable, ActivityRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ActivityRowsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<String> type = GeneratedColumn<String>(
    'type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nodeIdMeta = const VerificationMeta('nodeId');
  @override
  late final GeneratedColumn<String> nodeId = GeneratedColumn<String>(
    'node_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'REFERENCES library_node_rows (id) ON DELETE SET NULL',
    ),
  );
  static const VerificationMeta _occurredAtMsMeta = const VerificationMeta(
    'occurredAtMs',
  );
  @override
  late final GeneratedColumn<int> occurredAtMs = GeneratedColumn<int>(
    'occurred_at_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _detailsJsonMeta = const VerificationMeta(
    'detailsJson',
  );
  @override
  late final GeneratedColumn<String> detailsJson = GeneratedColumn<String>(
    'details_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('{}'),
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    type,
    nodeId,
    occurredAtMs,
    detailsJson,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'activity_rows';
  @override
  VerificationContext validateIntegrity(
    Insertable<ActivityRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('type')) {
      context.handle(
        _typeMeta,
        type.isAcceptableOrUnknown(data['type']!, _typeMeta),
      );
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('node_id')) {
      context.handle(
        _nodeIdMeta,
        nodeId.isAcceptableOrUnknown(data['node_id']!, _nodeIdMeta),
      );
    }
    if (data.containsKey('occurred_at_ms')) {
      context.handle(
        _occurredAtMsMeta,
        occurredAtMs.isAcceptableOrUnknown(
          data['occurred_at_ms']!,
          _occurredAtMsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_occurredAtMsMeta);
    }
    if (data.containsKey('details_json')) {
      context.handle(
        _detailsJsonMeta,
        detailsJson.isAcceptableOrUnknown(
          data['details_json']!,
          _detailsJsonMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  ActivityRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ActivityRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      type: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}type'],
      )!,
      nodeId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}node_id'],
      ),
      occurredAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}occurred_at_ms'],
      )!,
      detailsJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}details_json'],
      )!,
    );
  }

  @override
  $ActivityRowsTable createAlias(String alias) {
    return $ActivityRowsTable(attachedDatabase, alias);
  }
}

class ActivityRow extends DataClass implements Insertable<ActivityRow> {
  final String id;
  final String type;
  final String? nodeId;
  final int occurredAtMs;
  final String detailsJson;
  const ActivityRow({
    required this.id,
    required this.type,
    this.nodeId,
    required this.occurredAtMs,
    required this.detailsJson,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['type'] = Variable<String>(type);
    if (!nullToAbsent || nodeId != null) {
      map['node_id'] = Variable<String>(nodeId);
    }
    map['occurred_at_ms'] = Variable<int>(occurredAtMs);
    map['details_json'] = Variable<String>(detailsJson);
    return map;
  }

  ActivityRowsCompanion toCompanion(bool nullToAbsent) {
    return ActivityRowsCompanion(
      id: Value(id),
      type: Value(type),
      nodeId: nodeId == null && nullToAbsent
          ? const Value.absent()
          : Value(nodeId),
      occurredAtMs: Value(occurredAtMs),
      detailsJson: Value(detailsJson),
    );
  }

  factory ActivityRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ActivityRow(
      id: serializer.fromJson<String>(json['id']),
      type: serializer.fromJson<String>(json['type']),
      nodeId: serializer.fromJson<String?>(json['nodeId']),
      occurredAtMs: serializer.fromJson<int>(json['occurredAtMs']),
      detailsJson: serializer.fromJson<String>(json['detailsJson']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'type': serializer.toJson<String>(type),
      'nodeId': serializer.toJson<String?>(nodeId),
      'occurredAtMs': serializer.toJson<int>(occurredAtMs),
      'detailsJson': serializer.toJson<String>(detailsJson),
    };
  }

  ActivityRow copyWith({
    String? id,
    String? type,
    Value<String?> nodeId = const Value.absent(),
    int? occurredAtMs,
    String? detailsJson,
  }) => ActivityRow(
    id: id ?? this.id,
    type: type ?? this.type,
    nodeId: nodeId.present ? nodeId.value : this.nodeId,
    occurredAtMs: occurredAtMs ?? this.occurredAtMs,
    detailsJson: detailsJson ?? this.detailsJson,
  );
  ActivityRow copyWithCompanion(ActivityRowsCompanion data) {
    return ActivityRow(
      id: data.id.present ? data.id.value : this.id,
      type: data.type.present ? data.type.value : this.type,
      nodeId: data.nodeId.present ? data.nodeId.value : this.nodeId,
      occurredAtMs: data.occurredAtMs.present
          ? data.occurredAtMs.value
          : this.occurredAtMs,
      detailsJson: data.detailsJson.present
          ? data.detailsJson.value
          : this.detailsJson,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ActivityRow(')
          ..write('id: $id, ')
          ..write('type: $type, ')
          ..write('nodeId: $nodeId, ')
          ..write('occurredAtMs: $occurredAtMs, ')
          ..write('detailsJson: $detailsJson')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, type, nodeId, occurredAtMs, detailsJson);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ActivityRow &&
          other.id == this.id &&
          other.type == this.type &&
          other.nodeId == this.nodeId &&
          other.occurredAtMs == this.occurredAtMs &&
          other.detailsJson == this.detailsJson);
}

class ActivityRowsCompanion extends UpdateCompanion<ActivityRow> {
  final Value<String> id;
  final Value<String> type;
  final Value<String?> nodeId;
  final Value<int> occurredAtMs;
  final Value<String> detailsJson;
  final Value<int> rowid;
  const ActivityRowsCompanion({
    this.id = const Value.absent(),
    this.type = const Value.absent(),
    this.nodeId = const Value.absent(),
    this.occurredAtMs = const Value.absent(),
    this.detailsJson = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ActivityRowsCompanion.insert({
    required String id,
    required String type,
    this.nodeId = const Value.absent(),
    required int occurredAtMs,
    this.detailsJson = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       type = Value(type),
       occurredAtMs = Value(occurredAtMs);
  static Insertable<ActivityRow> custom({
    Expression<String>? id,
    Expression<String>? type,
    Expression<String>? nodeId,
    Expression<int>? occurredAtMs,
    Expression<String>? detailsJson,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (type != null) 'type': type,
      if (nodeId != null) 'node_id': nodeId,
      if (occurredAtMs != null) 'occurred_at_ms': occurredAtMs,
      if (detailsJson != null) 'details_json': detailsJson,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ActivityRowsCompanion copyWith({
    Value<String>? id,
    Value<String>? type,
    Value<String?>? nodeId,
    Value<int>? occurredAtMs,
    Value<String>? detailsJson,
    Value<int>? rowid,
  }) {
    return ActivityRowsCompanion(
      id: id ?? this.id,
      type: type ?? this.type,
      nodeId: nodeId ?? this.nodeId,
      occurredAtMs: occurredAtMs ?? this.occurredAtMs,
      detailsJson: detailsJson ?? this.detailsJson,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (type.present) {
      map['type'] = Variable<String>(type.value);
    }
    if (nodeId.present) {
      map['node_id'] = Variable<String>(nodeId.value);
    }
    if (occurredAtMs.present) {
      map['occurred_at_ms'] = Variable<int>(occurredAtMs.value);
    }
    if (detailsJson.present) {
      map['details_json'] = Variable<String>(detailsJson.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ActivityRowsCompanion(')
          ..write('id: $id, ')
          ..write('type: $type, ')
          ..write('nodeId: $nodeId, ')
          ..write('occurredAtMs: $occurredAtMs, ')
          ..write('detailsJson: $detailsJson, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$IdeallDatabase extends GeneratedDatabase {
  _$IdeallDatabase(QueryExecutor e) : super(e);
  $IdeallDatabaseManager get managers => $IdeallDatabaseManager(this);
  late final $LibraryNodeRowsTable libraryNodeRows = $LibraryNodeRowsTable(
    this,
  );
  late final $SubscriptionRowsTable subscriptionRows = $SubscriptionRowsTable(
    this,
  );
  late final $PublicationLinkRowsTable publicationLinkRows =
      $PublicationLinkRowsTable(this);
  late final $SyncMetadataRowsTable syncMetadataRows = $SyncMetadataRowsTable(
    this,
  );
  late final $SyncTombstoneRowsTable syncTombstoneRows =
      $SyncTombstoneRowsTable(this);
  late final $ActivityRowsTable activityRows = $ActivityRowsTable(this);
  late final Index nodeParentStatusIdx = Index(
    'node_parent_status_idx',
    'CREATE INDEX node_parent_status_idx ON library_node_rows (parent_id, status)',
  );
  late final Index nodeUpdatedIdx = Index(
    'node_updated_idx',
    'CREATE INDEX node_updated_idx ON library_node_rows (updated_at_ms)',
  );
  late final Index subscriptionTargetIdx = Index(
    'subscription_target_idx',
    'CREATE INDEX subscription_target_idx ON subscription_rows (kind, target_id)',
  );
  late final Index publicationNodeIdx = Index(
    'publication_node_idx',
    'CREATE INDEX publication_node_idx ON publication_link_rows (node_id)',
  );
  late final Index syncTombstoneDeletedIdx = Index(
    'sync_tombstone_deleted_idx',
    'CREATE INDEX sync_tombstone_deleted_idx ON sync_tombstone_rows (deleted_at_ms)',
  );
  late final Index activityTimeIdx = Index(
    'activity_time_idx',
    'CREATE INDEX activity_time_idx ON activity_rows (occurred_at_ms)',
  );
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    libraryNodeRows,
    subscriptionRows,
    publicationLinkRows,
    syncMetadataRows,
    syncTombstoneRows,
    activityRows,
    nodeParentStatusIdx,
    nodeUpdatedIdx,
    subscriptionTargetIdx,
    publicationNodeIdx,
    syncTombstoneDeletedIdx,
    activityTimeIdx,
  ];
  @override
  StreamQueryUpdateRules get streamUpdateRules => const StreamQueryUpdateRules([
    WritePropagation(
      on: TableUpdateQuery.onTableName(
        'library_node_rows',
        limitUpdateKind: UpdateKind.delete,
      ),
      result: [TableUpdate('library_node_rows', kind: UpdateKind.delete)],
    ),
    WritePropagation(
      on: TableUpdateQuery.onTableName(
        'library_node_rows',
        limitUpdateKind: UpdateKind.delete,
      ),
      result: [TableUpdate('publication_link_rows', kind: UpdateKind.update)],
    ),
    WritePropagation(
      on: TableUpdateQuery.onTableName(
        'library_node_rows',
        limitUpdateKind: UpdateKind.delete,
      ),
      result: [TableUpdate('activity_rows', kind: UpdateKind.update)],
    ),
  ]);
}

typedef $$LibraryNodeRowsTableCreateCompanionBuilder =
    LibraryNodeRowsCompanion Function({
      required String id,
      Value<String?> parentId,
      required String kind,
      required String title,
      required String deltaJson,
      Value<String> plainText,
      Value<String?> url,
      Value<String> tagsJson,
      Value<String> tagsText,
      Value<String> status,
      required int createdAtMs,
      required int updatedAtMs,
      Value<int?> deletedAtMs,
      Value<int> revision,
      Value<int> sortOrder,
      Value<int> rowid,
    });
typedef $$LibraryNodeRowsTableUpdateCompanionBuilder =
    LibraryNodeRowsCompanion Function({
      Value<String> id,
      Value<String?> parentId,
      Value<String> kind,
      Value<String> title,
      Value<String> deltaJson,
      Value<String> plainText,
      Value<String?> url,
      Value<String> tagsJson,
      Value<String> tagsText,
      Value<String> status,
      Value<int> createdAtMs,
      Value<int> updatedAtMs,
      Value<int?> deletedAtMs,
      Value<int> revision,
      Value<int> sortOrder,
      Value<int> rowid,
    });

final class $$LibraryNodeRowsTableReferences
    extends
        BaseReferences<
          _$IdeallDatabase,
          $LibraryNodeRowsTable,
          LibraryNodeRow
        > {
  $$LibraryNodeRowsTableReferences(
    super.$_db,
    super.$_table,
    super.$_typedResult,
  );

  static $LibraryNodeRowsTable _parentIdTable(_$IdeallDatabase db) => db
      .libraryNodeRows
      .createAlias('library_node_rows__parent_id__library_node_rows__id');

  $$LibraryNodeRowsTableProcessedTableManager? get parentId {
    final $_column = $_itemColumn<String>('parent_id');
    if ($_column == null) return null;
    final manager = $$LibraryNodeRowsTableTableManager(
      $_db,
      $_db.libraryNodeRows,
    ).filter((f) => f.id.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_parentIdTable($_db));
    if (item == null) return manager;
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }

  static MultiTypedResultKey<
    $PublicationLinkRowsTable,
    List<PublicationLinkRow>
  >
  _publicationLinkRowsRefsTable(_$IdeallDatabase db) =>
      MultiTypedResultKey.fromTable(
        db.publicationLinkRows,
        aliasName: 'library_node_rows__id__publication_link_rows__node_id',
      );

  $$PublicationLinkRowsTableProcessedTableManager get publicationLinkRowsRefs {
    final manager = $$PublicationLinkRowsTableTableManager(
      $_db,
      $_db.publicationLinkRows,
    ).filter((f) => f.nodeId.id.sqlEquals($_itemColumn<String>('id')!));

    final cache = $_typedResult.readTableOrNull(
      _publicationLinkRowsRefsTable($_db),
    );
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: cache),
    );
  }

  static MultiTypedResultKey<$ActivityRowsTable, List<ActivityRow>>
  _activityRowsRefsTable(_$IdeallDatabase db) => MultiTypedResultKey.fromTable(
    db.activityRows,
    aliasName: 'library_node_rows__id__activity_rows__node_id',
  );

  $$ActivityRowsTableProcessedTableManager get activityRowsRefs {
    final manager = $$ActivityRowsTableTableManager(
      $_db,
      $_db.activityRows,
    ).filter((f) => f.nodeId.id.sqlEquals($_itemColumn<String>('id')!));

    final cache = $_typedResult.readTableOrNull(_activityRowsRefsTable($_db));
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: cache),
    );
  }
}

class $$LibraryNodeRowsTableFilterComposer
    extends Composer<_$IdeallDatabase, $LibraryNodeRowsTable> {
  $$LibraryNodeRowsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get title => $composableBuilder(
    column: $table.title,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get deltaJson => $composableBuilder(
    column: $table.deltaJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get plainText => $composableBuilder(
    column: $table.plainText,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get url => $composableBuilder(
    column: $table.url,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get tagsJson => $composableBuilder(
    column: $table.tagsJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get tagsText => $composableBuilder(
    column: $table.tagsText,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get createdAtMs => $composableBuilder(
    column: $table.createdAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get updatedAtMs => $composableBuilder(
    column: $table.updatedAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get deletedAtMs => $composableBuilder(
    column: $table.deletedAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get revision => $composableBuilder(
    column: $table.revision,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get sortOrder => $composableBuilder(
    column: $table.sortOrder,
    builder: (column) => ColumnFilters(column),
  );

  $$LibraryNodeRowsTableFilterComposer get parentId {
    final $$LibraryNodeRowsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.parentId,
      referencedTable: $db.libraryNodeRows,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LibraryNodeRowsTableFilterComposer(
            $db: $db,
            $table: $db.libraryNodeRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }

  Expression<bool> publicationLinkRowsRefs(
    Expression<bool> Function($$PublicationLinkRowsTableFilterComposer f) f,
  ) {
    final $$PublicationLinkRowsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.id,
      referencedTable: $db.publicationLinkRows,
      getReferencedColumn: (t) => t.nodeId,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$PublicationLinkRowsTableFilterComposer(
            $db: $db,
            $table: $db.publicationLinkRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }

  Expression<bool> activityRowsRefs(
    Expression<bool> Function($$ActivityRowsTableFilterComposer f) f,
  ) {
    final $$ActivityRowsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.id,
      referencedTable: $db.activityRows,
      getReferencedColumn: (t) => t.nodeId,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$ActivityRowsTableFilterComposer(
            $db: $db,
            $table: $db.activityRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }
}

class $$LibraryNodeRowsTableOrderingComposer
    extends Composer<_$IdeallDatabase, $LibraryNodeRowsTable> {
  $$LibraryNodeRowsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get title => $composableBuilder(
    column: $table.title,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get deltaJson => $composableBuilder(
    column: $table.deltaJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get plainText => $composableBuilder(
    column: $table.plainText,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get url => $composableBuilder(
    column: $table.url,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get tagsJson => $composableBuilder(
    column: $table.tagsJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get tagsText => $composableBuilder(
    column: $table.tagsText,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get createdAtMs => $composableBuilder(
    column: $table.createdAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get updatedAtMs => $composableBuilder(
    column: $table.updatedAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get deletedAtMs => $composableBuilder(
    column: $table.deletedAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get revision => $composableBuilder(
    column: $table.revision,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get sortOrder => $composableBuilder(
    column: $table.sortOrder,
    builder: (column) => ColumnOrderings(column),
  );

  $$LibraryNodeRowsTableOrderingComposer get parentId {
    final $$LibraryNodeRowsTableOrderingComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.parentId,
      referencedTable: $db.libraryNodeRows,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LibraryNodeRowsTableOrderingComposer(
            $db: $db,
            $table: $db.libraryNodeRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$LibraryNodeRowsTableAnnotationComposer
    extends Composer<_$IdeallDatabase, $LibraryNodeRowsTable> {
  $$LibraryNodeRowsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get title =>
      $composableBuilder(column: $table.title, builder: (column) => column);

  GeneratedColumn<String> get deltaJson =>
      $composableBuilder(column: $table.deltaJson, builder: (column) => column);

  GeneratedColumn<String> get plainText =>
      $composableBuilder(column: $table.plainText, builder: (column) => column);

  GeneratedColumn<String> get url =>
      $composableBuilder(column: $table.url, builder: (column) => column);

  GeneratedColumn<String> get tagsJson =>
      $composableBuilder(column: $table.tagsJson, builder: (column) => column);

  GeneratedColumn<String> get tagsText =>
      $composableBuilder(column: $table.tagsText, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<int> get createdAtMs => $composableBuilder(
    column: $table.createdAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<int> get updatedAtMs => $composableBuilder(
    column: $table.updatedAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<int> get deletedAtMs => $composableBuilder(
    column: $table.deletedAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<int> get revision =>
      $composableBuilder(column: $table.revision, builder: (column) => column);

  GeneratedColumn<int> get sortOrder =>
      $composableBuilder(column: $table.sortOrder, builder: (column) => column);

  $$LibraryNodeRowsTableAnnotationComposer get parentId {
    final $$LibraryNodeRowsTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.parentId,
      referencedTable: $db.libraryNodeRows,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LibraryNodeRowsTableAnnotationComposer(
            $db: $db,
            $table: $db.libraryNodeRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }

  Expression<T> publicationLinkRowsRefs<T extends Object>(
    Expression<T> Function($$PublicationLinkRowsTableAnnotationComposer a) f,
  ) {
    final $$PublicationLinkRowsTableAnnotationComposer composer =
        $composerBuilder(
          composer: this,
          getCurrentColumn: (t) => t.id,
          referencedTable: $db.publicationLinkRows,
          getReferencedColumn: (t) => t.nodeId,
          builder:
              (
                joinBuilder, {
                $addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer,
              }) => $$PublicationLinkRowsTableAnnotationComposer(
                $db: $db,
                $table: $db.publicationLinkRows,
                $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
                joinBuilder: joinBuilder,
                $removeJoinBuilderFromRootComposer:
                    $removeJoinBuilderFromRootComposer,
              ),
        );
    return f(composer);
  }

  Expression<T> activityRowsRefs<T extends Object>(
    Expression<T> Function($$ActivityRowsTableAnnotationComposer a) f,
  ) {
    final $$ActivityRowsTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.id,
      referencedTable: $db.activityRows,
      getReferencedColumn: (t) => t.nodeId,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$ActivityRowsTableAnnotationComposer(
            $db: $db,
            $table: $db.activityRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }
}

class $$LibraryNodeRowsTableTableManager
    extends
        RootTableManager<
          _$IdeallDatabase,
          $LibraryNodeRowsTable,
          LibraryNodeRow,
          $$LibraryNodeRowsTableFilterComposer,
          $$LibraryNodeRowsTableOrderingComposer,
          $$LibraryNodeRowsTableAnnotationComposer,
          $$LibraryNodeRowsTableCreateCompanionBuilder,
          $$LibraryNodeRowsTableUpdateCompanionBuilder,
          (LibraryNodeRow, $$LibraryNodeRowsTableReferences),
          LibraryNodeRow,
          PrefetchHooks Function({
            bool parentId,
            bool publicationLinkRowsRefs,
            bool activityRowsRefs,
          })
        > {
  $$LibraryNodeRowsTableTableManager(
    _$IdeallDatabase db,
    $LibraryNodeRowsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LibraryNodeRowsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LibraryNodeRowsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LibraryNodeRowsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String?> parentId = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<String> title = const Value.absent(),
                Value<String> deltaJson = const Value.absent(),
                Value<String> plainText = const Value.absent(),
                Value<String?> url = const Value.absent(),
                Value<String> tagsJson = const Value.absent(),
                Value<String> tagsText = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<int> createdAtMs = const Value.absent(),
                Value<int> updatedAtMs = const Value.absent(),
                Value<int?> deletedAtMs = const Value.absent(),
                Value<int> revision = const Value.absent(),
                Value<int> sortOrder = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LibraryNodeRowsCompanion(
                id: id,
                parentId: parentId,
                kind: kind,
                title: title,
                deltaJson: deltaJson,
                plainText: plainText,
                url: url,
                tagsJson: tagsJson,
                tagsText: tagsText,
                status: status,
                createdAtMs: createdAtMs,
                updatedAtMs: updatedAtMs,
                deletedAtMs: deletedAtMs,
                revision: revision,
                sortOrder: sortOrder,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                Value<String?> parentId = const Value.absent(),
                required String kind,
                required String title,
                required String deltaJson,
                Value<String> plainText = const Value.absent(),
                Value<String?> url = const Value.absent(),
                Value<String> tagsJson = const Value.absent(),
                Value<String> tagsText = const Value.absent(),
                Value<String> status = const Value.absent(),
                required int createdAtMs,
                required int updatedAtMs,
                Value<int?> deletedAtMs = const Value.absent(),
                Value<int> revision = const Value.absent(),
                Value<int> sortOrder = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LibraryNodeRowsCompanion.insert(
                id: id,
                parentId: parentId,
                kind: kind,
                title: title,
                deltaJson: deltaJson,
                plainText: plainText,
                url: url,
                tagsJson: tagsJson,
                tagsText: tagsText,
                status: status,
                createdAtMs: createdAtMs,
                updatedAtMs: updatedAtMs,
                deletedAtMs: deletedAtMs,
                revision: revision,
                sortOrder: sortOrder,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable(table),
                  $$LibraryNodeRowsTableReferences(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback:
              ({
                parentId = false,
                publicationLinkRowsRefs = false,
                activityRowsRefs = false,
              }) {
                return PrefetchHooks(
                  db: db,
                  explicitlyWatchedTables: [
                    if (publicationLinkRowsRefs) db.publicationLinkRows,
                    if (activityRowsRefs) db.activityRows,
                  ],
                  addJoins:
                      <
                        T extends TableManagerState<
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic
                        >
                      >(state) {
                        if (parentId) {
                          state =
                              state.withJoin(
                                    currentTable: table,
                                    currentColumn: table.parentId,
                                    referencedTable:
                                        $$LibraryNodeRowsTableReferences
                                            ._parentIdTable(db),
                                    referencedColumn:
                                        $$LibraryNodeRowsTableReferences
                                            ._parentIdTable(db)
                                            .id,
                                  )
                                  as T;
                        }

                        return state;
                      },
                  getPrefetchedDataCallback: (items) async {
                    return [
                      if (publicationLinkRowsRefs)
                        await $_getPrefetchedData<
                          LibraryNodeRow,
                          $LibraryNodeRowsTable,
                          PublicationLinkRow
                        >(
                          currentTable: table,
                          referencedTable: $$LibraryNodeRowsTableReferences
                              ._publicationLinkRowsRefsTable(db),
                          managerFromTypedResult: (p0) =>
                              $$LibraryNodeRowsTableReferences(
                                db,
                                table,
                                p0,
                              ).publicationLinkRowsRefs,
                          referencedItemsForCurrentItem:
                              (item, referencedItems) => referencedItems.where(
                                (e) => e.nodeId == item.id,
                              ),
                          typedResults: items,
                        ),
                      if (activityRowsRefs)
                        await $_getPrefetchedData<
                          LibraryNodeRow,
                          $LibraryNodeRowsTable,
                          ActivityRow
                        >(
                          currentTable: table,
                          referencedTable: $$LibraryNodeRowsTableReferences
                              ._activityRowsRefsTable(db),
                          managerFromTypedResult: (p0) =>
                              $$LibraryNodeRowsTableReferences(
                                db,
                                table,
                                p0,
                              ).activityRowsRefs,
                          referencedItemsForCurrentItem:
                              (item, referencedItems) => referencedItems.where(
                                (e) => e.nodeId == item.id,
                              ),
                          typedResults: items,
                        ),
                    ];
                  },
                );
              },
        ),
      );
}

typedef $$LibraryNodeRowsTableProcessedTableManager =
    ProcessedTableManager<
      _$IdeallDatabase,
      $LibraryNodeRowsTable,
      LibraryNodeRow,
      $$LibraryNodeRowsTableFilterComposer,
      $$LibraryNodeRowsTableOrderingComposer,
      $$LibraryNodeRowsTableAnnotationComposer,
      $$LibraryNodeRowsTableCreateCompanionBuilder,
      $$LibraryNodeRowsTableUpdateCompanionBuilder,
      (LibraryNodeRow, $$LibraryNodeRowsTableReferences),
      LibraryNodeRow,
      PrefetchHooks Function({
        bool parentId,
        bool publicationLinkRowsRefs,
        bool activityRowsRefs,
      })
    >;
typedef $$SubscriptionRowsTableCreateCompanionBuilder =
    SubscriptionRowsCompanion Function({
      required String id,
      required String kind,
      required String targetId,
      required String label,
      Value<String> metadataJson,
      Value<bool> enabled,
      required int createdAtMs,
      required int updatedAtMs,
      Value<int> revision,
      Value<int> rowid,
    });
typedef $$SubscriptionRowsTableUpdateCompanionBuilder =
    SubscriptionRowsCompanion Function({
      Value<String> id,
      Value<String> kind,
      Value<String> targetId,
      Value<String> label,
      Value<String> metadataJson,
      Value<bool> enabled,
      Value<int> createdAtMs,
      Value<int> updatedAtMs,
      Value<int> revision,
      Value<int> rowid,
    });

class $$SubscriptionRowsTableFilterComposer
    extends Composer<_$IdeallDatabase, $SubscriptionRowsTable> {
  $$SubscriptionRowsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get targetId => $composableBuilder(
    column: $table.targetId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get label => $composableBuilder(
    column: $table.label,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get metadataJson => $composableBuilder(
    column: $table.metadataJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get enabled => $composableBuilder(
    column: $table.enabled,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get createdAtMs => $composableBuilder(
    column: $table.createdAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get updatedAtMs => $composableBuilder(
    column: $table.updatedAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get revision => $composableBuilder(
    column: $table.revision,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SubscriptionRowsTableOrderingComposer
    extends Composer<_$IdeallDatabase, $SubscriptionRowsTable> {
  $$SubscriptionRowsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get targetId => $composableBuilder(
    column: $table.targetId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get label => $composableBuilder(
    column: $table.label,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get metadataJson => $composableBuilder(
    column: $table.metadataJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get enabled => $composableBuilder(
    column: $table.enabled,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get createdAtMs => $composableBuilder(
    column: $table.createdAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get updatedAtMs => $composableBuilder(
    column: $table.updatedAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get revision => $composableBuilder(
    column: $table.revision,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SubscriptionRowsTableAnnotationComposer
    extends Composer<_$IdeallDatabase, $SubscriptionRowsTable> {
  $$SubscriptionRowsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get targetId =>
      $composableBuilder(column: $table.targetId, builder: (column) => column);

  GeneratedColumn<String> get label =>
      $composableBuilder(column: $table.label, builder: (column) => column);

  GeneratedColumn<String> get metadataJson => $composableBuilder(
    column: $table.metadataJson,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get enabled =>
      $composableBuilder(column: $table.enabled, builder: (column) => column);

  GeneratedColumn<int> get createdAtMs => $composableBuilder(
    column: $table.createdAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<int> get updatedAtMs => $composableBuilder(
    column: $table.updatedAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<int> get revision =>
      $composableBuilder(column: $table.revision, builder: (column) => column);
}

class $$SubscriptionRowsTableTableManager
    extends
        RootTableManager<
          _$IdeallDatabase,
          $SubscriptionRowsTable,
          SubscriptionRow,
          $$SubscriptionRowsTableFilterComposer,
          $$SubscriptionRowsTableOrderingComposer,
          $$SubscriptionRowsTableAnnotationComposer,
          $$SubscriptionRowsTableCreateCompanionBuilder,
          $$SubscriptionRowsTableUpdateCompanionBuilder,
          (
            SubscriptionRow,
            BaseReferences<
              _$IdeallDatabase,
              $SubscriptionRowsTable,
              SubscriptionRow
            >,
          ),
          SubscriptionRow,
          PrefetchHooks Function()
        > {
  $$SubscriptionRowsTableTableManager(
    _$IdeallDatabase db,
    $SubscriptionRowsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SubscriptionRowsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SubscriptionRowsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SubscriptionRowsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<String> targetId = const Value.absent(),
                Value<String> label = const Value.absent(),
                Value<String> metadataJson = const Value.absent(),
                Value<bool> enabled = const Value.absent(),
                Value<int> createdAtMs = const Value.absent(),
                Value<int> updatedAtMs = const Value.absent(),
                Value<int> revision = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SubscriptionRowsCompanion(
                id: id,
                kind: kind,
                targetId: targetId,
                label: label,
                metadataJson: metadataJson,
                enabled: enabled,
                createdAtMs: createdAtMs,
                updatedAtMs: updatedAtMs,
                revision: revision,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String kind,
                required String targetId,
                required String label,
                Value<String> metadataJson = const Value.absent(),
                Value<bool> enabled = const Value.absent(),
                required int createdAtMs,
                required int updatedAtMs,
                Value<int> revision = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SubscriptionRowsCompanion.insert(
                id: id,
                kind: kind,
                targetId: targetId,
                label: label,
                metadataJson: metadataJson,
                enabled: enabled,
                createdAtMs: createdAtMs,
                updatedAtMs: updatedAtMs,
                revision: revision,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SubscriptionRowsTableProcessedTableManager =
    ProcessedTableManager<
      _$IdeallDatabase,
      $SubscriptionRowsTable,
      SubscriptionRow,
      $$SubscriptionRowsTableFilterComposer,
      $$SubscriptionRowsTableOrderingComposer,
      $$SubscriptionRowsTableAnnotationComposer,
      $$SubscriptionRowsTableCreateCompanionBuilder,
      $$SubscriptionRowsTableUpdateCompanionBuilder,
      (
        SubscriptionRow,
        BaseReferences<
          _$IdeallDatabase,
          $SubscriptionRowsTable,
          SubscriptionRow
        >,
      ),
      SubscriptionRow,
      PrefetchHooks Function()
    >;
typedef $$PublicationLinkRowsTableCreateCompanionBuilder =
    PublicationLinkRowsCompanion Function({
      required String publicationId,
      Value<String?> nodeId,
      required int version,
      required String state,
      required String visibility,
      Value<String?> publicUrl,
      Value<int?> lastPublishedAtMs,
      required int updatedAtMs,
      Value<int> rowid,
    });
typedef $$PublicationLinkRowsTableUpdateCompanionBuilder =
    PublicationLinkRowsCompanion Function({
      Value<String> publicationId,
      Value<String?> nodeId,
      Value<int> version,
      Value<String> state,
      Value<String> visibility,
      Value<String?> publicUrl,
      Value<int?> lastPublishedAtMs,
      Value<int> updatedAtMs,
      Value<int> rowid,
    });

final class $$PublicationLinkRowsTableReferences
    extends
        BaseReferences<
          _$IdeallDatabase,
          $PublicationLinkRowsTable,
          PublicationLinkRow
        > {
  $$PublicationLinkRowsTableReferences(
    super.$_db,
    super.$_table,
    super.$_typedResult,
  );

  static $LibraryNodeRowsTable _nodeIdTable(_$IdeallDatabase db) => db
      .libraryNodeRows
      .createAlias('publication_link_rows__node_id__library_node_rows__id');

  $$LibraryNodeRowsTableProcessedTableManager? get nodeId {
    final $_column = $_itemColumn<String>('node_id');
    if ($_column == null) return null;
    final manager = $$LibraryNodeRowsTableTableManager(
      $_db,
      $_db.libraryNodeRows,
    ).filter((f) => f.id.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_nodeIdTable($_db));
    if (item == null) return manager;
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }
}

class $$PublicationLinkRowsTableFilterComposer
    extends Composer<_$IdeallDatabase, $PublicationLinkRowsTable> {
  $$PublicationLinkRowsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get publicationId => $composableBuilder(
    column: $table.publicationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get version => $composableBuilder(
    column: $table.version,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get visibility => $composableBuilder(
    column: $table.visibility,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get publicUrl => $composableBuilder(
    column: $table.publicUrl,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get lastPublishedAtMs => $composableBuilder(
    column: $table.lastPublishedAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get updatedAtMs => $composableBuilder(
    column: $table.updatedAtMs,
    builder: (column) => ColumnFilters(column),
  );

  $$LibraryNodeRowsTableFilterComposer get nodeId {
    final $$LibraryNodeRowsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.nodeId,
      referencedTable: $db.libraryNodeRows,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LibraryNodeRowsTableFilterComposer(
            $db: $db,
            $table: $db.libraryNodeRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$PublicationLinkRowsTableOrderingComposer
    extends Composer<_$IdeallDatabase, $PublicationLinkRowsTable> {
  $$PublicationLinkRowsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get publicationId => $composableBuilder(
    column: $table.publicationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get version => $composableBuilder(
    column: $table.version,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get visibility => $composableBuilder(
    column: $table.visibility,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get publicUrl => $composableBuilder(
    column: $table.publicUrl,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get lastPublishedAtMs => $composableBuilder(
    column: $table.lastPublishedAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get updatedAtMs => $composableBuilder(
    column: $table.updatedAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  $$LibraryNodeRowsTableOrderingComposer get nodeId {
    final $$LibraryNodeRowsTableOrderingComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.nodeId,
      referencedTable: $db.libraryNodeRows,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LibraryNodeRowsTableOrderingComposer(
            $db: $db,
            $table: $db.libraryNodeRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$PublicationLinkRowsTableAnnotationComposer
    extends Composer<_$IdeallDatabase, $PublicationLinkRowsTable> {
  $$PublicationLinkRowsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get publicationId => $composableBuilder(
    column: $table.publicationId,
    builder: (column) => column,
  );

  GeneratedColumn<int> get version =>
      $composableBuilder(column: $table.version, builder: (column) => column);

  GeneratedColumn<String> get state =>
      $composableBuilder(column: $table.state, builder: (column) => column);

  GeneratedColumn<String> get visibility => $composableBuilder(
    column: $table.visibility,
    builder: (column) => column,
  );

  GeneratedColumn<String> get publicUrl =>
      $composableBuilder(column: $table.publicUrl, builder: (column) => column);

  GeneratedColumn<int> get lastPublishedAtMs => $composableBuilder(
    column: $table.lastPublishedAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<int> get updatedAtMs => $composableBuilder(
    column: $table.updatedAtMs,
    builder: (column) => column,
  );

  $$LibraryNodeRowsTableAnnotationComposer get nodeId {
    final $$LibraryNodeRowsTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.nodeId,
      referencedTable: $db.libraryNodeRows,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LibraryNodeRowsTableAnnotationComposer(
            $db: $db,
            $table: $db.libraryNodeRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$PublicationLinkRowsTableTableManager
    extends
        RootTableManager<
          _$IdeallDatabase,
          $PublicationLinkRowsTable,
          PublicationLinkRow,
          $$PublicationLinkRowsTableFilterComposer,
          $$PublicationLinkRowsTableOrderingComposer,
          $$PublicationLinkRowsTableAnnotationComposer,
          $$PublicationLinkRowsTableCreateCompanionBuilder,
          $$PublicationLinkRowsTableUpdateCompanionBuilder,
          (PublicationLinkRow, $$PublicationLinkRowsTableReferences),
          PublicationLinkRow,
          PrefetchHooks Function({bool nodeId})
        > {
  $$PublicationLinkRowsTableTableManager(
    _$IdeallDatabase db,
    $PublicationLinkRowsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PublicationLinkRowsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$PublicationLinkRowsTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              $$PublicationLinkRowsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> publicationId = const Value.absent(),
                Value<String?> nodeId = const Value.absent(),
                Value<int> version = const Value.absent(),
                Value<String> state = const Value.absent(),
                Value<String> visibility = const Value.absent(),
                Value<String?> publicUrl = const Value.absent(),
                Value<int?> lastPublishedAtMs = const Value.absent(),
                Value<int> updatedAtMs = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => PublicationLinkRowsCompanion(
                publicationId: publicationId,
                nodeId: nodeId,
                version: version,
                state: state,
                visibility: visibility,
                publicUrl: publicUrl,
                lastPublishedAtMs: lastPublishedAtMs,
                updatedAtMs: updatedAtMs,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String publicationId,
                Value<String?> nodeId = const Value.absent(),
                required int version,
                required String state,
                required String visibility,
                Value<String?> publicUrl = const Value.absent(),
                Value<int?> lastPublishedAtMs = const Value.absent(),
                required int updatedAtMs,
                Value<int> rowid = const Value.absent(),
              }) => PublicationLinkRowsCompanion.insert(
                publicationId: publicationId,
                nodeId: nodeId,
                version: version,
                state: state,
                visibility: visibility,
                publicUrl: publicUrl,
                lastPublishedAtMs: lastPublishedAtMs,
                updatedAtMs: updatedAtMs,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable(table),
                  $$PublicationLinkRowsTableReferences(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: ({nodeId = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [],
              addJoins:
                  <
                    T extends TableManagerState<
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic
                    >
                  >(state) {
                    if (nodeId) {
                      state =
                          state.withJoin(
                                currentTable: table,
                                currentColumn: table.nodeId,
                                referencedTable:
                                    $$PublicationLinkRowsTableReferences
                                        ._nodeIdTable(db),
                                referencedColumn:
                                    $$PublicationLinkRowsTableReferences
                                        ._nodeIdTable(db)
                                        .id,
                              )
                              as T;
                    }

                    return state;
                  },
              getPrefetchedDataCallback: (items) async {
                return [];
              },
            );
          },
        ),
      );
}

typedef $$PublicationLinkRowsTableProcessedTableManager =
    ProcessedTableManager<
      _$IdeallDatabase,
      $PublicationLinkRowsTable,
      PublicationLinkRow,
      $$PublicationLinkRowsTableFilterComposer,
      $$PublicationLinkRowsTableOrderingComposer,
      $$PublicationLinkRowsTableAnnotationComposer,
      $$PublicationLinkRowsTableCreateCompanionBuilder,
      $$PublicationLinkRowsTableUpdateCompanionBuilder,
      (PublicationLinkRow, $$PublicationLinkRowsTableReferences),
      PublicationLinkRow,
      PrefetchHooks Function({bool nodeId})
    >;
typedef $$SyncMetadataRowsTableCreateCompanionBuilder =
    SyncMetadataRowsCompanion Function({
      required String scope,
      Value<String?> localGeneration,
      Value<String?> remoteGeneration,
      Value<String?> manifestEtag,
      Value<String> vectorJson,
      Value<bool> dirty,
      Value<int?> lastSyncedAtMs,
      Value<String?> error,
      Value<int> rowid,
    });
typedef $$SyncMetadataRowsTableUpdateCompanionBuilder =
    SyncMetadataRowsCompanion Function({
      Value<String> scope,
      Value<String?> localGeneration,
      Value<String?> remoteGeneration,
      Value<String?> manifestEtag,
      Value<String> vectorJson,
      Value<bool> dirty,
      Value<int?> lastSyncedAtMs,
      Value<String?> error,
      Value<int> rowid,
    });

class $$SyncMetadataRowsTableFilterComposer
    extends Composer<_$IdeallDatabase, $SyncMetadataRowsTable> {
  $$SyncMetadataRowsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get scope => $composableBuilder(
    column: $table.scope,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get localGeneration => $composableBuilder(
    column: $table.localGeneration,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get remoteGeneration => $composableBuilder(
    column: $table.remoteGeneration,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get manifestEtag => $composableBuilder(
    column: $table.manifestEtag,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get vectorJson => $composableBuilder(
    column: $table.vectorJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get dirty => $composableBuilder(
    column: $table.dirty,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get lastSyncedAtMs => $composableBuilder(
    column: $table.lastSyncedAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get error => $composableBuilder(
    column: $table.error,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SyncMetadataRowsTableOrderingComposer
    extends Composer<_$IdeallDatabase, $SyncMetadataRowsTable> {
  $$SyncMetadataRowsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get scope => $composableBuilder(
    column: $table.scope,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get localGeneration => $composableBuilder(
    column: $table.localGeneration,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get remoteGeneration => $composableBuilder(
    column: $table.remoteGeneration,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get manifestEtag => $composableBuilder(
    column: $table.manifestEtag,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get vectorJson => $composableBuilder(
    column: $table.vectorJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get dirty => $composableBuilder(
    column: $table.dirty,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get lastSyncedAtMs => $composableBuilder(
    column: $table.lastSyncedAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get error => $composableBuilder(
    column: $table.error,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SyncMetadataRowsTableAnnotationComposer
    extends Composer<_$IdeallDatabase, $SyncMetadataRowsTable> {
  $$SyncMetadataRowsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get scope =>
      $composableBuilder(column: $table.scope, builder: (column) => column);

  GeneratedColumn<String> get localGeneration => $composableBuilder(
    column: $table.localGeneration,
    builder: (column) => column,
  );

  GeneratedColumn<String> get remoteGeneration => $composableBuilder(
    column: $table.remoteGeneration,
    builder: (column) => column,
  );

  GeneratedColumn<String> get manifestEtag => $composableBuilder(
    column: $table.manifestEtag,
    builder: (column) => column,
  );

  GeneratedColumn<String> get vectorJson => $composableBuilder(
    column: $table.vectorJson,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get dirty =>
      $composableBuilder(column: $table.dirty, builder: (column) => column);

  GeneratedColumn<int> get lastSyncedAtMs => $composableBuilder(
    column: $table.lastSyncedAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<String> get error =>
      $composableBuilder(column: $table.error, builder: (column) => column);
}

class $$SyncMetadataRowsTableTableManager
    extends
        RootTableManager<
          _$IdeallDatabase,
          $SyncMetadataRowsTable,
          SyncMetadataRow,
          $$SyncMetadataRowsTableFilterComposer,
          $$SyncMetadataRowsTableOrderingComposer,
          $$SyncMetadataRowsTableAnnotationComposer,
          $$SyncMetadataRowsTableCreateCompanionBuilder,
          $$SyncMetadataRowsTableUpdateCompanionBuilder,
          (
            SyncMetadataRow,
            BaseReferences<
              _$IdeallDatabase,
              $SyncMetadataRowsTable,
              SyncMetadataRow
            >,
          ),
          SyncMetadataRow,
          PrefetchHooks Function()
        > {
  $$SyncMetadataRowsTableTableManager(
    _$IdeallDatabase db,
    $SyncMetadataRowsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SyncMetadataRowsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SyncMetadataRowsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SyncMetadataRowsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> scope = const Value.absent(),
                Value<String?> localGeneration = const Value.absent(),
                Value<String?> remoteGeneration = const Value.absent(),
                Value<String?> manifestEtag = const Value.absent(),
                Value<String> vectorJson = const Value.absent(),
                Value<bool> dirty = const Value.absent(),
                Value<int?> lastSyncedAtMs = const Value.absent(),
                Value<String?> error = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SyncMetadataRowsCompanion(
                scope: scope,
                localGeneration: localGeneration,
                remoteGeneration: remoteGeneration,
                manifestEtag: manifestEtag,
                vectorJson: vectorJson,
                dirty: dirty,
                lastSyncedAtMs: lastSyncedAtMs,
                error: error,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String scope,
                Value<String?> localGeneration = const Value.absent(),
                Value<String?> remoteGeneration = const Value.absent(),
                Value<String?> manifestEtag = const Value.absent(),
                Value<String> vectorJson = const Value.absent(),
                Value<bool> dirty = const Value.absent(),
                Value<int?> lastSyncedAtMs = const Value.absent(),
                Value<String?> error = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SyncMetadataRowsCompanion.insert(
                scope: scope,
                localGeneration: localGeneration,
                remoteGeneration: remoteGeneration,
                manifestEtag: manifestEtag,
                vectorJson: vectorJson,
                dirty: dirty,
                lastSyncedAtMs: lastSyncedAtMs,
                error: error,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SyncMetadataRowsTableProcessedTableManager =
    ProcessedTableManager<
      _$IdeallDatabase,
      $SyncMetadataRowsTable,
      SyncMetadataRow,
      $$SyncMetadataRowsTableFilterComposer,
      $$SyncMetadataRowsTableOrderingComposer,
      $$SyncMetadataRowsTableAnnotationComposer,
      $$SyncMetadataRowsTableCreateCompanionBuilder,
      $$SyncMetadataRowsTableUpdateCompanionBuilder,
      (
        SyncMetadataRow,
        BaseReferences<
          _$IdeallDatabase,
          $SyncMetadataRowsTable,
          SyncMetadataRow
        >,
      ),
      SyncMetadataRow,
      PrefetchHooks Function()
    >;
typedef $$SyncTombstoneRowsTableCreateCompanionBuilder =
    SyncTombstoneRowsCompanion Function({
      required String scope,
      required String entityId,
      required int deletedAtMs,
      Value<int> revision,
      Value<int> rowid,
    });
typedef $$SyncTombstoneRowsTableUpdateCompanionBuilder =
    SyncTombstoneRowsCompanion Function({
      Value<String> scope,
      Value<String> entityId,
      Value<int> deletedAtMs,
      Value<int> revision,
      Value<int> rowid,
    });

class $$SyncTombstoneRowsTableFilterComposer
    extends Composer<_$IdeallDatabase, $SyncTombstoneRowsTable> {
  $$SyncTombstoneRowsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get scope => $composableBuilder(
    column: $table.scope,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get entityId => $composableBuilder(
    column: $table.entityId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get deletedAtMs => $composableBuilder(
    column: $table.deletedAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get revision => $composableBuilder(
    column: $table.revision,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SyncTombstoneRowsTableOrderingComposer
    extends Composer<_$IdeallDatabase, $SyncTombstoneRowsTable> {
  $$SyncTombstoneRowsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get scope => $composableBuilder(
    column: $table.scope,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get entityId => $composableBuilder(
    column: $table.entityId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get deletedAtMs => $composableBuilder(
    column: $table.deletedAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get revision => $composableBuilder(
    column: $table.revision,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SyncTombstoneRowsTableAnnotationComposer
    extends Composer<_$IdeallDatabase, $SyncTombstoneRowsTable> {
  $$SyncTombstoneRowsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get scope =>
      $composableBuilder(column: $table.scope, builder: (column) => column);

  GeneratedColumn<String> get entityId =>
      $composableBuilder(column: $table.entityId, builder: (column) => column);

  GeneratedColumn<int> get deletedAtMs => $composableBuilder(
    column: $table.deletedAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<int> get revision =>
      $composableBuilder(column: $table.revision, builder: (column) => column);
}

class $$SyncTombstoneRowsTableTableManager
    extends
        RootTableManager<
          _$IdeallDatabase,
          $SyncTombstoneRowsTable,
          SyncTombstoneRow,
          $$SyncTombstoneRowsTableFilterComposer,
          $$SyncTombstoneRowsTableOrderingComposer,
          $$SyncTombstoneRowsTableAnnotationComposer,
          $$SyncTombstoneRowsTableCreateCompanionBuilder,
          $$SyncTombstoneRowsTableUpdateCompanionBuilder,
          (
            SyncTombstoneRow,
            BaseReferences<
              _$IdeallDatabase,
              $SyncTombstoneRowsTable,
              SyncTombstoneRow
            >,
          ),
          SyncTombstoneRow,
          PrefetchHooks Function()
        > {
  $$SyncTombstoneRowsTableTableManager(
    _$IdeallDatabase db,
    $SyncTombstoneRowsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SyncTombstoneRowsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SyncTombstoneRowsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SyncTombstoneRowsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> scope = const Value.absent(),
                Value<String> entityId = const Value.absent(),
                Value<int> deletedAtMs = const Value.absent(),
                Value<int> revision = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SyncTombstoneRowsCompanion(
                scope: scope,
                entityId: entityId,
                deletedAtMs: deletedAtMs,
                revision: revision,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String scope,
                required String entityId,
                required int deletedAtMs,
                Value<int> revision = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SyncTombstoneRowsCompanion.insert(
                scope: scope,
                entityId: entityId,
                deletedAtMs: deletedAtMs,
                revision: revision,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SyncTombstoneRowsTableProcessedTableManager =
    ProcessedTableManager<
      _$IdeallDatabase,
      $SyncTombstoneRowsTable,
      SyncTombstoneRow,
      $$SyncTombstoneRowsTableFilterComposer,
      $$SyncTombstoneRowsTableOrderingComposer,
      $$SyncTombstoneRowsTableAnnotationComposer,
      $$SyncTombstoneRowsTableCreateCompanionBuilder,
      $$SyncTombstoneRowsTableUpdateCompanionBuilder,
      (
        SyncTombstoneRow,
        BaseReferences<
          _$IdeallDatabase,
          $SyncTombstoneRowsTable,
          SyncTombstoneRow
        >,
      ),
      SyncTombstoneRow,
      PrefetchHooks Function()
    >;
typedef $$ActivityRowsTableCreateCompanionBuilder =
    ActivityRowsCompanion Function({
      required String id,
      required String type,
      Value<String?> nodeId,
      required int occurredAtMs,
      Value<String> detailsJson,
      Value<int> rowid,
    });
typedef $$ActivityRowsTableUpdateCompanionBuilder =
    ActivityRowsCompanion Function({
      Value<String> id,
      Value<String> type,
      Value<String?> nodeId,
      Value<int> occurredAtMs,
      Value<String> detailsJson,
      Value<int> rowid,
    });

final class $$ActivityRowsTableReferences
    extends BaseReferences<_$IdeallDatabase, $ActivityRowsTable, ActivityRow> {
  $$ActivityRowsTableReferences(super.$_db, super.$_table, super.$_typedResult);

  static $LibraryNodeRowsTable _nodeIdTable(_$IdeallDatabase db) => db
      .libraryNodeRows
      .createAlias('activity_rows__node_id__library_node_rows__id');

  $$LibraryNodeRowsTableProcessedTableManager? get nodeId {
    final $_column = $_itemColumn<String>('node_id');
    if ($_column == null) return null;
    final manager = $$LibraryNodeRowsTableTableManager(
      $_db,
      $_db.libraryNodeRows,
    ).filter((f) => f.id.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_nodeIdTable($_db));
    if (item == null) return manager;
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }
}

class $$ActivityRowsTableFilterComposer
    extends Composer<_$IdeallDatabase, $ActivityRowsTable> {
  $$ActivityRowsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get occurredAtMs => $composableBuilder(
    column: $table.occurredAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get detailsJson => $composableBuilder(
    column: $table.detailsJson,
    builder: (column) => ColumnFilters(column),
  );

  $$LibraryNodeRowsTableFilterComposer get nodeId {
    final $$LibraryNodeRowsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.nodeId,
      referencedTable: $db.libraryNodeRows,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LibraryNodeRowsTableFilterComposer(
            $db: $db,
            $table: $db.libraryNodeRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$ActivityRowsTableOrderingComposer
    extends Composer<_$IdeallDatabase, $ActivityRowsTable> {
  $$ActivityRowsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get occurredAtMs => $composableBuilder(
    column: $table.occurredAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get detailsJson => $composableBuilder(
    column: $table.detailsJson,
    builder: (column) => ColumnOrderings(column),
  );

  $$LibraryNodeRowsTableOrderingComposer get nodeId {
    final $$LibraryNodeRowsTableOrderingComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.nodeId,
      referencedTable: $db.libraryNodeRows,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LibraryNodeRowsTableOrderingComposer(
            $db: $db,
            $table: $db.libraryNodeRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$ActivityRowsTableAnnotationComposer
    extends Composer<_$IdeallDatabase, $ActivityRowsTable> {
  $$ActivityRowsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<int> get occurredAtMs => $composableBuilder(
    column: $table.occurredAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<String> get detailsJson => $composableBuilder(
    column: $table.detailsJson,
    builder: (column) => column,
  );

  $$LibraryNodeRowsTableAnnotationComposer get nodeId {
    final $$LibraryNodeRowsTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.nodeId,
      referencedTable: $db.libraryNodeRows,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LibraryNodeRowsTableAnnotationComposer(
            $db: $db,
            $table: $db.libraryNodeRows,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$ActivityRowsTableTableManager
    extends
        RootTableManager<
          _$IdeallDatabase,
          $ActivityRowsTable,
          ActivityRow,
          $$ActivityRowsTableFilterComposer,
          $$ActivityRowsTableOrderingComposer,
          $$ActivityRowsTableAnnotationComposer,
          $$ActivityRowsTableCreateCompanionBuilder,
          $$ActivityRowsTableUpdateCompanionBuilder,
          (ActivityRow, $$ActivityRowsTableReferences),
          ActivityRow,
          PrefetchHooks Function({bool nodeId})
        > {
  $$ActivityRowsTableTableManager(_$IdeallDatabase db, $ActivityRowsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ActivityRowsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ActivityRowsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ActivityRowsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> type = const Value.absent(),
                Value<String?> nodeId = const Value.absent(),
                Value<int> occurredAtMs = const Value.absent(),
                Value<String> detailsJson = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => ActivityRowsCompanion(
                id: id,
                type: type,
                nodeId: nodeId,
                occurredAtMs: occurredAtMs,
                detailsJson: detailsJson,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String type,
                Value<String?> nodeId = const Value.absent(),
                required int occurredAtMs,
                Value<String> detailsJson = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => ActivityRowsCompanion.insert(
                id: id,
                type: type,
                nodeId: nodeId,
                occurredAtMs: occurredAtMs,
                detailsJson: detailsJson,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable(table),
                  $$ActivityRowsTableReferences(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: ({nodeId = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [],
              addJoins:
                  <
                    T extends TableManagerState<
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic
                    >
                  >(state) {
                    if (nodeId) {
                      state =
                          state.withJoin(
                                currentTable: table,
                                currentColumn: table.nodeId,
                                referencedTable: $$ActivityRowsTableReferences
                                    ._nodeIdTable(db),
                                referencedColumn: $$ActivityRowsTableReferences
                                    ._nodeIdTable(db)
                                    .id,
                              )
                              as T;
                    }

                    return state;
                  },
              getPrefetchedDataCallback: (items) async {
                return [];
              },
            );
          },
        ),
      );
}

typedef $$ActivityRowsTableProcessedTableManager =
    ProcessedTableManager<
      _$IdeallDatabase,
      $ActivityRowsTable,
      ActivityRow,
      $$ActivityRowsTableFilterComposer,
      $$ActivityRowsTableOrderingComposer,
      $$ActivityRowsTableAnnotationComposer,
      $$ActivityRowsTableCreateCompanionBuilder,
      $$ActivityRowsTableUpdateCompanionBuilder,
      (ActivityRow, $$ActivityRowsTableReferences),
      ActivityRow,
      PrefetchHooks Function({bool nodeId})
    >;

class $IdeallDatabaseManager {
  final _$IdeallDatabase _db;
  $IdeallDatabaseManager(this._db);
  $$LibraryNodeRowsTableTableManager get libraryNodeRows =>
      $$LibraryNodeRowsTableTableManager(_db, _db.libraryNodeRows);
  $$SubscriptionRowsTableTableManager get subscriptionRows =>
      $$SubscriptionRowsTableTableManager(_db, _db.subscriptionRows);
  $$PublicationLinkRowsTableTableManager get publicationLinkRows =>
      $$PublicationLinkRowsTableTableManager(_db, _db.publicationLinkRows);
  $$SyncMetadataRowsTableTableManager get syncMetadataRows =>
      $$SyncMetadataRowsTableTableManager(_db, _db.syncMetadataRows);
  $$SyncTombstoneRowsTableTableManager get syncTombstoneRows =>
      $$SyncTombstoneRowsTableTableManager(_db, _db.syncTombstoneRows);
  $$ActivityRowsTableTableManager get activityRows =>
      $$ActivityRowsTableTableManager(_db, _db.activityRows);
}
