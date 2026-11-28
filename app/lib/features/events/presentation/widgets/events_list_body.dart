import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/widgets/state_views.dart';
import '../bloc/events_bloc.dart';
import 'event_card.dart';

/// The list part of an events screen, drawn from the [EventsBloc] state:
/// loading, error with retry, empty, content (F7), plus the offline banner
/// (F9), pull-to-refresh and infinite scroll. Used by the events tab and by
/// the page of a club.
class EventsListBody extends StatelessWidget {
  const EventsListBody({super.key, this.emptyTitle, this.emptyMessage});

  /// Text of the empty view when no search or filter is active.
  final String? emptyTitle;
  final String? emptyMessage;

  /// Completes when the refresh is over, so the pull-to-refresh spinner
  /// stays visible exactly as long as the request.
  static Future<void> refresh(EventsBloc bloc) {
    bloc.add(const EventsRefreshed());
    return bloc.stream.firstWhere((s) => s.status != EventsStatus.loading);
  }

  @override
  Widget build(BuildContext context) {
    return BlocConsumer<EventsBloc, EventsState>(
      // A failed refresh or next page while a list is visible: a snackbar,
      // the list stays (the full-screen error is for when nothing is shown).
      listenWhen: (previous, current) =>
          current.failure != null &&
          current.failure != previous.failure &&
          current.status == EventsStatus.success &&
          current.cachedAt == null,
      listener: (context, state) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(state.failure!.message)));
      },
      builder: (context, state) => switch (state) {
        EventsState(status: EventsStatus.initial) ||
        EventsState(
          status: EventsStatus.loading,
          events: [],
        ) => const LoadingView(),
        EventsState(status: EventsStatus.failure, :final failure) => ErrorView(
          message: failure?.message ?? 'Could not load events.',
          onRetry: () =>
              context.read<EventsBloc>().add(const EventsRefreshed()),
        ),
        EventsState(events: []) => _EmptyEvents(
          state: state,
          title: emptyTitle,
          message: emptyMessage,
        ),
        _ => _EventsList(state: state),
      },
    );
  }
}

class _EmptyEvents extends StatelessWidget {
  const _EmptyEvents({required this.state, this.title, this.message});

  final EventsState state;
  final String? title;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return state.isFiltered
        ? EmptyView(
            icon: Icons.search_off,
            title: state.query.isEmpty
                ? 'No upcoming events'
                : 'No events match "${state.query}"',
            message: 'Try another search or remove the filter.',
          )
        : EmptyView(
            icon: Icons.event_busy,
            title: title ?? 'No events yet',
            message: message ?? 'Events published by clubs will appear here.',
          );
  }
}

class _EventsList extends StatelessWidget {
  const _EventsList({required this.state});

  final EventsState state;

  @override
  Widget build(BuildContext context) {
    final bloc = context.read<EventsBloc>();
    final refreshing = state.status == EventsStatus.loading;
    // One extra row at the end for "loading more" or "retry".
    final showFooter =
        state.isLoadingMore || (state.failure != null && state.hasMore);

    return Column(
      children: [
        if (refreshing) const LinearProgressIndicator(),
        if (state.cachedAt != null)
          _OfflineBanner(
            savedAt: state.cachedAt!,
            stillLoading: refreshing,
            onRetry: () => bloc.add(const EventsRefreshed()),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => EventsListBody.refresh(bloc),
            child: NotificationListener<ScrollNotification>(
              // Infinite scroll: ask for the next page 300 px before the end.
              // Many notifications arrive; the droppable transformer and the
              // bloc's own checks make sure only one page loads at a time.
              onNotification: (notification) {
                if (notification.metrics.extentAfter < 300) {
                  bloc.add(const EventsNextPageRequested());
                }
                return false;
              },
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                itemCount: state.events.length + (showFooter ? 1 : 0),
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  if (index == state.events.length) {
                    return _ListFooter(
                      loading: state.isLoadingMore,
                      onRetry: () => bloc.add(const EventsNextPageRequested()),
                    );
                  }
                  // Tapping opens the event details (next pull request).
                  return EventCard(event: state.events[index]);
                },
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner({
    required this.savedAt,
    required this.stillLoading,
    required this.onRetry,
  });

  final DateTime savedAt;
  final bool stillLoading;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final localizations = MaterialLocalizations.of(context);
    final time = localizations.formatTimeOfDay(TimeOfDay.fromDateTime(savedAt));
    final day = localizations.formatShortDate(savedAt);
    return MaterialBanner(
      leading: const Icon(Icons.cloud_off),
      content: Text(
        stillLoading
            ? 'Showing events saved on $day at $time. Updating…'
            : 'Offline. Showing events saved on $day at $time.',
      ),
      actions: [
        TextButton(
          onPressed: stillLoading ? null : onRetry,
          child: const Text('Retry'),
        ),
      ],
    );
  }
}

class _ListFooter extends StatelessWidget {
  const _ListFooter({required this.loading, required this.onRetry});

  final bool loading;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: loading
            ? const CircularProgressIndicator()
            : TextButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Could not load more. Retry'),
              ),
      ),
    );
  }
}
