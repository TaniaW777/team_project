part of 'auth_bloc.dart';

/// The four situations the app can be in, and nothing else (lab §3.7).
/// Impossible combinations (loading AND authenticated) cannot be built.
sealed class AuthState extends Equatable {
  const AuthState();

  @override
  List<Object?> get props => [];
}

/// We do not know yet (splash screen).
final class AuthInitial extends AuthState {
  const AuthInitial();
}

/// A login or registration request is running.
final class AuthLoading extends AuthState {
  const AuthLoading();
}

final class Authenticated extends AuthState {
  const Authenticated(this.user);

  final User user;

  @override
  List<Object?> get props => [user];
}

final class Unauthenticated extends AuthState {
  const Unauthenticated({this.failure});

  /// Why we are signed out, when there is something to tell the user.
  final Failure? failure;

  @override
  List<Object?> get props => [failure];
}
