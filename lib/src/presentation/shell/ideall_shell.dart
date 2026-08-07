import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ideall/l10n/app_localizations.dart';

import '../../app/ideall_theme.dart';

class IdeallShell extends StatelessWidget {
  const IdeallShell({required this.child, super.key});

  final Widget child;

  static const _paths = <String>[
    '/mine',
    '/activity',
    '/browse',
    '/connect',
    '/settings',
  ];

  int _selectedIndex(BuildContext context) {
    final path = GoRouterState.of(context).uri.path;
    if (path.startsWith('/activity')) return 1;
    if (path.startsWith('/browse') || path.startsWith('/publication')) return 2;
    if (path.startsWith('/connect')) return 3;
    if (path.startsWith('/settings')) return 4;
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final index = _selectedIndex(context);
    final localizations = AppLocalizations.of(context);
    final labels = [
      localizations.navLibrary,
      localizations.navActivity,
      localizations.navBrowse,
      localizations.navConnect,
      localizations.navSettings,
    ];
    const icons = [
      Icons.space_dashboard_outlined,
      Icons.history_outlined,
      Icons.travel_explore_outlined,
      Icons.hub_outlined,
      Icons.tune_outlined,
    ];
    const selectedIcons = [
      Icons.space_dashboard_rounded,
      Icons.history_rounded,
      Icons.travel_explore_rounded,
      Icons.hub_rounded,
      Icons.tune_rounded,
    ];

    void select(int next) {
      if (next != index) context.go(_paths[next]);
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final desktop = constraints.maxWidth >= 840;
        if (!desktop) {
          return Scaffold(
            body: child,
            bottomNavigationBar: NavigationBar(
              selectedIndex: index,
              onDestinationSelected: select,
              destinations: [
                for (var i = 0; i < labels.length; i++)
                  NavigationDestination(
                    icon: Icon(icons[i]),
                    selectedIcon: Icon(selectedIcons[i]),
                    label: labels[i],
                  ),
              ],
            ),
          );
        }

        final extended = constraints.maxWidth >= 1280;
        return Scaffold(
          body: Row(
            children: [
              NavigationRail(
                selectedIndex: index,
                onDestinationSelected: select,
                extended: extended,
                minWidth: 76,
                minExtendedWidth: 196,
                leading: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 20, 12, 28),
                  child: extended ? const _Wordmark() : const _LogoMark(),
                ),
                destinations: [
                  for (var i = 0; i < labels.length; i++)
                    NavigationRailDestination(
                      icon: Icon(icons[i]),
                      selectedIcon: Icon(selectedIcons[i]),
                      label: Text(labels[i]),
                    ),
                ],
              ),
              const VerticalDivider(),
              Expanded(child: child),
            ],
          ),
        );
      },
    );
  }
}

class _LogoMark extends StatelessWidget {
  const _LogoMark();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        color: IdeallColors.accent,
        borderRadius: BorderRadius.circular(13),
      ),
      alignment: Alignment.center,
      child: const Text(
        'i',
        style: TextStyle(
          color: Colors.white,
          fontSize: 25,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) {
    return const Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _LogoMark(),
        SizedBox(width: 11),
        Text(
          'Ideall',
          style: TextStyle(
            color: IdeallColors.ink,
            fontWeight: FontWeight.w700,
            fontSize: 19,
            letterSpacing: -0.4,
          ),
        ),
      ],
    );
  }
}
