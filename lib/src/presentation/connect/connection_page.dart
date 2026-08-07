import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ideall/l10n/app_localizations.dart';

import '../../app/ideall_theme.dart';
import '../widgets/page_frame.dart';

class ConnectionAccountViewData {
  const ConnectionAccountViewData({required this.label, this.email});

  final String label;
  final String? email;
}

class ConnectionPage extends StatefulWidget {
  const ConnectionPage({
    required this.loadAccount,
    required this.signIn,
    required this.register,
    required this.signOut,
    required this.syncNow,
    required this.generateSyncCode,
    super.key,
  });

  final Future<ConnectionAccountViewData?> Function() loadAccount;
  final Future<void> Function(String email, String password) signIn;
  final Future<void> Function(String email, String password, String displayName)
  register;
  final Future<void> Function() signOut;
  final Future<void> Function(String syncCode) syncNow;
  final Future<String> Function() generateSyncCode;

  @override
  State<ConnectionPage> createState() => _ConnectionPageState();
}

class _ConnectionPageState extends State<ConnectionPage> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _displayNameController = TextEditingController();
  final _syncCodeController = TextEditingController();
  ConnectionAccountViewData? _account;
  bool _registering = false;
  bool _busy = false;
  bool _hidePassword = true;
  bool _hideSyncCode = true;
  String? _error;
  String? _syncMessage;

  @override
  void initState() {
    super.initState();
    _refreshAccount();
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _displayNameController.dispose();
    _syncCodeController.dispose();
    super.dispose();
  }

  Future<void> _refreshAccount() async {
    try {
      final account = await widget.loadAccount();
      if (mounted) setState(() => _account = account);
    } catch (_) {
      // A missing/expired local session simply means signed out.
    }
  }

  Future<void> _authenticate() async {
    if (_busy) return;
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    if (email.isEmpty || password.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_registering) {
        await widget.register(
          email,
          password,
          _displayNameController.text.trim(),
        );
      } else {
        await widget.signIn(email, password);
      }
      _passwordController.clear();
      await _refreshAccount();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
      await _refreshAccount();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signOut() async {
    setState(() => _busy = true);
    try {
      await widget.signOut();
      if (mounted) setState(() => _account = null);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _generateCode() async {
    final code = await widget.generateSyncCode();
    if (!mounted) return;
    setState(() => _syncCodeController.text = code);
  }

  Future<void> _sync() async {
    final localizations = AppLocalizations.of(context);
    final code = _syncCodeController.text.trim().toLowerCase();
    if (!RegExp(r'^[0-9a-f]{32}$').hasMatch(code)) {
      setState(() => _syncMessage = localizations.syncCodeHint);
      return;
    }
    setState(() {
      _busy = true;
      _syncMessage = null;
    });
    try {
      await widget.syncNow(code);
      if (mounted) setState(() => _syncMessage = localizations.syncComplete);
    } catch (error) {
      if (mounted) {
        setState(() => _syncMessage = '${localizations.syncFailed}: $error');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context);
    return PageFrame(
      title: localizations.connectTitle,
      subtitle: localizations.localFirstHeadline,
      maxWidth: 920,
      child: Column(
        children: [
          if (_account == null)
            SectionCard(
              title: localizations.account,
              subtitle: localizations.notSignedIn,
              child: Column(
                children: [
                  SegmentedButton<bool>(
                    segments: [
                      ButtonSegment(
                        value: false,
                        label: Text(localizations.signIn),
                        icon: const Icon(Icons.login_rounded),
                      ),
                      ButtonSegment(
                        value: true,
                        label: Text(localizations.register),
                        icon: const Icon(Icons.person_add_alt_1_rounded),
                      ),
                    ],
                    selected: {_registering},
                    onSelectionChanged: (selection) =>
                        setState(() => _registering = selection.single),
                  ),
                  const SizedBox(height: 18),
                  if (_registering) ...[
                    TextField(
                      controller: _displayNameController,
                      textInputAction: TextInputAction.next,
                      decoration: InputDecoration(
                        labelText: localizations.displayName,
                        prefixIcon: const Icon(Icons.badge_outlined),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  TextField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    autocorrect: false,
                    decoration: InputDecoration(
                      labelText: localizations.email,
                      prefixIcon: const Icon(Icons.alternate_email_rounded),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _passwordController,
                    obscureText: _hidePassword,
                    onSubmitted: (_) => _authenticate(),
                    decoration: InputDecoration(
                      labelText: localizations.password,
                      prefixIcon: const Icon(Icons.lock_outline_rounded),
                      suffixIcon: IconButton(
                        onPressed: () =>
                            setState(() => _hidePassword = !_hidePassword),
                        icon: Icon(
                          _hidePassword
                              ? Icons.visibility_outlined
                              : Icons.visibility_off_outlined,
                        ),
                      ),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        _error!,
                        style: const TextStyle(color: IdeallColors.danger),
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _busy ? null : _authenticate,
                      child: Text(
                        _registering
                            ? localizations.register
                            : localizations.signIn,
                      ),
                    ),
                  ),
                ],
              ),
            )
          else
            SectionCard(
              title: _account!.label,
              subtitle: _account!.email,
              trailing: OutlinedButton.icon(
                onPressed: _busy ? null : _signOut,
                icon: const Icon(Icons.logout_rounded),
                label: Text(localizations.signOut),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.verified_user_outlined,
                    color: IdeallColors.accent,
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: Text(localizations.offlineReady)),
                ],
              ),
            ),
          const SizedBox(height: 16),
          SectionCard(
            title: localizations.sync,
            subtitle: localizations.localDataNotice,
            child: Column(
              children: [
                TextField(
                  controller: _syncCodeController,
                  obscureText: _hideSyncCode,
                  enableSuggestions: false,
                  autocorrect: false,
                  maxLength: 32,
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp('[0-9a-fA-F]')),
                  ],
                  decoration: InputDecoration(
                    labelText: localizations.syncCode,
                    helperText: localizations.syncCodeHint,
                    prefixIcon: const Icon(Icons.key_rounded),
                    suffixIcon: IconButton(
                      onPressed: () =>
                          setState(() => _hideSyncCode = !_hideSyncCode),
                      icon: Icon(
                        _hideSyncCode
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _generateCode,
                      icon: const Icon(Icons.casino_outlined),
                      label: Text(localizations.generateSyncCode),
                    ),
                    OutlinedButton.icon(
                      onPressed: () async {
                        await Clipboard.setData(
                          ClipboardData(text: _syncCodeController.text),
                        );
                      },
                      icon: const Icon(Icons.copy_rounded),
                      label: Text(localizations.copySyncCode),
                    ),
                    FilledButton.icon(
                      onPressed: _account == null || _busy ? null : _sync,
                      icon: const Icon(Icons.sync_rounded),
                      label: Text(localizations.syncNow),
                    ),
                  ],
                ),
                if (_syncMessage != null) ...[
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(_syncMessage!),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
