import 'package:bloc_concurrency/bloc_concurrency.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/bloc/event_transformers.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/pagination/paginated.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/campus_event.dart';
import '../../domain/usecases/events_usecases.dart';

part 'events_event.dart';
part 'events_state.dart';

/// The events list: cache then network (F9), search, filter and infinite
/// scroll. Page-scoped: one instance per visit of the screen.
class EventsBloc extends Bloc<EventsEvent, EventsState> {
  EventsBloc({
    required this._getEvents,
    required this._getCachedEvents,
    Duration searchDebounce = const Duration(milliseconds: 400),
  }) : super(const EventsState()) {
    // Deliberate transformers (F8):
    // - search: debounce + restartable (one request when the user stops
    //   typing; an older search still running is cancelled).
    // - next page: droppable (scrolling fires many notifications; while a
    //   page is loading, the others are ignored, so no page is loaded twice).
    // - start / refresh: droppable (a double tap on Retry sends one request).
    // - filter: restartable (only the last position of the switch matters).
    on<EventsStarted>(_onStarted, transformer: droppable());
    on<EventsRefreshed>(_onRefreshed, transformer: droppable());
    on<EventsSearchChanged>(
      _onSearchChanged,
      transformer: debounceRestartable(searchDebounce),
    );
    on<EventsUpcomingToggled>(_onUpcomingToggled, transformer: restartable());
    on<EventsNextPageRequested>(_onNextPage, transformer: droppable());
  }

  final GetEvents _getEvents;
  final GetCachedEvents _getCachedEvents;

  /// Incremented every time the list is replaced (start, refresh, search,
  /// filter). A request remembers the version it started with; if the version
  /// changed when its answer arrives, the answer belongs to an older list and
  /// is ignored. Each event type has its own transformer, so without this a
  /// late "next page" could be appended to the results of a newer search.
  int _version = 0;

  Future<void> _onStarted(
    EventsStarted event,
    Emitter<EventsState> emit,
  ) async {
    final version = ++_version;
    emit(state.copyWith(status: EventsStatus.loading, clearFailure: true));

    // 1. Cache: the last list saved on the device, shown immediately.
    if (!state.isFiltered) {
      final cached = await _getCachedEvents();
      if (version != _version) return;
      if (cached != null && cached.events.isNotEmpty) {
        emit(state.copyWith(events: cached.events, cachedAt: cached.savedAt));
      }
    }
    // 2. Network: replaces the cached list when it answers.
    await _loadFirstPage(emit, version);
  }

  Future<void> _onRefreshed(
    EventsRefreshed event,
    Emitter<EventsState> emit,
  ) async {
    final version = ++_version;
    // The current items stay visible while the refresh runs.
    emit(
      state.copyWith(
        status: EventsStatus.loading,
        isLoadingMore: false,
        clearFailure: true,
      ),
    );
    await _loadFirstPage(emit, version);
  }

  Future<void> _onSearchChanged(
    EventsSearchChanged event,
    Emitter<EventsState> emit,
  ) async {
    final query = event.query.trim();
    if (query == state.query) return; // e.g. a trailing space was added
    final version = ++_version;
    emit(_newList(state.copyWith(query: query)));
    await _loadFirstPage(emit, version);
  }

  Future<void> _onUpcomingToggled(
    EventsUpcomingToggled event,
    Emitter<EventsState> emit,
  ) async {
    if (event.upcomingOnly == state.upcomingOnly) return;
    final version = ++_version;
    emit(_newList(state.copyWith(upcomingOnly: event.upcomingOnly)));
    await _loadFirstPage(emit, version);
  }

  Future<void> _onNextPage(
    EventsNextPageRequested event,
    Emitter<EventsState> emit,
  ) async {
    final canLoadMore =
        state.status == EventsStatus.success &&
        state.hasMore &&
        !state.isLoadingMore &&
        state.cachedAt == null; // the cached list has no "next page"
    if (!canLoadMore) return;

    final version = _version;
    emit(state.copyWith(isLoadingMore: true, clearFailure: true));
    final result = await _getEvents(
      page: state.page + 1,
      query: state.query,
      upcomingOnly: state.upcomingOnly,
    );
    if (version != _version) return; // the list was replaced meanwhile

    switch (result) {
      case Ok(:final value):
        // Skip/limit pagination can repeat an item if an event was added
        // between two pages: never show it twice.
        final known = {for (final e in state.events) e.id};
        emit(
          state.copyWith(
            events: [
              ...state.events,
              ...value.items.where((e) => !known.contains(e.id)),
            ],
            page: value.page,
            hasMore: value.hasMore,
            isLoadingMore: false,
          ),
        );
      case Err(:final failure):
        // Keep what is shown; the page offers to retry at the bottom.
        emit(state.copyWith(isLoadingMore: false, failure: failure));
    }
  }

  /// A fresh list for a new search or filter: nothing shown yet.
  EventsState _newList(EventsState from) => from.copyWith(
    status: EventsStatus.loading,
    events: const [],
    page: 0,
    hasMore: false,
    isLoadingMore: false,
    clearCachedAt: true,
    clearFailure: true,
  );

  Future<void> _loadFirstPage(Emitter<EventsState> emit, int version) async {
    final Result<Paginated<CampusEvent>> result = await _getEvents(
      page: 1,
      query: state.query,
      upcomingOnly: state.upcomingOnly,
    );
    if (version != _version) return;

    switch (result) {
      case Ok(:final value):
        emit(
          state.copyWith(
            status: EventsStatus.success,
            events: value.items,
            page: value.page,
            hasMore: value.hasMore,
            isLoadingMore: false,
            clearCachedAt: true,
            clearFailure: true,
          ),
        );
      case Err(:final failure) when state.events.isNotEmpty:
        // Offline start or failed refresh: keep showing what we have
        // (the cached or previous list) and tell the user (F9).
        emit(state.copyWith(status: EventsStatus.success, failure: failure));
      case Err(:final failure):
        emit(state.copyWith(status: EventsStatus.failure, failure: failure));
    }
  }
}
