import 'package:dio/dio.dart';
import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/core/pagination/paginated.dart';
import 'package:eventpass/core/result/result.dart';
import 'package:eventpass/features/events/data/datasources/events_local_data_source.dart';
import 'package:eventpass/features/events/data/datasources/events_remote_data_source.dart';
import 'package:eventpass/features/events/data/models/campus_event_model.dart';
import 'package:eventpass/features/events/data/repositories/events_repository_impl.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'events_fixtures.dart';

class MockRemote extends Mock implements EventsRemoteDataSource {}

class MockLocal extends Mock implements EventsLocalDataSource {}

void main() {
  late MockRemote remote;
  late MockLocal local;
  late EventsRepositoryImpl repository;
  final now = DateTime(2026, 11, 26, 10);
  final event = CampusEventModel.fromJson(eventJson('a'));
  final page1 = Paginated(items: [event], page: 1, totalPages: 1, total: 1);

  setUpAll(() {
    // Values mocktail can use for `any()` on these parameter types.
    registerFallbackValue(<CampusEventModel>[]);
    registerFallbackValue(DateTime(2000));
  });

  setUp(() {
    remote = MockRemote();
    local = MockLocal();
    repository = EventsRepositoryImpl(
      remote: remote,
      local: local,
      now: () => now,
    );
    when(() => local.save(any(), any())).thenAnswer((_) async {});
  });

  void stubRemote(Paginated<CampusEventModel> page) {
    when(
      () => remote.fetchEvents(
        page: any(named: 'page'),
        query: any(named: 'query'),
        upcomingOnly: any(named: 'upcomingOnly'),
      ),
    ).thenAnswer((_) async => page);
  }

  test(
    'first page of the default list: returned AND saved on the device',
    () async {
      stubRemote(page1);

      final result = await repository.getEvents(page: 1);

      expect((result as Ok).value, page1);
      verify(() => local.save([event], now)).called(1);
    },
  );

  test('a search, a filter or a later page is NOT cached', () async {
    stubRemote(page1);

    await repository.getEvents(page: 1, query: 'music');
    await repository.getEvents(page: 1, upcomingOnly: true);
    await repository.getEvents(page: 2);

    verifyNever(() => local.save(any(), any()));
  });

  test(
    'a cache write error does not turn a good answer into a failure',
    () async {
      stubRemote(page1);
      when(() => local.save(any(), any())).thenThrow(Exception('disk full'));

      final result = await repository.getEvents(page: 1);

      expect(result, isA<Ok<Paginated<dynamic>>>());
    },
  );

  test('network error: mapped once to a Failure, nothing cached', () async {
    when(
      () => remote.fetchEvents(
        page: any(named: 'page'),
        query: any(named: 'query'),
        upcomingOnly: any(named: 'upcomingOnly'),
      ),
    ).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/events'),
        type: DioExceptionType.connectionError,
      ),
    );

    final result = await repository.getEvents(page: 1);

    expect((result as Err).failure, isA<NetworkFailure>());
    verifyNever(() => local.save(any(), any()));
  });

  test('getCachedEvents returns the saved list', () async {
    when(
      () => local.read(),
    ).thenAnswer((_) async => (events: [event], savedAt: now));

    final cached = await repository.getCachedEvents();

    expect(cached?.events, [event]);
    expect(cached?.savedAt, now);
  });

  test('a corrupt cache is treated as no cache (never an error)', () async {
    when(() => local.read()).thenThrow(const FormatException('bad json'));

    expect(await repository.getCachedEvents(), isNull);
  });
}
