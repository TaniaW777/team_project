import 'package:equatable/equatable.dart';

/// Everything that can go wrong, expressed in the language of the app
/// (not in the language of Dio, HTTP or MongoDB). Lab §3.3.
///
/// `sealed` means the compiler knows the full list of subclasses, so a
/// `switch` over a Failure must handle every case.
sealed class Failure extends Equatable {
  const Failure(this.message);

  final String message;

  @override
  List<Object?> get props => [message];
}

/// No connection, DNS error, timeout...
final class NetworkFailure extends Failure {
  const NetworkFailure([
    super.message = 'Cannot reach the server. Check your connection.',
  ]);
}

/// 401: missing, invalid or expired credentials.
final class UnauthorizedFailure extends Failure {
  const UnauthorizedFailure([super.message = 'Please sign in again.']);
}

/// 422: the server rejected the data we sent.
final class ValidationFailure extends Failure {
  const ValidationFailure(super.message, {this.fieldErrors = const {}});

  /// Field name -> first error message for that field (shown next to it, F10).
  final Map<String, String> fieldErrors;

  @override
  List<Object?> get props => [message, fieldErrors];
}

/// Any other error returned by the API (403, 404, 409, 500...) or a bug.
final class ServerFailure extends Failure {
  const ServerFailure([super.message = 'Something went wrong. Try again.']);
}
