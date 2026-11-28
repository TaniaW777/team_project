import 'package:eventpass/features/check_in/data/models/check_in_result_model.dart';
import 'package:eventpass/features/check_in/data/models/pending_check_in_model.dart';
import 'package:eventpass/features/check_in/domain/entities/check_in_result.dart';
import 'package:eventpass/features/check_in/domain/entities/pending_check_in.dart';

final scannedAt = DateTime.utc(2026, 11, 27, 10, 30);
final checkedInAt = DateTime.utc(2026, 11, 27, 10, 31);

PendingCheckInModel pendingScan({
  String key = 'key-1',
  String eventId = 'event-1',
  String qrToken = 'qr-token-1',
  DateTime? at,
  CheckInSyncStatus status = CheckInSyncStatus.pendingSync,
  String? reason,
  DateTime? checkedIn,
}) {
  return PendingCheckInModel(
    idempotencyKey: key,
    eventId: eventId,
    qrToken: qrToken,
    scannedAt: at ?? scannedAt,
    status: status,
    reason: reason,
    checkedInAt: checkedIn,
  );
}

CheckInResultModel apiResult(
  String key,
  CheckInOutcome outcome, {
  String? reason,
  DateTime? checkedIn,
}) {
  return CheckInResultModel(
    idempotencyKey: key,
    outcome: outcome,
    reason: reason,
    checkedInAt: checkedIn,
  );
}
