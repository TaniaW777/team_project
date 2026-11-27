import 'package:dio/dio.dart';
import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/core/result/result.dart';
import 'package:eventpass/features/check_in/data/datasources/check_in_local_data_source.dart';
import 'package:eventpass/features/check_in/data/datasources/check_in_remote_data_source.dart';
import 'package:eventpass/features/check_in/data/models/pending_check_in_model.dart';
import 'package:eventpass/features/check_in/data/repositories/check_in_repository_impl.dart';
import 'package:eventpass/features/check_in/domain/entities/check_in_result.dart';
import 'package:eventpass/features/check_in/domain/entities/pending_check_in.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'check_in_fixtures.dart';

class MockRemote extends Mock implements CheckInRemoteDataSource {}

class MockLocal extends Mock implements CheckInLocalDataSource {}

DioException apiError(
  int status,
  String code, {
  Map<String, dynamic>? details,
}) {
  final options = RequestOptions(path: '/check-ins');
  return DioException(
    requestOptions: options,
    response: Response(
      requestOptions: options,
      statusCode: status,
      data: {
        'error': {
          'code': code,
          'message': 'Rejected',
          'details': details ?? const <String, dynamic>{},
        },
      },
    ),
  );
}

void main() {
  late MockRemote remote;
  late MockLocal local;
  late CheckInRepositoryImpl repository;
  late Map<String, PendingCheckInModel> outbox;

  setUpAll(() {
    registerFallbackValue(<PendingCheckInModel>[]);
    registerFallbackValue(pendingScan());
  });

  setUp(() {
    remote = MockRemote();
    local = MockLocal();
    outbox = <String, PendingCheckInModel>{};
    when(() => local.enqueue(any())).thenAnswer((call) async {
      final item = call.positionalArguments[0] as PendingCheckInModel;
      outbox[item.idempotencyKey] = item;
    });
    when(() => local.readAll()).thenAnswer((_) async => outbox.values.toList());
    when(() => local.updateAll(any())).thenAnswer((call) async {
      final updates =
          call.positionalArguments[0] as Iterable<PendingCheckInModel>;
      for (final item in updates) {
        outbox[item.idempotencyKey] = item;
      }
    });
    when(() => local.clearSynced()).thenAnswer((_) async {
      outbox.removeWhere((_, item) => item.status == CheckInSyncStatus.synced);
    });
    repository = CheckInRepositoryImpl(remote: remote, local: local);
  });

  test('enqueue writes locally first, then maps accepted to synced', () async {
    when(
      () => remote.checkInOnline(
        eventId: any(named: 'eventId'),
        qrToken: any(named: 'qrToken'),
        idempotencyKey: any(named: 'idempotencyKey'),
      ),
    ).thenAnswer(
      (_) async =>
          apiResult('key-1', CheckInOutcome.accepted, checkedIn: checkedInAt),
    );

    final result = await repository.enqueue(pendingScan());

    expect(result, isA<Ok<void>>());
    expect(outbox['key-1']!.status, CheckInSyncStatus.synced);
    expect(outbox['key-1']!.checkedInAt, checkedInAt);
    verify(
      () => remote.checkInOnline(
        eventId: 'event-1',
        qrToken: 'qr-token-1',
        idempotencyKey: 'key-1',
      ),
    ).called(1);
  });

  test(
    'sync maps accepted, duplicate, conflict and rejected per key',
    () async {
      outbox.addAll({
        for (final key in ['k1', 'k2', 'k3', 'k4']) key: pendingScan(key: key),
      });
      when(() => remote.syncBatch(any())).thenAnswer(
        (_) async => [
          apiResult('k1', CheckInOutcome.accepted),
          apiResult('k2', CheckInOutcome.duplicate),
          apiResult(
            'k3',
            CheckInOutcome.alreadyCheckedIn,
            reason: 'ALREADY_CHECKED_IN',
            checkedIn: checkedInAt,
          ),
          apiResult('k4', CheckInOutcome.rejected, reason: 'INVALID_QR'),
        ],
      );

      final result = await repository.syncOutbox();

      expect(result, isA<Ok<void>>());
      expect(outbox['k1']!.status, CheckInSyncStatus.synced);
      expect(outbox['k2']!.status, CheckInSyncStatus.synced);
      expect(outbox['k3']!.status, CheckInSyncStatus.conflict);
      expect(outbox['k3']!.checkedInAt, checkedInAt);
      expect(outbox['k4']!.status, CheckInSyncStatus.rejected);
      expect(outbox['k4']!.reason, 'INVALID_QR');
      final batch =
          verify(() => remote.syncBatch(captureAny())).captured.single
              as List<PendingCheckInModel>;
      expect(batch.length, 4);
    },
  );

  test(
    'a retryable 409 keeps the entry pending and reuses the SAME key',
    () async {
      outbox['key-1'] = pendingScan();
      var attempt = 0;
      when(() => remote.syncBatch(any())).thenAnswer((call) async {
        attempt++;
        if (attempt == 1) {
          throw apiError(409, ApiErrorCodes.concurrentUpdate);
        }
        return [apiResult('key-1', CheckInOutcome.accepted)];
      });

      final first = await repository.syncOutbox();
      expect(first, isA<Err<void>>());
      expect((first as Err).failure.isRetryable, isTrue);
      expect(outbox['key-1']!.status, CheckInSyncStatus.pendingSync);

      final second = await repository.syncOutbox();
      expect(second, isA<Ok<void>>());
      expect(outbox['key-1']!.status, CheckInSyncStatus.synced);

      final batches = verify(() => remote.syncBatch(captureAny())).captured;
      expect(batches, hasLength(2));
      for (final batch in batches) {
        expect(
          (batch as List<PendingCheckInModel>).single.idempotencyKey,
          'key-1',
        );
      }
    },
  );

  test(
    'a terminal check-in error becomes a conflict with server checkedInAt',
    () async {
      when(
        () => remote.checkInOnline(
          eventId: any(named: 'eventId'),
          qrToken: any(named: 'qrToken'),
          idempotencyKey: any(named: 'idempotencyKey'),
        ),
      ).thenThrow(
        apiError(
          409,
          ApiErrorCodes.alreadyCheckedIn,
          details: {'checkedInAt': checkedInAt.toIso8601String()},
        ),
      );

      final result = await repository.enqueue(pendingScan());

      expect(result, isA<Ok<void>>());
      expect(outbox['key-1']!.status, CheckInSyncStatus.conflict);
      expect(outbox['key-1']!.reason, ApiErrorCodes.alreadyCheckedIn);
      expect(outbox['key-1']!.checkedInAt, checkedInAt);
    },
  );

  test('a network failure leaves the scan pending with its key', () async {
    when(
      () => remote.checkInOnline(
        eventId: any(named: 'eventId'),
        qrToken: any(named: 'qrToken'),
        idempotencyKey: any(named: 'idempotencyKey'),
      ),
    ).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/events/event-1/check-ins'),
        type: DioExceptionType.connectionError,
      ),
    );

    final result = await repository.enqueue(pendingScan());

    expect(result, isA<Err<void>>());
    expect((result as Err).failure, isA<NetworkFailure>());
    expect(outbox['key-1']!.status, CheckInSyncStatus.pendingSync);
  });

  test('clearSynced removes only successfully synced scans', () async {
    outbox['done'] = pendingScan(key: 'done', status: CheckInSyncStatus.synced);
    outbox['pending'] = pendingScan(key: 'pending');

    await repository.clearSynced();

    expect(outbox.keys, ['pending']);
  });
}
