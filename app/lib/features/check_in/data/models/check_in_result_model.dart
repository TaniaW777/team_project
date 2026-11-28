import '../../domain/entities/check_in_result.dart';

/// A `[result]` item of `POST /check-ins/sync`. The idempotency key is part
/// of the wire item (§6) and lets the repository match an answer to its
/// outbox entry without relying on arrival order or `scannedAt`.
class CheckInResultModel extends CheckInResult {
  const CheckInResultModel({
    required this.idempotencyKey,
    required super.outcome,
    super.reason,
    super.checkedInAt,
  });

  final String idempotencyKey;

  factory CheckInResultModel.fromJson(Map<String, dynamic> json) {
    final checkedInAt = json['checkedInAt'];
    return CheckInResultModel(
      idempotencyKey: json['idempotencyKey'] as String? ?? '',
      outcome: CheckInOutcome.fromValue(json['result'] as String? ?? 'retry'),
      reason: json['reason'] as String?,
      checkedInAt: checkedInAt is String
          ? DateTime.tryParse(checkedInAt)?.toUtc()
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'idempotencyKey': idempotencyKey,
    'result': outcome.value,
    'reason': reason,
    'checkedInAt': checkedInAt?.toUtc().toIso8601String(),
  };
}
