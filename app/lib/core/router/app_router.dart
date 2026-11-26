import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/bloc/auth_bloc.dart';
import '../../features/auth/presentation/pages/login_page.dart';
import '../../features/auth/presentation/pages/register_page.dart';

/// Route paths shared with Member 3 (who replaces the /home placeholder by
/// the real signed-in screens: events, tickets, dashboard).
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
      // TEMPORARY placeholder (lab §3.10) until Member 3's signed-in screens.
      GoRoute(
        path: AppRoutes.home,
        builder: (context, state) => const _SignedInPlaceholder(),
      ),
    ],
  );
}

class _SignedInPlaceholder extends StatelessWidget {
  const _SignedInPlaceholder();

  @override
  Widget build(BuildContext context) {
    final user = switch (context.watch<AuthBloc>().state) {
      Authenticated(:final user) => user,
      _ => null,
    };
    return Scaffold(
      appBar: AppBar(title: const Text('EventPass')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Signed in as ${user?.name ?? ''}'),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () =>
                  context.read<AuthBloc>().add(const AuthLogoutRequested()),
              child: const Text('Sign out'),
            ),
          ],
        ),
      ),
    );
  }
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
