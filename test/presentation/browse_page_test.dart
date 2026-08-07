import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ideall/l10n/app_localizations.dart';
import 'package:ideall/src/presentation/browse/article_reader_page.dart';
import 'package:ideall/src/presentation/browse/browse_page.dart';

Widget _app(Widget child) => MaterialApp(
  localizationsDelegates: const [
    AppLocalizations.delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: child),
);

void main() {
  testWidgets('browse keeps the latest query when requests overlap', (
    tester,
  ) async {
    final initial = Completer<List<BrowseItemViewData>>();
    final latest = Completer<List<BrowseItemViewData>>();

    await tester.pumpWidget(
      _app(
        BrowsePage(
          search: (query) => query.isEmpty ? initial.future : latest.future,
          onOpen: (_) {},
        ),
      ),
    );

    await tester.enterText(find.byType(SearchBar), 'latest');
    final searchBar = tester.widget<SearchBar>(find.byType(SearchBar));
    searchBar.onSubmitted!('latest');
    await tester.pump();

    latest.complete(const [
      BrowseItemViewData(id: 'latest', title: 'Latest result', excerpt: 'new'),
    ]);
    await tester.pumpAndSettle();
    expect(find.text('Latest result'), findsOneWidget);

    initial.complete(const [
      BrowseItemViewData(id: 'stale', title: 'Stale result', excerpt: 'old'),
    ]);
    await tester.pumpAndSettle();
    expect(find.text('Latest result'), findsOneWidget);
    expect(find.text('Stale result'), findsNothing);
  });

  testWidgets('article Markdown never loads embedded images', (tester) async {
    await tester.pumpWidget(
      _app(
        ArticleReaderPage(
          article: const ArticleViewData(
            title: 'Safe article',
            markdown: '![tracking pixel](file:///private/secret.png)',
          ),
          onBack: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });
}
