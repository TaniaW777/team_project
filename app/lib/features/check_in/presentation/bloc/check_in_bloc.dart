import 'package:bloc_concurrency/bloc_concurrency.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/pending_check_in.dart';
import '../../domain/usecases/check_in_usecases.dart';

part 'check_in_event.dart';
part 'check_in_state.dart';

/// The check-in screen: one durable outbox, immediate online scan and manual
/// sync. Page-scoped: one instance per visit (F2/F4).
class CheckInBloc extends Bloc<CheckInEvent, CheckInState> {
  CheckInBloc({
    required this._enqueueCheckIn,
    required this._syncCheckInOutbox,
    required this._watchCheckInOutbox,
  }) : super(const CheckInState()) {
    // Deliberate transformers (F8):
    // - QR capture: droppable, so a camera burst / double tap cannot create
    //   two idempotency keys for the same scan.
    // - sync and retry: restartable, only the last sync answer is applied.
    on<CheckInStarted>(_onStarted, transformer: droppable());
    on<CheckInQrCaptured>(_onQrCaptured, transformer: droppable());
    on<CheckInSyncRequested>(_onSync, transformer: restartable());
    on<CheckInRetried>(_onSync, transformer: restartable());
  }

  final EnqueueCheckIn _enqueueCheckIn;
  final SyncCheckInOutbox _syncCheckInOutbox;
  final WatchCheckInOutbox _watchCheckInOutbox;

  /// Incremented whenever a new operation starts. An async answer carries
  /// its version and is ignored if a newer operation started meanwhile.
  int _version = 0;

  Future<void> _onStarted(
    CheckInStarted event,
    Emitter<CheckInState> emit,
  ) async {
    final version = ++_version;
    emit(state.copyWith(status: CheckInStatus.loading, clearFailure: true));

    // The outbox is a stream: local writes (enqueue, sync, retry) refresh the
    // list without a manual reload. `emit.onEach` keeps this handler alive
    // until the bloc is closed, so the subscription is managed by BLoC.
    await emit.onEach<List<PendingCheckIn>>(
      _watchCheckInOutbox(),
      onData: (items) {
        if (version != _version) return;
        emit(
          state.copyWith(
            items: List<PendingCheckIn>.from(items),
            status: state.status == CheckInStatus.failure
                ? CheckInStatus.failure
                : CheckInStatus.success,
          ),
        );
      },
      onError: (Object error, StackTrace stackTrace) {
        if (version != _version) return;
        emit(
          state.copyWith(
            status: CheckInStatus.failure,
            failure: const ServerFailure('Could not read the check-in outbox.'),
          ),
        );
      },
    );
  }

  Future<void> _onQrCaptured(
    CheckInQrCaptured event,
    Emitter<CheckInState> emit,
  ) async {
    final version = ++_version;
    emit(state.copyWith(status: CheckInStatus.loading, clearFailure: true));

    final result = await _enqueueCheckIn(
      qrToken: event.qrToken,
      eventId: event.eventId,
    );
    if (version != _version) return; // a newer operation already answered

    switch (result) {
      case Ok():
        // A terminal rejection is visible in the outbox chip; only a
        // retryable failure is shown as a screen error.
        emit(state.copyWith(status: CheckInStatus.success));
      case Err(:final failure):
        emit(state.copyWith(status: CheckInStatus.failure, failure: failure));
    }
  }

  Future<void> _onSync(CheckInEvent event, Emitter<CheckInState> emit) async {
    final version = ++_version;
    emit(state.copyWith(isSyncing: true, clearFailure: true));

    final result = await _syncCheckInOutbox();
    if (version != _version) return;

    switch (result) {
      case Ok():
        emit(state.copyWith(status: CheckInStatus.success, isSyncing: false));
      case Err(:final failure):
        emit(
          state.copyWith(
            status: CheckInStatus.failure,
            isSyncing: false,
            failure: failure,
          ),
        );
    }
  }
}
