import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/core/router/app_router.dart';
import 'package:eventpass/features/auth/domain/entities/user.dart';
import 'package:eventpass/features/auth/presentation/bloc/auth_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

// The route guard (F5) as a pure function of (auth state, location).
void main() {
  const ada = User(id: 'u1', name: 'Ada', email: 'ada@example.com');

  test('while the session is unknown, everything goes to the splash', () {
    expect(authRedirect(const AuthInitial(), AppRoutes.home), AppRoutes.splash);
    expect(authRedirect(const AuthInitial(), AppRoutes.splash), isNull);
  });

  test('signed out: protected routes redirect to /login', () {
    expect(
      authRedirect(const Unauthenticated(), AppRoutes.home),
      AppRoutes.login,
    );
    expect(
      authRedirect(const Unauthenticated(), AppRoutes.splash),
      AppRoutes.login,
    );
    expect(
      authRedirect(
        const Unauthenticated(failure: UnauthorizedFailure()),
        '/anything/protected',
      ),
      AppRoutes.login,
    );
  });

  test('signed out: the login and register pages stay reachable', () {
    expect(authRedirect(const Unauthenticated(), AppRoutes.login), isNull);
    expect(authRedirect(const Unauthenticated(), AppRoutes.register), isNull);
  });

  test('signed in: auth pages and splash lead to /home; other routes stay', () {
    expect(
      authRedirect(const Authenticated(ada), AppRoutes.login),
      AppRoutes.home,
    );
    expect(
      authRedirect(const Authenticated(ada), AppRoutes.register),
      AppRoutes.home,
    );
    expect(
      authRedirect(const Authenticated(ada), AppRoutes.splash),
      AppRoutes.home,
    );
    expect(authRedirect(const Authenticated(ada), AppRoutes.home), isNull);
  });

  test('a request in progress keeps the user on the current page', () {
    expect(authRedirect(const AuthLoading(), AppRoutes.login), isNull);
  });
}
