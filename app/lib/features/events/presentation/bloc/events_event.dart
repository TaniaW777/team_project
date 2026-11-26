part of 'events_bloc.dart';

/// What can happen on the events list screen.
sealed class EventsEvent extends Equatable {
  const EventsEvent();

  @override
  List<Object?> get props => [];
}

/// The screen opens: show the cached list at once, then load from the API.
final class EventsStarted extends EventsEvent {
  const EventsStarted();
}

/// Pull-to-refresh or the "Retry" button: reload the first page.
final class EventsRefreshed extends EventsEvent {
  const EventsRefreshed();
}

/// The text of the search box changed (debounced, see the bloc).
final class EventsSearchChanged extends EventsEvent {
  const EventsSearchChanged(this.query);

  final String query;

  @override
  List<Object?> get props => [query];
}

/// The "Upcoming only" filter was switched on or off.
final class EventsUpcomingToggled extends EventsEvent {
  const EventsUpcomingToggled(this.upcomingOnly);

  final bool upcomingOnly;

  @override
  List<Object?> get props => [upcomingOnly];
}

/// The user scrolled near the end of the list (infinite scroll).
final class EventsNextPageRequested extends EventsEvent {
  const EventsNextPageRequested();
}
