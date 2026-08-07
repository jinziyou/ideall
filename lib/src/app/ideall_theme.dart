import 'package:flutter/material.dart';

abstract final class IdeallColors {
  static const canvas = Color(0xFFF3F5F2);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFF8FAF8);
  static const ink = Color(0xFF1C211E);
  static const inkMuted = Color(0xFF69716C);
  static const border = Color(0xFFE3E7E4);
  static const accent = Color(0xFF16825D);
  static const accentHover = Color(0xFF0F6C4D);
  static const accentSoft = Color(0xFFE4F3EB);
  static const selection = Color(0xFFDAF0E4);
  static const warning = Color(0xFFB25E09);
  static const danger = Color(0xFFB3261E);
}

ThemeData buildIdeallTheme() {
  const scheme = ColorScheme.light(
    primary: IdeallColors.accent,
    onPrimary: Colors.white,
    primaryContainer: IdeallColors.accentSoft,
    onPrimaryContainer: IdeallColors.ink,
    secondary: Color(0xFF46655A),
    onSecondary: Colors.white,
    surface: IdeallColors.surface,
    onSurface: IdeallColors.ink,
    error: IdeallColors.danger,
    onError: Colors.white,
    outline: IdeallColors.border,
    outlineVariant: Color(0xFFEDF0ED),
  );

  final base = ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: IdeallColors.canvas,
    fontFamilyFallback: const [
      'Inter',
      'SF Pro Text',
      'Segoe UI',
      'Noto Sans CJK SC',
      'sans-serif',
    ],
    visualDensity: VisualDensity.standard,
  );

  return base.copyWith(
    textTheme: base.textTheme.copyWith(
      displaySmall: base.textTheme.displaySmall?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -1.2,
        color: IdeallColors.ink,
      ),
      headlineMedium: base.textTheme.headlineMedium?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.5,
        color: IdeallColors.ink,
      ),
      titleLarge: base.textTheme.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
        color: IdeallColors.ink,
      ),
      titleMedium: base.textTheme.titleMedium?.copyWith(
        fontWeight: FontWeight.w600,
        color: IdeallColors.ink,
      ),
      bodyLarge: base.textTheme.bodyLarge?.copyWith(
        height: 1.5,
        color: IdeallColors.ink,
      ),
      bodyMedium: base.textTheme.bodyMedium?.copyWith(
        height: 1.45,
        color: IdeallColors.ink,
      ),
      bodySmall: base.textTheme.bodySmall?.copyWith(
        color: IdeallColors.inkMuted,
      ),
      labelLarge: base.textTheme.labelLarge?.copyWith(
        fontWeight: FontWeight.w600,
      ),
    ),
    appBarTheme: const AppBarTheme(
      elevation: 0,
      scrolledUnderElevation: 0,
      backgroundColor: Colors.transparent,
      foregroundColor: IdeallColors.ink,
      surfaceTintColor: Colors.transparent,
      centerTitle: false,
    ),
    cardTheme: const CardThemeData(
      elevation: 0,
      color: IdeallColors.surface,
      surfaceTintColor: Colors.transparent,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(16)),
        side: BorderSide(color: IdeallColors.border),
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: IdeallColors.border,
      thickness: 1,
      space: 1,
    ),
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: IdeallColors.surface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: IdeallColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: IdeallColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: IdeallColors.accent, width: 1.5),
      ),
      contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 13),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 44),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 44),
        side: const BorderSide(color: IdeallColors.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: IdeallColors.surfaceMuted,
      selectedColor: IdeallColors.accentSoft,
      side: const BorderSide(color: IdeallColors.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
    ),
    navigationBarTheme: const NavigationBarThemeData(
      elevation: 0,
      height: 68,
      backgroundColor: IdeallColors.surface,
      indicatorColor: IdeallColors.accentSoft,
      surfaceTintColor: Colors.transparent,
    ),
    navigationRailTheme: const NavigationRailThemeData(
      elevation: 0,
      backgroundColor: IdeallColors.surface,
      indicatorColor: IdeallColors.accentSoft,
      selectedIconTheme: IconThemeData(color: IdeallColors.accent),
      selectedLabelTextStyle: TextStyle(
        color: IdeallColors.accent,
        fontWeight: FontWeight.w600,
      ),
      unselectedIconTheme: IconThemeData(color: IdeallColors.inkMuted),
      unselectedLabelTextStyle: TextStyle(color: IdeallColors.inkMuted),
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: IdeallColors.ink,
      contentTextStyle: TextStyle(color: Colors.white),
    ),
  );
}
