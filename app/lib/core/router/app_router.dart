import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/bloc/auth_bloc.dart';
import '../../features/auth/presentation/pages/login_page.dart';
import '../../features/auth/presentation/pages/register_page.dart';
import '../../features/events/presentation/bloc/events_bloc.dart';
import '../../features/events/presentation/pages/events_list_page.dart';
import '../di/injection.dart';

/// Route paths. `/home` is the signed-in home: the events list (Member 3);
/// tickets and dashboard routes are added next to it.
abstract final class AppRoutes {
  static const splash = '/splash';
  static const login = '/login';
  static const register = '/register';
  static const home = '/home';
}

/// The route guard (F5): ONE pure function decides who can see what.
/// Pure so it can be unit-tested without widgets (test/core/router).
String? authRedirect(AuthState state, String location) {
  final onAuthPage =
      location == AppRoutes.login || location == AppRoutes.register;
  return switch (state) {
    AuthInitial() => location == AppRoutes.splash ? null : AppRoutes.splash,
    Authenticated() when onAuthPage || location == AppRoutes.splash =>
      AppRoutes.home,
    Unauthenticated() when !onAuthPage => AppRoutes.login,
    _ => null, // stay where you are (e.g. AuthLoading on the login page)
  };
}

GoRouter createRouter(AuthBloc authBloc) {
  return GoRouter(
    initialLocation: AppRoutes.splash,
    // Re-run `redirect` every time the auth state changes.
    refreshListenable: _StreamListenable(authBloc.stream),
    redirect: (context, state) =>
        authRedirect(authBloc.state, state.matchedLocation),
    routes: [
      GoRoute(
        path: AppRoutes.splash,
        builder: (context, state) =>
            const Scaffold(body: Center(child: CircularProgressIndicator())),
      ),
      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => const LoginPage(),
      ),
      GoRoute(
        path: AppRoutes.register,
        builder: (context, state) => const RegisterPage(),
      ),
      // Signed-in home: the events list (replaces the lab placeholder).
      GoRoute(
        path: AppRoutes.home,
        builder: (context, state) => BlocProvider(
          // Page-scoped bloc: created with the page, closed with it.
          create: (_) => sl<EventsBloc>()..add(const EventsStarted()),
          child: const EventsListPage(),
        ),
      ),
    ],
  );
}

/// Adapts a Stream (the bloc) to a Listenable (what go_router expects).
class _StreamListenable extends ChangeNotifier {
  _StreamListenable(Stream<Object?> stream) {
    _subscription = stream.listen((_) => notifyListeners());
  }

  late final StreamSubscription<Object?> _subscription;

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}
