import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'src/app/ideall_app.dart';
import 'src/app/locale_controller.dart';
import 'src/app/service_endpoint_controller.dart';
import 'src/application/encrypted_sync_coordinator.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final localeController = IdeallLocaleController();
  final endpointController = ServiceEndpointController();
  await Future.wait([localeController.load(), endpointController.load()]);
  final deviceId = await EncryptedSyncCoordinator.loadOrCreateDeviceId();

  runApp(
    ProviderScope(
      child: IdeallApp(
        localeController: localeController,
        endpointController: endpointController,
        deviceId: deviceId,
      ),
    ),
  );
}
