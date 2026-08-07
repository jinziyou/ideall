import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ideall/src/app/ideall_app.dart';
import 'package:ideall/src/app/locale_controller.dart';
import 'package:ideall/src/app/providers.dart';
import 'package:ideall/src/app/service_endpoint_controller.dart';
import 'package:ideall/src/data/data.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('starts locally on the five-section information terminal', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final database = IdeallDatabase.forTesting(NativeDatabase.memory());

    await tester.pumpWidget(
      ProviderScope(
        overrides: [ideallDatabaseProvider.overrideWithValue(database)],
        child: IdeallApp(
          localeController: IdeallLocaleController(),
          endpointController: ServiceEndpointController(),
          deviceId: 'test-device',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('My information'), findsOneWidget);
    expect(find.text('Mine'), findsOneWidget);
    expect(find.text('Browse'), findsOneWidget);
    expect(find.text('Connect'), findsOneWidget);
    expect(find.text('Settings'), findsOneWidget);

    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(MenuItemButton, 'New note'), findsOneWidget);
    expect(find.widgetWithText(MenuItemButton, 'New folder'), findsOneWidget);
    expect(find.widgetWithText(MenuItemButton, 'New bookmark'), findsOneWidget);

    // Let Drift's zero-duration stream cleanup timer run after unmounting.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(milliseconds: 1));
    await database.close();
    await tester.pump(const Duration(milliseconds: 1));
  });
}
