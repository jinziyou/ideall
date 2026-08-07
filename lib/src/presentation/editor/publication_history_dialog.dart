import 'package:flutter/material.dart';
import 'package:ideall/l10n/app_localizations.dart';

import '../../app/ideall_theme.dart';

class PublicationVersionViewData {
  const PublicationVersionViewData({
    required this.version,
    required this.title,
    required this.state,
    required this.visibility,
    required this.createdAt,
  });

  final int version;
  final String title;
  final String state;
  final String visibility;
  final DateTime createdAt;
}

class PublicationHistoryDialog extends StatefulWidget {
  const PublicationHistoryDialog({
    required this.load,
    required this.restore,
    super.key,
  });

  final Future<List<PublicationVersionViewData>> Function() load;
  final Future<void> Function(int version) restore;

  @override
  State<PublicationHistoryDialog> createState() =>
      _PublicationHistoryDialogState();
}

class _PublicationHistoryDialogState extends State<PublicationHistoryDialog> {
  late Future<List<PublicationVersionViewData>> _versions = widget.load();
  int? _restoring;

  Future<void> _restore(int version) async {
    setState(() => _restoring = version);
    try {
      await widget.restore(version);
      if (mounted) {
        setState(() {
          _restoring = null;
          _versions = widget.load();
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() => _restoring = null);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(localizations.publicationHistory),
      content: SizedBox(
        width: 620,
        height: 440,
        child: FutureBuilder<List<PublicationVersionViewData>>(
          future: _versions,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return Center(child: Text(snapshot.error.toString()));
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final versions = snapshot.data!;
            if (versions.isEmpty) {
              return Center(child: Text(localizations.noResults));
            }
            return ListView.separated(
              itemCount: versions.length,
              separatorBuilder: (_, _) => const Divider(),
              itemBuilder: (context, index) {
                final item = versions[index];
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(
                    backgroundColor: IdeallColors.accentSoft,
                    foregroundColor: IdeallColors.accent,
                    child: Text('v${item.version}'),
                  ),
                  title: Text(item.title),
                  subtitle: Text(
                    '${_stateLabel(localizations, item.state)} · '
                    '${_visibilityLabel(localizations, item.visibility)} · '
                    '${MaterialLocalizations.of(context).formatShortDate(item.createdAt)}',
                  ),
                  trailing: TextButton(
                    onPressed: _restoring == null
                        ? () => _restore(item.version)
                        : null,
                    child: _restoring == item.version
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(localizations.restoreVersion),
                  ),
                );
              },
            );
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(localizations.close),
        ),
      ],
    );
  }
}

String _stateLabel(AppLocalizations localizations, String state) =>
    switch (state) {
      'draft' => localizations.draft,
      'published' => localizations.published,
      'archived' => localizations.archived,
      _ => state,
    };

String _visibilityLabel(AppLocalizations localizations, String visibility) =>
    switch (visibility) {
      'public' => localizations.publicVisibility,
      'unlisted' => localizations.unlistedVisibility,
      'private' => localizations.privateVisibility,
      _ => visibility,
    };
