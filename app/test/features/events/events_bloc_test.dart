import 'dart:async';

import 'package:bloc_test/bloc_test.dart';
import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/core/pagination/paginated.dart';
import 'package:eventpass/core/result/result.dart';
import 'package:eventpass/features/events/domain/entities/campus_event.dart';
import 'package:eventpass/features/events/domain/repositories/events_repository.dart';
import 'package:eventpass/features/events/domain/usecases/events_usecases.dart';
import 'package:eventpass/features/events/presentation/bloc/events_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'events_fixtures.dart';

class MockEventsRepository extends Mock implements EventsRepository {}

// F11: success AND failure paths of every handler, plus the transformers.
void main() {
  late MockEventsRepository repository;

  final a = testEvent('a');
  final b = testEvent('b');
  final c = testEvent('c');
  final savedAt = DateTime(2026, 11, 25, 9, 30);
  const offline = NetworkFailure();

  const debounce = Duration(milliseconds: 20);

  EventsBloc buildBloc() => EventsBloc(
    getEvents: GetEvents(repository),
    getCachedEvents: GetCachedEvents(repository),
    searchDebounce: debounce,
  );

  void stubPage(
    Result<Paginated<CampusEvent>> result, {
    int page = 1,
    String query = '',
    bool upcomingOnly = false,
  }) {
    when(
      () => repository.getEvents(
        page: page,
        query: query,
        upcomingOnly: upcomingOnly,
      ),
    ).thenAnswer((_) async => result);
  }

  void stubCache(CachedEvents? cached) {
    when(() => repository.getCachedEvents()).thenAnswer((_) async => cached);
  }

  setUp(() => repository = MockEventsRepository());

  group('EventsStarted (cache then network, F9)', () {
    blocTest<EventsBloc, EventsState>(
      'no cache, network OK: loading then the first page',
      setUp: () {
        stubCache(null);
        stubPage(Ok(pageOf([a, b], totalPages: 2)));
      },
      build: buildBloc,
      act: (bloc) => bloc.add(const EventsStarted()),
      expect: () => [
        const EventsState(status: EventsStatus.loading),
        EventsState(
          status: EventsStatus.success,
          events: [a, b],
          page: 1,
          hasMore: true,
        ),
      ],
    );

    blocTest<EventsBloc, EventsState>(
      'cache, network OK: the cached list first, then the fresh one',
      setUp: () {
        stubCache((events: [a], savedAt: savedAt));
        stubPage(Ok(pageOf([a, b])));
      },
      build: buildBloc,
      act: (bloc) => bloc.add(const EventsStarted()),
      expect: () => [
        const EventsState(status: EventsStatus.loading),
        EventsState(
          status: EventsStatus.loading,
          events: [a],
          cachedAt: savedAt,
        ),
        EventsState(status: EventsStatus.success, events: [a, b], page: 1),
      ],
    );

    blocTest<EventsBloc, EventsState>(
      'cache, offline: the cached list stays visible with the failure',
      setUp: () {
        stubCache((events: [a], savedAt: savedAt));
        stubPage(const Err(offline));
      },
      build: buildBloc,
      act: (bloc) => bloc.add(const EventsStarted()),
      expect: () => [
        const EventsState(status: EventsStatus.loading),
        EventsState(
          status: EventsStatus.loading,
          events: [a],
          cachedAt: savedAt,
        ),
        EventsState(
          status: EventsStatus.success,
          events: [a],
          cachedAt: savedAt,
          failure: offline,
        ),
      ],
    );

    blocTest<EventsBloc, EventsState>(
      'no cache, offline: the error state (the page shows Retry)',
      setUp: () {
        stubCache(null);
        stubPage(const Err(offline));
      },
      build: buildBloc,
      act: (bloc) => bloc.add(const EventsStarted()),
      expect: () => [
        const EventsState(status: EventsStatus.loading),
        const EventsState(status: EventsStatus.failure, failure: offline),
      ],
    );

    blocTest<EventsBloc, EventsState>(
      'no event at all: success with an empty list (the empty view)',
      setUp: () {
        stubCache(null);
        stubPage(Ok(pageOf([], totalPages: 0)));
      },
      build: buildBloc,
      act: (bloc) => bloc.add(const EventsStarted()),
      expect: () => [
        const EventsState(status: EventsStatus.loading),
        const EventsState(status: EventsStatus.success, page: 1),
      ],
    );
  });

  group('EventsRefreshed', () {
    blocTest<EventsBloc, EventsState>(
      'retry after an error loads the first page',
      setUp: () => stubPage(Ok(pageOf([a]))),
      build: buildBloc,
      seed: () =>
          const EventsState(status: EventsStatus.failure, failure: offline),
      act: (bloc) => bloc.add(const EventsRefreshed()),
      expect: () => [
        const EventsState(status: EventsStatus.loading),
        EventsState(status: EventsStatus.success, events: [a], page: 1),
      ],
    );

    blocTest<EventsBloc, EventsState>(
      'a failed refresh keeps the current list and reports the failure',
      setUp: () => stubPage(const Err(offline)),
      build: buildBloc,
      seed: () =>
          EventsState(status: EventsStatus.success, events: [a], page: 1),
      act: (bloc) => bloc.add(const EventsRefreshed()),
      expect: () => [
        EventsState(status: EventsStatus.loading, events: [a], page: 1),
        EventsState(
          status: EventsStatus.success,
          events: [a],
          page: 1,
          failure: offline,
        ),
      ],
    );
  });

  group('EventsSearchChanged (debounce + restartable, F8)', () {
    blocTest<EventsBloc, EventsState>(
      'typing quickly sends ONE request, for the last text',
      setUp: () => stubPage(Ok(pageOf([b])), query: 'music'),
      build: buildBloc,
      act: (bloc) => bloc
        ..add(const EventsSearchChanged('m'))
        ..add(const EventsSearchChanged('mus'))
        ..add(const EventsSearchChanged(' music ')),
      wait: debounce * 3,
      expect: () => [
        const EventsState(status: EventsStatus.loading, query: 'music'),
        EventsState(
          status: EventsStatus.success,
          query: 'music',
          events: [b],
          page: 1,
        ),
      ],
      verify: (_) {
        verify(
          () => repository.getEvents(
            page: any(named: 'page'),
            query: any(named: 'query'),
            upcomingOnly: any(named: 'upcomingOnly'),
          ),
        ).called(1);
      },
    );

    final slow = Completer<Result<Paginated<CampusEvent>>>();
    blocTest<EventsBloc, EventsState>(
      'a newer search cancels the older one: its late answer is ignored',
      setUp: () {
        when(
          () =>
              repository.getEvents(page: 1, query: 'old', upcomingOnly: false),
        ).thenAnswer((_) => slow.future);
        stubPage(Ok(pageOf([b])), query: 'new');
      },
      build: buildBloc,
      act: (bloc) async {
        bloc.add(const EventsSearchChanged('old'));
        await Future<void>.delayed(debounce * 2); // "old" request running
        bloc.add(const EventsSearchChanged('new'));
        await Future<void>.delayed(debounce * 2);
        slow.complete(Ok(pageOf([a]))); // arrives last, must not win
      },
      wait: debounce,
      expect: () => [
        const EventsState(status: EventsStatus.loading, query: 'old'),
        const EventsState(status: EventsStatus.loading, query: 'new'),
        EventsState(
          status: EventsStatus.success,
          query: 'new',
          events: [b],
          page: 1,
        ),
      ],
    );

    blocTest<EventsBloc, EventsState>(
      'a search with no result: success with an empty list',
      setUp: () => stubPage(Ok(pageOf([], totalPages: 0)), query: 'zzz'),
      build: buildBloc,
      seed: () => EventsState(status: EventsStatus.success, events: [a]),
      act: (bloc) => bloc.add(const EventsSearchChanged('zzz')),
      wait: debounce * 2,
      expect: () => [
        const EventsState(status: EventsStatus.loading, query: 'zzz'),
        const EventsState(status: EventsStatus.success, query: 'zzz', page: 1),
      ],
    );

    blocTest<EventsBloc, EventsState>(
      'a failed search with nothing to show: the error state',
      setUp: () => stubPage(const Err(offline), query: 'jazz'),
      build: buildBloc,
      act: (bloc) => bloc.add(const EventsSearchChanged('jazz')),
      wait: debounce * 2,
      expect: () => [
        const EventsState(status: EventsStatus.loading, query: 'jazz'),
        const EventsState(
          status: EventsStatus.failure,
          query: 'jazz',
          failure: offline,
        ),
      ],
    );
  });

  blocTest<EventsBloc, EventsState>(
    'EventsUpcomingToggled reloads the list with the filter',
    setUp: () => stubPage(Ok(pageOf([c])), upcomingOnly: true),
    build: buildBloc,
    seed: () => EventsState(status: EventsStatus.success, events: [a, b]),
    act: (bloc) => bloc.add(const EventsUpcomingToggled(true)),
    expect: () => [
      const EventsState(status: EventsStatus.loading, upcomingOnly: true),
      EventsState(
        status: EventsStatus.success,
        upcomingOnly: true,
        events: [c],
        page: 1,
      ),
    ],
  );

  group('club page (EventsBloc with a clubId)', () {
    blocTest<EventsBloc, EventsState>(
      'only the club events are requested, and the device cache is not used',
      setUp: () => when(
        () => repository.getEvents(
          page: 1,
          query: '',
          upcomingOnly: false,
          clubId: 'club-1',
        ),
      ).thenAnswer((_) async => Ok(pageOf([a]))),
      build: () => EventsBloc(
        getEvents: GetEvents(repository),
        getCachedEvents: GetCachedEvents(repository),
        clubId: 'club-1',
      ),
      act: (bloc) => bloc.add(const EventsStarted()),
      expect: () => [
        const EventsState(status: EventsStatus.loading),
        EventsState(status: EventsStatus.success, events: [a], page: 1),
      ],
      verify: (_) => verifyNever(() => repository.getCachedEvents()),
    );
  });

  group('EventsNextPageRequested (droppable, F8)', () {
    final firstPage = EventsState(
      status: EventsStatus.success,
      events: [a, b],
      page: 1,
      hasMore: true,
    );

    blocTest<EventsBloc, EventsState>(
      'appends the next page (an item already shown is not repeated)',
      setUp: () =>
          stubPage(Ok(pageOf([b, c], page: 2, totalPages: 2)), page: 2),
      build: buildBloc,
      seed: () => firstPage,
      act: (bloc) => bloc.add(const EventsNextPageRequested()),
      expect: () => [
        firstPage.copyWith(isLoadingMore: true),
        firstPage.copyWith(events: [a, b, c], page: 2, hasMore: false),
      ],
    );

    final pending = Completer<Result<Paginated<CampusEvent>>>();
    blocTest<EventsBloc, EventsState>(
      'many scroll notifications while loading: only ONE request',
      setUp: () => when(
        () => repository.getEvents(page: 2, query: '', upcomingOnly: false),
      ).thenAnswer((_) => pending.future),
      build: buildBloc,
      seed: () => firstPage,
      act: (bloc) async {
        bloc
          ..add(const EventsNextPageRequested())
          ..add(const EventsNextPageRequested())
          ..add(const EventsNextPageRequested());
        await Future<void>.delayed(Duration.zero);
        pending.complete(Ok(pageOf([c], page: 2, totalPages: 2)));
      },
      expect: () => [
        firstPage.copyWith(isLoadingMore: true),
        firstPage.copyWith(events: [a, b, c], page: 2, hasMore: false),
      ],
      verify: (_) => verify(
        () => repository.getEvents(page: 2, query: '', upcomingOnly: false),
      ).called(1),
    );

    blocTest<EventsBloc, EventsState>(
      'a failed next page keeps the items and reports the failure',
      setUp: () => stubPage(const Err(offline), page: 2),
      build: buildBloc,
      seed: () => firstPage,
      act: (bloc) => bloc.add(const EventsNextPageRequested()),
      expect: () => [
        firstPage.copyWith(isLoadingMore: true),
        firstPage.copyWith(failure: offline),
      ],
    );

    blocTest<EventsBloc, EventsState>(
      'nothing happens on the last page',
      build: buildBloc,
      seed: () => firstPage.copyWith(hasMore: false),
      act: (bloc) => bloc.add(const EventsNextPageRequested()),
      expect: () => <EventsState>[],
      verify: (_) => verifyNever(
        () => repository.getEvents(
          page: any(named: 'page'),
          query: any(named: 'query'),
          upcomingOnly: any(named: 'upcomingOnly'),
        ),
      ),
    );

    blocTest<EventsBloc, EventsState>(
      'nothing happens while the list comes from the offline cache',
      build: buildBloc,
      seed: () => firstPage.copyWith(cachedAt: savedAt),
      act: (bloc) => bloc.add(const EventsNextPageRequested()),
      expect: () => <EventsState>[],
    );
  });
}
