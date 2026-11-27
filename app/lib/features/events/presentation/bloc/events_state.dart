part of 'events_bloc.dart';

enum EventsStatus { initial, loading, success, failure }

/// State of the events list.
///
/// One class with a [status] (not one subclass per situation, as AuthState
/// does): the search text, the filter and the items already loaded must
/// SURVIVE while a new page loads, a refresh runs or an error is shown.
/// With subclasses they would be copied into every one of them.
///
/// How the page reads it (F7):
/// * loading + no events      -> spinner
/// * loading + events         -> list with a progress bar (refresh, or the
///                               cached list while the API answers)
/// * failure                  -> error view with Retry
/// * success + no events      -> empty view
/// * success + events         -> the list; [failure] != null means the last
///                               refresh or next page failed (banner/footer)
final class EventsState extends Equatable {
  const EventsState({
    this.status = EventsStatus.initial,
    this.events = const [],
    this.query = '',
    this.upcomingOnly = false,
    this.page = 0,
    this.hasMore = false,
    this.isLoadingMore = false,
    this.cachedAt,
    this.failure,
  });

  final EventsStatus status;
  final List<CampusEvent> events;
  final String query;
  final bool upcomingOnly;

  /// Last page loaded from the API (0 = none yet).
  final int page;
  final bool hasMore;
  final bool isLoadingMore;

  /// Not null while the list shown comes from the device cache (F9).
  final DateTime? cachedAt;

  /// The last error, if any.
  final Failure? failure;

  bool get isFiltered => query.isNotEmpty || upcomingOnly;

  EventsState copyWith({
    EventsStatus? status,
    List<CampusEvent>? events,
    String? query,
    bool? upcomingOnly,
    int? page,
    bool? hasMore,
    bool? isLoadingMore,
    DateTime? cachedAt,
    bool clearCachedAt = false,
    Failure? failure,
    bool clearFailure = false,
  }) {
    return EventsState(
      status: status ?? this.status,
      events: events ?? this.events,
      query: query ?? this.query,
      upcomingOnly: upcomingOnly ?? this.upcomingOnly,
      page: page ?? this.page,
      hasMore: hasMore ?? this.hasMore,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      cachedAt: clearCachedAt ? null : (cachedAt ?? this.cachedAt),
      failure: clearFailure ? null : (failure ?? this.failure),
    );
  }

  @override
  List<Object?> get props => [
    status,
    events,
    query,
    upcomingOnly,
    page,
    hasMore,
    isLoadingMore,
    cachedAt,
    failure,
  ];
}
