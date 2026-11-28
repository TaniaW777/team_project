import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/bloc/auth_bloc.dart';
import '../../features/check_in/presentation/bloc/check_in_bloc.dart';
import '../../features/check_in/presentation/pages/check_in_scan_page.dart';
import '../../features/auth/presentation/pages/login_page.dart';
import '../../features/auth/presentation/pages/register_page.dart';
import '../../features/clubs/presentation/cubit/club_cubit.dart';
import '../../features/clubs/presentation/cubit/my_clubs_cubit.dart';
import '../../features/clubs/presentation/pages/club_events_page.dart';
import '../../features/clubs/presentation/pages/my_clubs_page.dart';
import '../../features/events/presentation/bloc/events_bloc.dart';
import '../../features/events/presentation/pages/events_list_page.dart';
import '../di/injection.dart';
import 'home_shell.dart';
import 'routes.dart';

export 'routes.dart';

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

/// Map of the app:
///
///   /splash, /login, /register                     (signed out)
///   HomeShell (bottom bar)
///     /home     events list       (EventsBloc)
///     /clubs    my clubs          (MyClubsCubit)
///   pushed on top of the tabs
///     /clubs/:clubId              club + its events  (ClubCubit, EventsBloc)
///
/// Every bloc/cubit is page-scoped: created by its route, closed with it.
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
      ShellRoute(
        builder: (context, state, child) =>
            HomeShell(location: state.matchedLocation, child: child),
        routes: [
          GoRoute(
            path: AppRoutes.home,
            builder: (context, state) => BlocProvider(
              create: (_) => sl<EventsBloc>()..add(const EventsStarted()),
              child: EventsListPage(
                // Pushed above the tabs, so the scanner has a back button.
                onScanRequested: () => context.push(AppRoutes.checkIn),
              ),
            ),
          ),
          GoRoute(
            path: AppRoutes.clubs,
            builder: (context, state) => BlocProvider(
              create: (_) => sl<MyClubsCubit>()..load(),
              child: const MyClubsPage(),
            ),
          ),
        ],
      ),
      // Member 4: QR scanner + offline outbox, behind the SAME auth guard.
      GoRoute(
        path: AppRoutes.checkIn,
        builder: (context, state) => BlocProvider(
          create: (_) => sl<CheckInBloc>()..add(const CheckInStarted()),
          child: const CheckInScanPage(),
        ),
      ),
      GoRoute(
        path: '/clubs/:clubId',
        builder: (context, state) {
          final clubId = state.pathParameters['clubId']!;
          return MultiBlocProvider(
            providers: [
              BlocProvider(create: (_) => sl<ClubCubit>()..load(clubId)),
              BlocProvider(
                create: (_) =>
                    sl<EventsBloc>(param1: clubId)..add(const EventsStarted()),
              ),
            ],
            child: ClubEventsPage(clubId: clubId),
          );
        },
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
