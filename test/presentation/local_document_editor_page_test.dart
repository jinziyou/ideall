import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/l10n/app_localizations.dart';
import 'package:ideall/src/data/data.dart';
import 'package:ideall/src/domain/domain.dart';
import 'package:ideall/src/presentation/editor/local_document_editor_page.dart';
import 'package:ideall/src/presentation/editor/rich_document_editor.dart';

void main() {
  testWidgets('a non-document deep link is rejected', (tester) async {
    final database = IdeallDatabase.forTesting(NativeDatabase.memory());
    final repository = DriftLibraryRepository(database);
    await repository.createNode(
      CreateNodeInput(id: 'folder-1', kind: NodeKind.folder, title: 'Folder'),
    );

    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: LocalDocumentEditorPage(
          nodeId: 'folder-1',
          repository: repository,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Not found'), findsOneWidget);
    expect(find.byType(RichDocumentEditor), findsNothing);

    await tester.pumpWidget(const SizedBox.shrink());
    await database.close();
  });
}
