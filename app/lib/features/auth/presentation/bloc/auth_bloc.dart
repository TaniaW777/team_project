import 'package:bloc_concurrency/bloc_concurrency.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/user.dart';
import '../../domain/usecases/auth_usecases.dart';

part 'auth_event.dart';
part 'auth_state.dart';

/// Global authentication state: one instance for the whole app (lab §3.7).
class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc({
    required this._loginUser,
    required this._registerUser,
    required this._getCurrentUser,
    required this._logoutUser,
  }) : super(const AuthInitial()) {
    on<AuthStarted>(_onStarted);
    // EventPass (F8, deliberate transformer): droppable() ignores a second
    // login/registration while one is running, so a double tap never sends
    // two requests (two sessions, or a 409 on the second registration).
    on<AuthLoginRequested>(_onLoginRequested, transformer: droppable());
    on<AuthRegisterRequested>(_onRegisterRequested, transformer: droppable());
    on<AuthLogoutRequested>(_onLogoutRequested);
    on<AuthSessionExpired>(_onSessionExpired);
  }

  final LoginUser _loginUser;
  final RegisterUser _registerUser;
  final GetCurrentUser _getCurrentUser;
  final LogoutUser _logoutUser;

  Future<void> _onStarted(AuthStarted event, Emitter<AuthState> emit) async {
    final result = await _getCurrentUser();
    emit(switch (result) {
      Ok(:final value) => Authenticated(value),
      Err() => const Unauthenticated(),
    });
  }

  Future<void> _onLoginRequested(
    AuthLoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());
    final result = await _loginUser(
      email: event.email,
      password: event.password,
    );
    emit(_toState(result));
  }

  Future<void> _onRegisterRequested(
    AuthRegisterRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());
    final result = await _registerUser(
      name: event.name,
      email: event.email,
      password: event.password,
    );
    emit(_toState(result));
  }

  Future<void> _onLogoutRequested(
    AuthLogoutRequested event,
    Emitter<AuthState> emit,
  ) async {
    await _logoutUser();
    emit(const Unauthenticated());
  }

  void _onSessionExpired(AuthSessionExpired event, Emitter<AuthState> emit) {
    emit(
      const Unauthenticated(
        failure: UnauthorizedFailure('Your session expired. Sign in again.'),
      ),
    );
  }

  // Pattern matching on a sealed class: the compiler checks that
  // both Ok and Err are handled.
  AuthState _toState(Result<User> result) => switch (result) {
    Ok(:final value) => Authenticated(value),
    Err(:final failure) => Unauthenticated(failure: failure),
  };
}
