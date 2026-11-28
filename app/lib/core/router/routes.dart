/// Every path of the app, in one place. Features import THIS file (not the
/// router) to navigate, so a path is never typed twice.
abstract final class AppRoutes {
  static const splash = '/splash';
  static const login = '/login';
  static const register = '/register';

  // The tabs of the signed-in area (bottom navigation bar).
  /// The events list (signed-in home).
  static const home = '/home';
  static const clubs = '/clubs';

  // Pages opened on top of the tabs.
  static String club(String clubId) => '/clubs/$clubId';
}
