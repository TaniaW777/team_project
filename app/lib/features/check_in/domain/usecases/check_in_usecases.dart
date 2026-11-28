import 'package:uuid/uuid.dart';

import '../../../../core/result/result.dart';
import '../entities/pending_check_in.dart';
import '../repositories/check_in_repository.dart';

// One class = one thing the user can do (lab §3.5).
// `uuid` is pure Dart: domain/ still imports neither Flutter nor Dio (F1).

/// Creates the UUID v4 key ONCE per scan and queues the scan for sync.
class EnqueueCheckIn {
  const EnqueueCheckIn(
    this._repository, {
    String Function()? newId,
    DateTime Function()? now,
  }) : _newId = newId ?? _uuidV4,
       _now = now ?? DateTime.now;

  final CheckInRepository _repository;
  final String Function() _newId;
  final DateTime Function() _now;

  static String _uuidV4() => const Uuid().v4();

  Future<Result<void>> call({
    required String qrToken,
    required String eventId,
  }) {
    return _repository.enqueue(
      PendingCheckIn(
        idempotencyKey: _newId(),
        eventId: eventId.trim(),
        qrToken: qrToken.trim(),
        // Device time is audit-only; the server decides by arrival order.
        scannedAt: _now().toUtc(),
      ),
    );
  }
}

/// Sends the pending scans (same keys on every retry).
class SyncCheckInOutbox {
  const SyncCheckInOutbox(this._repository);

  final CheckInRepository _repository;

  Future<Result<void>> call() => _repository.syncOutbox();
}

/// Streams the outbox so the page always shows the current device states.
class WatchCheckInOutbox {
  const WatchCheckInOutbox(this._repository);

  final CheckInRepository _repository;

  Stream<List<PendingCheckIn>> call() => _repository.watchOutbox();
}

/// Drops successfully synced scans from the device.
class ClearSyncedCheckIns {
  const ClearSyncedCheckIns(this._repository);

  final CheckInRepository _repository;

  Future<Result<void>> call() => _repository.clearSynced();
}
