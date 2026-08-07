import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/data.dart';
import '../domain/domain.dart';

final ideallDatabaseProvider = Provider<IdeallDatabase>((ref) {
  final database = IdeallDatabase();
  ref.onDispose(database.close);
  return database;
});

final libraryRepositoryProvider = Provider<LibraryRepository>((ref) {
  return DriftLibraryRepository(ref.watch(ideallDatabaseProvider));
});
