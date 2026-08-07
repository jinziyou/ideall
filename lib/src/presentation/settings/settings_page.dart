import 'package:flutter/material.dart';
import 'package:ideall/l10n/app_localizations.dart';

import '../../app/ideall_theme.dart';
import '../../app/locale_controller.dart';
import '../widgets/page_frame.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({
    required this.localeController,
    required this.serviceEndpoint,
    required this.onServiceEndpointChanged,
    required this.onExport,
    required this.onImport,
    required this.onRebuildIndex,
    super.key,
  });

  final IdeallLocaleController localeController;
  final String serviceEndpoint;
  final ValueChanged<String> onServiceEndpointChanged;
  final Future<bool> Function() onExport;
  final Future<bool> Function() onImport;
  final Future<bool> Function() onRebuildIndex;

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  late final TextEditingController _endpointController;

  @override
  void initState() {
    super.initState();
    _endpointController = TextEditingController(text: widget.serviceEndpoint);
  }

  @override
  void dispose() {
    _endpointController.dispose();
    super.dispose();
  }

  Future<void> _run(Future<bool> Function() action, String success) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final completed = await action();
      if (completed && mounted) {
        messenger.showSnackBar(SnackBar(content: Text(success)));
      }
    } catch (error) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    final localeValue =
        widget.localeController.locale?.languageCode ?? 'system';
    return PageFrame(
      title: localizations.settingsTitle,
      subtitle: localizations.localFirstHeadline,
      maxWidth: 900,
      child: Column(
        children: [
          SectionCard(
            title: localizations.language,
            child: DropdownButtonFormField<String>(
              initialValue: localeValue,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.translate_rounded),
                labelText: localizations.language,
              ),
              items: [
                DropdownMenuItem(
                  value: 'system',
                  child: Text(localizations.systemLanguage),
                ),
                DropdownMenuItem(
                  value: 'zh',
                  child: Text(localizations.chinese),
                ),
                DropdownMenuItem(
                  value: 'en',
                  child: Text(localizations.english),
                ),
              ],
              onChanged: (value) {
                widget.localeController.setLocale(
                  value == null || value == 'system' ? null : Locale(value),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          SectionCard(
            title: localizations.data,
            subtitle: localizations.localDataNotice,
            child: Column(
              children: [
                _SettingsAction(
                  icon: Icons.file_upload_outlined,
                  title: localizations.exportData,
                  onTap: () => _run(widget.onExport, localizations.done),
                ),
                const Divider(),
                _SettingsAction(
                  icon: Icons.file_download_outlined,
                  title: localizations.importData,
                  onTap: () => _run(widget.onImport, localizations.done),
                ),
                const Divider(),
                _SettingsAction(
                  icon: Icons.manage_search_rounded,
                  title: localizations.rebuildIndex,
                  onTap: () => _run(widget.onRebuildIndex, localizations.done),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          SectionCard(
            title: localizations.endpoint,
            child: TextField(
              controller: _endpointController,
              keyboardType: TextInputType.url,
              autocorrect: false,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.dns_outlined),
                hintText: 'https://api.wonita.link',
              ),
              onSubmitted: (value) {
                final uri = Uri.tryParse(value.trim());
                if (uri != null && uri.scheme == 'https') {
                  widget.onServiceEndpointChanged(value.trim());
                } else {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(localizations.errorGeneric)),
                  );
                }
              },
            ),
          ),
          const SizedBox(height: 16),
          SectionCard(
            title: localizations.about,
            child: Row(
              children: [
                const _AboutMark(),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      const Text(
                        'Ideall 0.1.0',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        localizations.aboutDescription,
                        style: const TextStyle(color: IdeallColors.inkMuted),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsAction extends StatelessWidget {
  const _SettingsAction({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon, color: IdeallColors.accent),
      title: Text(title),
      trailing: const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    );
  }
}

class _AboutMark extends StatelessWidget {
  const _AboutMark();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 48,
      height: 48,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: IdeallColors.accent,
        borderRadius: BorderRadius.circular(14),
      ),
      child: const Text(
        'i',
        style: TextStyle(
          color: Colors.white,
          fontSize: 28,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}
