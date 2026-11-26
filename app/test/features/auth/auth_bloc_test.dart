import 'dart:async';

import 'package:bloc_test/bloc_test.dart';
import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/core/result/result.dart';
import 'package:eventpass/features/auth/domain/entities/user.dart';
import 'package:eventpass/features/auth/domain/repositories/auth_repository.dart';
import 'package:eventpass/features/auth/domain/usecases/auth_usecases.dart';
import 'package:eventpass/features/auth/presentation/bloc/auth_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

// Lab §3.12 tests + EventPass cases (F11: success AND failure paths).
void main() {
  late MockAuthRepository repository;
  const ada = User(id: 'u1', name: 'Ada', email: 'ada@example.com');

  AuthBloc buildBloc() => AuthBloc(
    loginUser: LoginUser(repository),
    registerUser: RegisterUser(repository),
    getCurrentUser: GetCurrentUser(repository),
    logoutUser: LogoutUser(repository),
  );

  setUp(() => repository = MockAuthRepository());

  blocTest<AuthBloc, AuthState>(
    'AuthStarted restores a saved session',
    setUp: () => when(
      () => repository.currentUser(),
    ).thenAnswer((_) async => const Ok(ada)),
    build: buildBloc,
    act: (bloc) => bloc.add(const AuthStarted()),
    expect: () => [const Authenticated(ada)],
  );

  blocTest<AuthBloc, AuthState>(
    'AuthStarted without a session goes to Unauthenticated, silently',
    setUp: () => when(
      () => repository.currentUser(),
    ).thenAnswer((_) async => const Err(UnauthorizedFailure())),
    build: buildBloc,
    act: (bloc) => bloc.add(const AuthStarted()),
    expect: () => [const Unauthenticated()],
  );

  blocTest<AuthBloc, AuthState>(
    'login success: loading then authenticated (email is trimmed)',
    setUp: () => when(
      () => repository.login(email: 'ada@example.com', password: 'secret123'),
    ).thenAnswer((_) async => const Ok(ada)),
    build: buildBloc,
    act: (bloc) => bloc.add(
      const AuthLoginRequested(
        email: ' ada@example.com ',
        password: 'secret123',
      ),
    ),
    expect: () => [const AuthLoading(), const Authenticated(ada)],
  );

  blocTest<AuthBloc, AuthState>(
    'login failure: loading then unauthenticated with the reason',
    setUp: () =>
        when(
          () => repository.login(
            email: any(named: 'email'),
            password: any(named: 'password'),
          ),
        ).thenAnswer(
          (_) async =>
              const Err(UnauthorizedFailure('Invalid email or password')),
        ),
    build: buildBloc,
    act: (bloc) => bloc.add(
      const AuthLoginRequested(email: 'ada@example.com', password: 'nope'),
    ),
    expect: () => [
      const AuthLoading(),
      const Unauthenticated(
        failure: UnauthorizedFailure('Invalid email or password'),
      ),
    ],
  );

  blocTest<AuthBloc, AuthState>(
    'register success: loading then authenticated',
    setUp: () => when(
      () => repository.register(
        name: 'Ada',
        email: 'ada@example.com',
        password: 'correct-horse-9',
      ),
    ).thenAnswer((_) async => const Ok(ada)),
    build: buildBloc,
    act: (bloc) => bloc.add(
      const AuthRegisterRequested(
        name: ' Ada ',
        email: 'ada@example.com',
        password: 'correct-horse-9',
      ),
    ),
    expect: () => [const AuthLoading(), const Authenticated(ada)],
  );

  blocTest<AuthBloc, AuthState>(
    'register 422: the field errors reach the state (shown next to fields)',
    setUp: () =>
        when(
          () => repository.register(
            name: any(named: 'name'),
            email: any(named: 'email'),
            password: any(named: 'password'),
          ),
        ).thenAnswer(
          (_) async => const Err(
            ValidationFailure(
              'The request contains invalid data',
              fieldErrors: {'password': 'Too small'},
            ),
          ),
        ),
    build: buildBloc,
    act: (bloc) => bloc.add(
      const AuthRegisterRequested(name: 'Ada', email: 'a@b.c', password: 'x'),
    ),
    expect: () => [
      const AuthLoading(),
      const Unauthenticated(
        failure: ValidationFailure(
          'The request contains invalid data',
          fieldErrors: {'password': 'Too small'},
        ),
      ),
    ],
  );

  blocTest<AuthBloc, AuthState>(
    'logout clears the session',
    setUp: () => when(() => repository.logout()).thenAnswer((_) async {}),
    build: buildBloc,
    seed: () => const Authenticated(ada),
    act: (bloc) => bloc.add(const AuthLogoutRequested()),
    expect: () => [const Unauthenticated()],
    verify: (_) => verify(() => repository.logout()).called(1),
  );

  blocTest<AuthBloc, AuthState>(
    'session expired (refresh rejected) signs the user out with a reason',
    build: buildBloc,
    seed: () => const Authenticated(ada),
    act: (bloc) => bloc.add(const AuthSessionExpired()),
    expect: () => [
      const Unauthenticated(
        failure: UnauthorizedFailure('Your session expired. Sign in again.'),
      ),
    ],
  );

  final pending = Completer<Result<User>>();
  blocTest<AuthBloc, AuthState>(
    'droppable: a second login while one is running is ignored (one request)',
    setUp: () => when(
      () => repository.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
      ),
    ).thenAnswer((_) => pending.future),
    build: buildBloc,
    act: (bloc) async {
      const event = AuthLoginRequested(email: 'ada@example.com', password: 'p');
      bloc
        ..add(event)
        ..add(event); // double tap
      await Future<void>.delayed(Duration.zero);
      pending.complete(const Ok(ada));
    },
    expect: () => [const AuthLoading(), const Authenticated(ada)],
    verify: (_) => verify(
      () => repository.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
      ),
    ).called(1),
  );
}
