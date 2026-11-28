import 'package:equatable/equatable.dart';

/// Device state of one QR scan (docs/tickets-contract.md §7).
///
/// `pendingSync` scans live in the durable outbox until the API accepts them;
/// the other states are terminal for that scan. Pure Dart: no Flutter, no Dio.
enum CheckInSyncStatus {
  pendingSync,
  synced,
  conflict,
  rejected;

  /// The exact strings used in the outbox JSON and in documentation.
  String get value => switch (this) {
    CheckInSyncStatus.pendingSync => 'pendingSync',
    CheckInSyncStatus.synced => 'synced',
    CheckInSyncStatus.conflict => 'conflict',
    CheckInSyncStatus.rejected => 'rejected',
  };

  static CheckInSyncStatus fromValue(String value) => switch (value) {
    'pendingSync' => CheckInSyncStatus.pendingSync,
    'synced' => CheckInSyncStatus.synced,
    'conflict' => CheckInSyncStatus.conflict,
    'rejected' => CheckInSyncStatus.rejected,
    _ => CheckInSyncStatus.pendingSync,
  };
}

/// One scan, with its UUID v4 idempotency key. The key is created once and
/// reused on every retry: the server can then deduplicate replays safely.
class PendingCheckIn extends Equatable {
  const PendingCheckIn({
    required this.idempotencyKey,
    required this.eventId,
    required this.qrToken,
    required this.scannedAt,
    this.status = CheckInSyncStatus.pendingSync,
    this.reason,
    this.checkedInAt,
  });

  final String idempotencyKey;
  final String eventId;
  final String qrToken;
  final DateTime scannedAt;

  final CheckInSyncStatus status;

  /// Terminal reason (`INVALID_QR`, `WRONG_EVENT`, `ALREADY_CHECKED_IN`...)
  /// or the reason of a `rejected` sync result.
  final String? reason;

  /// Authoritative server time, when the API supplied one.
  final DateTime? checkedInAt;

  bool get isPending => status == CheckInSyncStatus.pendingSync;

  bool get isTerminal =>
      status == CheckInSyncStatus.synced ||
      status == CheckInSyncStatus.conflict ||
      status == CheckInSyncStatus.rejected;

  @override
  List<Object?> get props => [
    idempotencyKey,
    eventId,
    qrToken,
    scannedAt,
    status,
    reason,
    checkedInAt,
  ];
}
