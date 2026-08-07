import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class IdeallLocaleController extends ChangeNotifier {
  static const _preferenceKey = 'ideall.locale';

  Locale? _locale;

  Locale? get locale => _locale;

  Future<void> load() async {
    final preferences = await SharedPreferences.getInstance();
    final languageCode = preferences.getString(_preferenceKey);
    _locale = languageCode == null ? null : Locale(languageCode);
  }

  Future<void> setLocale(Locale? value) async {
    if (_locale == value) return;
    _locale = value;
    final preferences = await SharedPreferences.getInstance();
    if (value == null) {
      await preferences.remove(_preferenceKey);
    } else {
      await preferences.setString(_preferenceKey, value.languageCode);
    }
    notifyListeners();
  }
}
