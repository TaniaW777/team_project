import 'dart:math';

import '../../../../core/error/failure.dart';
import '../../../../core/network/error_mapper.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/check_in_result.dart';
import '../../domain/entities/pending_check_in.dart';
import '../../domain/repositories/check_in_repository.dart';
import '../datasources/check_in_local_data_source.dart';
import '../datasources/check_in_remote_data_source.dart';
import '../models/check_in_result_model.dart';
import '../models/pending_check_in_model.dart';

/// Coordinates the durable outbox and the API. Every network call goes
/// through [guard], so a DioException becomes a Failure once, at the data
/// border (F3). The server decides by arrival order, never by `scannedAt`.
class CheckInRepositoryImpl implements CheckInRepository {
  const CheckInRepositoryImpl({required this.remote, required this.local});

  final CheckInRemoteDataSource remote;
  final CheckInLocalDataSource local;

  @override
  Stream<List<PendingCheckIn>> watchOutbox() =>
      local.watch().map((items) => List<PendingCheckIn>.unmodifiable(items));

  @override
  Future<Result<void>> enqueue(PendingCheckIn checkIn) async {
    final model = PendingCheckInModel.fromEntity(checkIn);

    // 1. Always write first: even if the app dies before the request, the
    //    scan is retried later with the SAME idempotency key.
    final queued = await guard(() => local.enqueue(model));
    if (queued is Err) return Err<void>(queued.failure);

    // 2. Best effort immediate check-in while online.
    final answered = await guard<CheckInResultModel>(
      () => remote.checkInOnline(
        eventId: model.eventId,
        qrToken: model.qrToken,
        idempotencyKey: model.idempotencyKey,
      ),
    );
    return switch (answered) {
      Ok(:final value) => await _applyResult(model, value),
      Err(:final failure) => await _onNetworkFailure(model, failure),
    };
  }

  @override
  Future<Result<void>> syncOutbox() async {
    final read = await guard(() => local.readAll());
    if (read case Err(:final failure)) return Err<void>(failure);
    final items = (read as Ok<List<PendingCheckInModel>>).value;
    final pending = items.where((item) => item.isPending).toList();
    if (pending.isEmpty) return const Ok(null);

    for (
      var start = 0;
      start < pending.length;
      start += CheckInRemoteDataSource.batchSize
    ) {
      final chunk = pending.sublist(
        start,
        min(start + CheckInRemoteDataSource.batchSize, pending.length),
      );
      final answered = await guard(() => remote.syncBatch(chunk));

      if (answered case Err(:final failure)) {
        if (failure.isRetryable) {
          // 409 CONCURRENT_UPDATE / 503 TRANSACTION_OUTCOME_UNKNOWN / 5xx /
          // network: the entries stay pendingSync for the next retry.
          return Err<void>(failure);
        }
        // A batch-level terminal rejection is resolved for every item.
        final saved = await guard(
          () => local.updateAll([
            for (final item in chunk) _terminalUpdate(item, failure),
          ]),
        );
        if (saved is Err) return Err<void>(saved.failure);
        continue;
      }

      final results = (answered as Ok<List<CheckInResultModel>>).value;
      final byKey = {
        for (final result in results) result.idempotencyKey: result,
      };
      final updates = <PendingCheckInModel>[];
      for (final item in chunk) {
        final result = byKey[item.idempotencyKey];
        if (result == null) continue; // not answered: still pending
        updates.add(_resolved(item, result));
      }
      if (updates.isEmpty) continue;
      final saved = await guard(() => local.updateAll(updates));
      if (saved is Err) return Err<void>(saved.failure);
    }
    return const Ok(null);
  }

  @override
  Future<Result<void>> clearSynced() => guard(() => local.clearSynced());

  /// §7 mapping of one server result. Each entry is matched by its own
  /// idempotency key, so batch ordering never decides the device state.
  PendingCheckInModel _resolved(
    PendingCheckInModel item,
    CheckInResultModel result,
  ) {
    final status = switch (result.outcome) {
      CheckInOutcome.accepted ||
      CheckInOutcome.duplicate => CheckInSyncStatus.synced,
      CheckInOutcome.alreadyCheckedIn => CheckInSyncStatus.conflict,
      CheckInOutcome.rejected => CheckInSyncStatus.rejected,
      CheckInOutcome.retry => CheckInSyncStatus.pendingSync,
    };
    if (status == CheckInSyncStatus.pendingSync) return item;
    return item.copyWith(
      status: status,
      reason:
          result.reason ??
          (status == CheckInSyncStatus.conflict ? 'ALREADY_CHECKED_IN' : null),
      checkedInAt: result.checkedInAt,
    );
  }

  Future<Result<void>> _applyResult(
    PendingCheckInModel item,
    CheckInResultModel result,
  ) {
    final resolved = _resolved(item, result);
    if (resolved.status == CheckInSyncStatus.pendingSync) {
      return Future.value(const Ok(null));
    }
    return guard(() => local.updateAll([resolved]));
  }

  /// A terminal API error becomes a device state; a retryable one leaves the
  /// entry untouched (still pending, same key) and is returned to the bloc.
  Future<Result<void>> _onNetworkFailure(
    PendingCheckInModel item,
    Failure failure,
  ) {
    if (failure.isRetryable) return Future.value(Err<void>(failure));
    return guard(() => local.updateAll([_terminalUpdate(item, failure)]));
  }

  PendingCheckInModel _terminalUpdate(
    PendingCheckInModel item,
    Failure failure,
  ) {
    final status = switch (failure) {
      ApiFailure(code: ApiErrorCodes.alreadyCheckedIn) =>
        CheckInSyncStatus.conflict,
      _ => CheckInSyncStatus.rejected,
    };
    final code = failure is ApiFailure ? failure.code : 'REJECTED';
    final checkedInAt = failure is ApiFailure ? failure.checkedInAt : null;
    return item.copyWith(
      status: status,
      reason: code,
      checkedInAt: checkedInAt,
    );
  }
}
