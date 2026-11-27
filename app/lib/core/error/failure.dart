import 'package:equatable/equatable.dart';

/// Everything that can go wrong, expressed in the language of the app
/// (not in the language of Dio, HTTP or MongoDB). Lab §3.3.
///
/// `sealed` means the compiler knows the full list of subclasses, so a
/// `switch` over a Failure must handle every case.
sealed class Failure extends Equatable {
  const Failure(this.message);

  final String message;

  /// Whether replaying the same request (same idempotency key) can succeed.
  /// The offline outbox uses this to decide between "retry later" and a
  /// terminal state shown to the user. Subclasses that represent a transient
  /// transport/server problem override it.
  bool get isRetryable => false;

  @override
  List<Object?> get props => [message];
}

/// No connection, DNS error, timeout...
final class NetworkFailure extends Failure {
  const NetworkFailure([
    super.message = 'Cannot reach the server. Check your connection.',
  ]);

  @override
  bool get isRetryable => true;
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

  /// A 5xx is a transient failure: the check-in outbox keeps its pending
  /// entry and retries with the same key (docs/tickets-contract.md §7).
  @override
  bool get isRetryable => true;
}

/// Stable API codes the app handles explicitly (check-in / outbox,
/// docs/tickets-contract.md §6-§7). Kept in core so the mapper can classify
/// an error without importing a feature.
abstract final class ApiErrorCodes {
  static const invalidQr = 'INVALID_QR';
  static const wrongEvent = 'WRONG_EVENT';
  static const alreadyCheckedIn = 'ALREADY_CHECKED_IN';
  static const ticketNotConfirmed = 'TICKET_NOT_CONFIRMED';
  static const idempotencyKeyReused = 'IDEMPOTENCY_KEY_REUSED';
  static const forbidden = 'FORBIDDEN';
  static const concurrentUpdate = 'CONCURRENT_UPDATE';
  static const transactionOutcomeUnknown = 'TRANSACTION_OUTCOME_UNKNOWN';

  /// Terminal: retrying the identical scan can never become a success.
  static const terminal = {
    invalidQr,
    wrongEvent,
    alreadyCheckedIn,
    ticketNotConfirmed,
    idempotencyKeyReused,
    forbidden,
  };

  /// Retryable: the server guarantees that replaying the same idempotency
  /// key is safe (409 CONCURRENT_UPDATE / 503 TRANSACTION_OUTCOME_UNKNOWN).
  static const retryable = {concurrentUpdate, transactionOutcomeUnknown};

  static const all = {...terminal, ...retryable};
}

/// An API error with its machine-readable [code] and the original [details]
/// (e.g. `{ 'checkedInAt': '...' }` on 409 ALREADY_CHECKED_IN).
///
/// Unlike a generic [ServerFailure], this failure keeps the code and details
/// all the way to the check-in repository, which turns them into a device
/// state (`conflict` / `rejected` / still `pendingSync`).
final class ApiFailure extends Failure {
  const ApiFailure(
    super.message, {
    required this.code,
    this.details = const {},
  });

  final String code;
  final Map<String, dynamic> details;

  /// Server time of an existing check-in, when the API supplied it.
  DateTime? get checkedInAt {
    final value = details['checkedInAt'];
    if (value is String) return DateTime.tryParse(value)?.toUtc();
    return null;
  }

  bool get isTerminal => ApiErrorCodes.terminal.contains(code);

  @override
  bool get isRetryable => ApiErrorCodes.retryable.contains(code);

  @override
  List<Object?> get props => [message, code, details];
}
