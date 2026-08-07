import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import '../domain/domain.dart';

final class LocalDataTransferService {
  const LocalDataTransferService(this.repository);

  static const _snapshotType = XTypeGroup(
    label: 'Ideall snapshot',
    extensions: ['json'],
    mimeTypes: ['application/json'],
    uniformTypeIdentifiers: ['public.json'],
  );

  final LibraryRepository repository;

  Future<bool> exportSnapshot() async {
    final snapshot = await repository.exportSnapshot();
    final date = DateFormat('yyyyMMdd-HHmmss').format(DateTime.now());
    final name = 'ideall-$date.json';
    final bytes = Uint8List.fromList(utf8.encode(snapshot.toJsonString()));

    // Mobile platforms do not implement file_selector's save-location API.
    // The system share sheet provides a native "Save to Files"/document target
    // while keeping the snapshot entirely under the user's control.
    if (Platform.isAndroid || Platform.isIOS) {
      final result = await SharePlus.instance.share(
        ShareParams(
          files: [
            XFile.fromData(bytes, mimeType: 'application/json', name: name),
          ],
          fileNameOverrides: [name],
        ),
      );
      return result.status != ShareResultStatus.unavailable;
    }

    final destination = await getSaveLocation(
      acceptedTypeGroups: const [_snapshotType],
      suggestedName: name,
    );
    if (destination == null) return false;
    await XFile.fromData(
      bytes,
      mimeType: 'application/json',
      name: name,
    ).saveTo(destination.path);
    return true;
  }

  Future<ImportResult?> importSnapshot() async {
    final source = await openFile(acceptedTypeGroups: const [_snapshotType]);
    if (source == null) return null;
    if (await source.length() > 64 * 1024 * 1024) {
      throw const FormatException('Snapshot exceeds the 64 MiB safety limit.');
    }
    final snapshot = LibrarySnapshot.fromJsonString(
      await source.readAsString(),
    );
    return repository.importSnapshot(snapshot);
  }
}
