import 'dart:async';

import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/core/result/result.dart';
import 'package:eventpass/features/check_in/domain/entities/pending_check_in.dart';
import 'package:eventpass/features/check_in/domain/usecases/check_in_usecases.dart';
import 'package:eventpass/features/check_in/presentation/bloc/check_in_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'check_in_fixtures.dart';

class MockEnqueue extends Mock implements EnqueueCheckIn {}

class MockSync extends Mock implements SyncCheckInOutbox {}

class MockWatch extends Mock implements WatchCheckInOutbox {}

void main() {
  late MockEnqueue enqueue;
  late MockSync sync;
  late MockWatch watch;
  late StreamController<List<PendingCheckIn>> outbox;

  const offline = NetworkFailure();

  setUp(() {
    enqueue = MockEnqueue();
    sync = MockSync();
    watch = MockWatch();
    outbox = StreamController<List<PendingCheckIn>>();
    when(() => watch()).thenAnswer((_) => outbox.stream);
    when(
      () => enqueue(
        qrToken: any(named: 'qrToken'),
        eventId: any(named: 'eventId'),
      ),
    ).thenAnswer((_) async => const Ok<void>(null));
    when(() => sync()).thenAnswer((_) async => const Ok<void>(null));
  });

  /// Runs [act], lets the async event handlers settle, then closes the bloc
  /// and returns every emitted state. A small real delay (not just
  /// `Duration.zero`) is needed on Windows where `bloc.close()` can race an
  /// in-flight mock future.
  Future<List<CheckInState>> statesAfter(
    FutureOr<void> Function(CheckInBloc bloc) act,
  ) async {
    final bloc = CheckInBloc(
      enqueueCheckIn: enqueue,
      syncCheckInOutbox: sync,
      watchCheckInOutbox: watch,
    );
    final states = <CheckInState>[];
    final subscription = bloc.stream.listen(states.add);
    await act(bloc);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await bloc.close();
    await subscription.cancel();
    return states;
  }

  test('CheckInStarted shows the outbox entries', () async {
    final states = await statesAfter((bloc) async {
      bloc.add(const CheckInStarted());
      outbox.add([pendingScan()]);
      await outbox.close();
    });

    expect(states, [
      const CheckInState(status: CheckInStatus.loading),
      CheckInState(status: CheckInStatus.success, items: [pendingScan()]),
    ]);
  });

  test('a QR capture enqueues one scan and shows success', () async {
    final states = await statesAfter(
      (bloc) => bloc.add(
        const CheckInQrCaptured(qrToken: 'qr-token-1', eventId: 'event-1'),
      ),
    );

    expect(states, [
      const CheckInState(status: CheckInStatus.loading),
      const CheckInState(status: CheckInStatus.success),
    ]);
    verify(() => enqueue(qrToken: 'qr-token-1', eventId: 'event-1')).called(1);
  });

  test('a retryable failure is shown so the user can retry', () async {
    when(
      () => enqueue(
        qrToken: any(named: 'qrToken'),
        eventId: any(named: 'eventId'),
      ),
    ).thenAnswer((_) async => const Err<void>(offline));

    final states = await statesAfter(
      (bloc) => bloc.add(
        const CheckInQrCaptured(qrToken: 'qr-token-1', eventId: 'event-1'),
      ),
    );

    expect(states, [
      const CheckInState(status: CheckInStatus.loading),
      const CheckInState(status: CheckInStatus.failure, failure: offline),
    ]);
  });

  test('CheckInSyncRequested shows the sync spinner then success', () async {
    final states = await statesAfter(
      (bloc) => bloc.add(const CheckInSyncRequested()),
    );

    expect(states, [
      const CheckInState(isSyncing: true),
      const CheckInState(status: CheckInStatus.success),
    ]);
    verify(() => sync()).called(1);
  });

  test('retrying routes through the same sync use case', () async {
    final states = await statesAfter(
      (bloc) => bloc.add(const CheckInRetried()),
    );

    expect(states, [
      const CheckInState(isSyncing: true),
      const CheckInState(status: CheckInStatus.success),
    ]);
    verify(() => sync()).called(1);
  });

  test(
    'a late answer from a cancelled sync is ignored (version check)',
    () async {
      final older = Completer<Result<void>>();
      final newer = Completer<Result<void>>();
      var calls = 0;
      when(() => sync()).thenAnswer((_) {
        calls++;
        return calls == 1 ? older.future : newer.future;
      });

      final states = await statesAfter((bloc) async {
        bloc.add(const CheckInSyncRequested());
        await Future<void>.delayed(const Duration(milliseconds: 5));
        bloc.add(const CheckInRetried());
        await Future<void>.delayed(const Duration(milliseconds: 5));
        older.complete(const Err<void>(offline));
        newer.complete(const Ok<void>(null));
      });

      // Only the newest answer may win; the stale Err must not overwrite it.
      expect(states, [
        const CheckInState(isSyncing: true),
        const CheckInState(status: CheckInStatus.success),
      ]);
      expect(calls, 2);
    },
  );
}
