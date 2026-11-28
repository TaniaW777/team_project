import '../../domain/entities/pending_check_in.dart';

/// Data-layer version of [PendingCheckIn]: it knows the JSON saved on the
/// device (key `checkin.outbox.v1`). Dates are stored in UTC ISO-8601.
class PendingCheckInModel extends PendingCheckIn {
  const PendingCheckInModel({
    required super.idempotencyKey,
    required super.eventId,
    required super.qrToken,
    required super.scannedAt,
    super.status,
    super.reason,
    super.checkedInAt,
  });

  /// Bump together with the SharedPreferences key when the shape changes.
  static const formatVersion = 1;

  factory PendingCheckInModel.fromEntity(PendingCheckIn entity) {
    return PendingCheckInModel(
      idempotencyKey: entity.idempotencyKey,
      eventId: entity.eventId,
      qrToken: entity.qrToken,
      scannedAt: entity.scannedAt,
      status: entity.status,
      reason: entity.reason,
      checkedInAt: entity.checkedInAt,
    );
  }

  factory PendingCheckInModel.fromJson(Map<String, dynamic> json) {
    return PendingCheckInModel(
      idempotencyKey: json['idempotencyKey'] as String,
      eventId: json['eventId'] as String,
      qrToken: json['qrToken'] as String,
      scannedAt: DateTime.parse(json['scannedAt'] as String).toUtc(),
      status: CheckInSyncStatus.fromValue(
        (json['status'] as String?) ?? CheckInSyncStatus.pendingSync.value,
      ),
      reason: json['reason'] as String?,
      checkedInAt: json['checkedInAt'] == null
          ? null
          : DateTime.parse(json['checkedInAt'] as String).toUtc(),
    );
  }

  Map<String, dynamic> toJson() => {
    'version': formatVersion,
    'idempotencyKey': idempotencyKey,
    'eventId': eventId,
    'qrToken': qrToken,
    'scannedAt': scannedAt.toUtc().toIso8601String(),
    'status': status.value,
    'reason': reason,
    'checkedInAt': checkedInAt?.toUtc().toIso8601String(),
  };

  /// Only the mutable fields; the idempotency key never changes, even when
  /// the outbox entry is retried or resolved.
  PendingCheckInModel copyWith({
    CheckInSyncStatus? status,
    String? reason,
    DateTime? checkedInAt,
    bool clearReason = false,
    bool clearCheckedInAt = false,
  }) {
    return PendingCheckInModel(
      idempotencyKey: idempotencyKey,
      eventId: eventId,
      qrToken: qrToken,
      scannedAt: scannedAt,
      status: status ?? this.status,
      reason: clearReason ? null : (reason ?? this.reason),
      checkedInAt: clearCheckedInAt ? null : (checkedInAt ?? this.checkedInAt),
    );
  }
}
