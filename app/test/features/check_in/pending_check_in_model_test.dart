import 'package:eventpass/features/check_in/data/models/pending_check_in_model.dart';
import 'package:eventpass/features/check_in/domain/entities/pending_check_in.dart';
import 'package:flutter_test/flutter_test.dart';

import 'check_in_fixtures.dart';

void main() {
  test('toJson / fromJson round-trip keeps the status, reason and dates', () {
    final model = pendingScan(
      status: CheckInSyncStatus.conflict,
      reason: 'ALREADY_CHECKED_IN',
      checkedIn: checkedInAt,
    );

    final json = model.toJson();
    expect(json['version'], PendingCheckInModel.formatVersion);
    expect(json['status'], 'conflict');
    expect(PendingCheckInModel.fromJson(json), model);
  });

  test('dates are saved in UTC ISO-8601, even from a local DateTime', () {
    final local = DateTime(2026, 11, 27, 12, 30);
    final model = pendingScan(at: local);

    final json = model.toJson();
    expect(json['scannedAt'], local.toUtc().toIso8601String());

    final restored = PendingCheckInModel.fromJson(json);
    expect(restored.scannedAt.isUtc, isTrue);
    expect(restored.scannedAt, local.toUtc());
  });

  test('an absent optional reason / checkedInAt stays null', () {
    final restored = PendingCheckInModel.fromJson(pendingScan().toJson());

    expect(restored.reason, isNull);
    expect(restored.checkedInAt, isNull);
    expect(restored.isPending, isTrue);
  });
}
