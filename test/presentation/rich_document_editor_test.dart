import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/l10n/app_localizations.dart';
import 'package:ideall/src/presentation/editor/rich_document_editor.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> pumpEditor(
    WidgetTester tester, {
    required Future<void> Function(EditorSnapshot snapshot) onSave,
    FutureOr<void> Function()? onBack,
    Future<void> Function(EditorSnapshot snapshot)? onUploadDraft,
    Future<void> Function(EditorSnapshot snapshot)? onPublish,
  }) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          ...AppLocalizations.localizationsDelegates,
          FlutterQuillLocalizations.delegate,
        ],
        home: Scaffold(
          body: RichDocumentEditor(
            initialTitle: 'Note',
            initialDeltaJson: '[{"insert":"\\n"}]',
            onSave: onSave,
            onBack: onBack,
            onUploadDraft: onUploadDraft,
            onPublish: onPublish,
          ),
        ),
      ),
    );
    await tester.pump();
  }

  QuillController controllerOf(WidgetTester tester) =>
      tester.widget<QuillEditor>(find.byType(QuillEditor)).controller;

  testWidgets('document autosave keeps listening after the first save', (
    tester,
  ) async {
    final saved = <EditorSnapshot>[];
    await pumpEditor(tester, onSave: (snapshot) async => saved.add(snapshot));

    final controller = controllerOf(tester);
    controller.document.insert(0, 'first');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 701));
    await tester.pump();

    controller.document.insert(controller.document.length - 1, ' second');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 701));
    await tester.pump();

    expect(saved, hasLength(2));
    expect(saved.last.plainText, 'first second');
  });

  testWidgets('back waits for serialized saves and preserves the latest edit', (
    tester,
  ) async {
    final firstSave = Completer<void>();
    final saved = <EditorSnapshot>[];
    var calls = 0;
    var activeSaves = 0;
    var maxActiveSaves = 0;
    var didGoBack = false;

    await pumpEditor(
      tester,
      onSave: (snapshot) async {
        calls += 1;
        activeSaves += 1;
        if (activeSaves > maxActiveSaves) maxActiveSaves = activeSaves;
        if (calls == 1) await firstSave.future;
        saved.add(snapshot);
        activeSaves -= 1;
      },
      onBack: () => didGoBack = true,
    );

    final controller = controllerOf(tester);
    controller.document.insert(0, 'first');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 701));
    await tester.pump();
    expect(calls, 1);

    controller.document.insert(controller.document.length - 1, ' second');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('editor-back')));
    await tester.pump();

    expect(didGoBack, isFalse);
    expect(maxActiveSaves, 1);

    firstSave.complete();
    await tester.pumpAndSettle();

    expect(calls, 2);
    expect(maxActiveSaves, 1);
    expect(saved.last.plainText, 'first second');
    expect(didGoBack, isTrue);
  });

  testWidgets('cloud action is single-flight and reports failures', (
    tester,
  ) async {
    final upload = Completer<void>();
    var uploads = 0;
    await pumpEditor(
      tester,
      onSave: (_) async {},
      onUploadDraft: (_) async {
        uploads += 1;
        await upload.future;
      },
      onPublish: (_) async {},
    );

    final uploadButton = find.byKey(const ValueKey('upload-draft'));
    await tester.tap(uploadButton);
    await tester.tap(uploadButton);
    await tester.pump();

    expect(uploads, 1);
    expect(tester.widget<IconButton>(uploadButton).onPressed, isNull);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const ValueKey('publish-document')))
          .onPressed,
      isNull,
    );

    upload.completeError(StateError('offline'));
    await tester.pumpAndSettle();

    expect(find.textContaining('offline'), findsOneWidget);
  });
}
