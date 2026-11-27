import 'package:equatable/equatable.dart';

/// The seven server results of §7, as a sealed-by-enum value.
enum CheckInOutcome {
  accepted,
  duplicate,
  alreadyCheckedIn,
  rejected,
  retry;

  /// Wire value from the API (`result` field).
  String get value => switch (this) {
    CheckInOutcome.accepted => 'accepted',
    CheckInOutcome.duplicate => 'duplicate',
    CheckInOutcome.alreadyCheckedIn => 'already_checked_in',
    CheckInOutcome.rejected => 'rejected',
    CheckInOutcome.retry => 'retry',
  };

  static CheckInOutcome fromValue(String value) => switch (value) {
    'accepted' => CheckInOutcome.accepted,
    'duplicate' => CheckInOutcome.duplicate,
    'already_checked_in' => CheckInOutcome.alreadyCheckedIn,
    'rejected' => CheckInOutcome.rejected,
    _ => CheckInOutcome.retry,
  };
}

/// A check-in answer, either from the immediate online endpoint or from one
/// item of a sync batch. Pure Dart (the data layer adds the idempotency key
/// needed to correlate batch items).
class CheckInResult extends Equatable {
  const CheckInResult({required this.outcome, this.reason, this.checkedInAt});

  final CheckInOutcome outcome;
  final String? reason;
  final DateTime? checkedInAt;

  bool get isSuccess =>
      outcome == CheckInOutcome.accepted || outcome == CheckInOutcome.duplicate;

  bool get isRetry => outcome == CheckInOutcome.retry;

  @override
  List<Object?> get props => [outcome, reason, checkedInAt];
}
