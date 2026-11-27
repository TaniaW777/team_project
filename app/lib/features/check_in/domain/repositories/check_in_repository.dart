import '../../../../core/result/result.dart';
import '../entities/pending_check_in.dart';

/// What the app needs from check-in, without saying HOW (F3).
///
/// The outbox is durable: every scan is written locally before any request,
/// and replays keep the same idempotency key (tickets-contract.md §7).
abstract interface class CheckInRepository {
  /// The outbox, newest state of every scan. Emits the current list as soon
  /// as it is listened to, then after each local change.
  Stream<List<PendingCheckIn>> watchOutbox();

  /// Writes [checkIn] to the outbox first, then tries the online endpoint.
  /// A terminal answer updates the entry; a retryable failure leaves it
  /// `pendingSync` and is returned as an [Err].
  Future<Result<void>> enqueue(PendingCheckIn checkIn);

  /// Sends all pending scans in batches of at most 100 and applies §7 mapping.
  Future<Result<void>> syncOutbox();

  /// Removes the `synced` entries (the others stay visible for audit).
  Future<Result<void>> clearSynced();
}
