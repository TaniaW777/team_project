import 'package:eventpass/features/check_in/data/datasources/check_in_local_data_source.dart';
import 'package:eventpass/features/check_in/data/models/pending_check_in_model.dart';
import 'package:eventpass/features/check_in/domain/entities/pending_check_in.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'check_in_fixtures.dart';

class MockPrefs extends Mock implements SharedPreferencesAsync {}

void main() {
  late MockPrefs prefs;
  late CheckInLocalDataSource source;
  late Map<String, String> storage;

  setUpAll(() {
    registerFallbackValue(<PendingCheckInModel>[]);
    registerFallbackValue(pendingScan());
  });

  setUp(() {
    prefs = MockPrefs();
    storage = {};
    when(() => prefs.getString(any())).thenAnswer(
      (call) async => storage[call.positionalArguments[0] as String],
    );
    when(() => prefs.setString(any(), any())).thenAnswer((call) async {
      storage[call.positionalArguments[0] as String] =
          call.positionalArguments[1] as String;
    });
    source = CheckInLocalDataSource(prefs);
  });

  test('enqueue is idempotent by idempotencyKey', () async {
    final item = pendingScan();

    await source.enqueue(item);
    await source.enqueue(item);

    final items = await source.readAll();
    expect(items, [item]);
    expect(storage.keys, [CheckInLocalDataSource.key]);
  });

  test(
    'reads are sorted by scannedAt (audit time, not server order)',
    () async {
      final later = pendingScan(
        key: 'later',
        at: scannedAt.add(const Duration(minutes: 1)),
      );
      final earlier = pendingScan(
        key: 'earlier',
        at: scannedAt.subtract(const Duration(minutes: 1)),
      );

      await source.enqueue(later);
      await source.enqueue(earlier);
      await source.enqueue(pendingScan(key: 'middle'));

      expect((await source.readAll()).map((e) => e.idempotencyKey), [
        'earlier',
        'middle',
        'later',
      ]);
    },
  );

  test('updateAll resolves known keys and never adds unknown ones', () async {
    final item = pendingScan();
    await source.enqueue(item);

    await source.updateAll([
      item.copyWith(status: CheckInSyncStatus.synced),
      pendingScan(key: 'never-enqueued'),
    ]);

    final items = await source.readAll();
    expect(items, hasLength(1));
    expect(items.single.status, CheckInSyncStatus.synced);
  });

  test('clearSynced drops only synced entries', () async {
    await source.enqueue(pendingScan(key: 'done'));
    await source.enqueue(
      pendingScan(
        key: 'conflict',
        status: CheckInSyncStatus.conflict,
        reason: 'ALREADY_CHECKED_IN',
      ),
    );
    await source.updateAll([
      pendingScan(key: 'done').copyWith(status: CheckInSyncStatus.synced),
    ]);

    await source.clearSynced();

    expect((await source.readAll()).map((e) => e.idempotencyKey), ['conflict']);
  });

  test('watch emits the current outbox, then every local change', () async {
    final emissions = <List<PendingCheckInModel>>[];
    final subscription = source.watch().listen(emissions.add);
    await Future<void>.delayed(const Duration(milliseconds: 10));

    await source.enqueue(pendingScan());
    await Future<void>.delayed(const Duration(milliseconds: 10));

    expect(emissions, isNotEmpty);
    expect(emissions.last, hasLength(1));
    expect(emissions.last.single.idempotencyKey, 'key-1');
    await subscription.cancel();
    await source.dispose();
  });

  test('a corrupt outbox is ignored instead of crashing', () async {
    storage[CheckInLocalDataSource.key] = '{not json';

    expect(await source.readAll(), isEmpty);
  });
}
