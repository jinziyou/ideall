import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ServiceEndpointController extends ChangeNotifier {
  static const _preferenceKey = 'ideall.wonitaEndpoint';
  static const defaultEndpoint = 'https://api.wonita.link';

  String _endpoint = defaultEndpoint;

  String get endpoint => _endpoint;

  Future<void> load() async {
    final preferences = await SharedPreferences.getInstance();
    final stored = preferences.getString(_preferenceKey);
    if (_isValid(stored)) _endpoint = stored!;
  }

  Future<void> setEndpoint(String value) async {
    final normalized = value.trim().replaceFirst(RegExp(r'/+$'), '');
    if (!_isValid(normalized)) {
      throw const FormatException('The Wonita endpoint must use HTTPS.');
    }
    if (_endpoint == normalized) return;
    _endpoint = normalized;
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_preferenceKey, normalized);
    notifyListeners();
  }

  bool _isValid(String? value) {
    final uri = value == null ? null : Uri.tryParse(value);
    return uri != null && uri.scheme == 'https' && uri.hasAuthority;
  }
}
