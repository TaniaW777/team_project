part of 'check_in_bloc.dart';

enum CheckInStatus { initial, loading, success, failure }

/// One state with a [status] (like EventsState): the outbox entries and the
/// sync flag survive a new scan or an error (F7).
final class CheckInState extends Equatable {
  const CheckInState({
    this.status = CheckInStatus.initial,
    this.items = const [],
    this.isSyncing = false,
    this.failure,
  });

  final CheckInStatus status;
  final List<PendingCheckIn> items;

  /// True while a sync batch is in flight (the button shows a spinner).
  final bool isSyncing;

  /// Only retryable failures are shown here; terminal results have a chip.
  final Failure? failure;

  int get pendingCount => items
      .where((item) => item.status == CheckInSyncStatus.pendingSync)
      .length;

  CheckInState copyWith({
    CheckInStatus? status,
    List<PendingCheckIn>? items,
    bool? isSyncing,
    Failure? failure,
    bool clearFailure = false,
  }) {
    return CheckInState(
      status: status ?? this.status,
      items: items ?? this.items,
      isSyncing: isSyncing ?? this.isSyncing,
      failure: clearFailure ? null : (failure ?? this.failure),
    );
  }

  @override
  List<Object?> get props => [status, items, isSyncing, failure];
}
