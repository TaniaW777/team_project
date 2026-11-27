import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/widgets/state_views.dart';
import '../../../auth/presentation/bloc/auth_bloc.dart';
import '../bloc/events_bloc.dart';
import '../widgets/event_card.dart';

/// The signed-in home screen: browse, search and filter events.
/// The page only reports what the user does to the [EventsBloc] and draws
/// its state; it never calls the API (F2).
class EventsListPage extends StatefulWidget {
  const EventsListPage({super.key, this.onScanRequested});

  /// Optional entry point to the check-in scanner (Member 4); the router
  /// supplies it so this feature stays independent of go_router.
  final VoidCallback? onScanRequested;

  @override
  State<EventsListPage> createState() => _EventsListPageState();
}

class _EventsListPageState extends State<EventsListPage> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  /// Completes when the refresh is over, so the pull-to-refresh spinner
  /// stays visible exactly as long as the request.
  Future<void> _refresh() {
    final bloc = context.read<EventsBloc>()..add(const EventsRefreshed());
    return bloc.stream.firstWhere((s) => s.status != EventsStatus.loading);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Events'),
        actions: [
          IconButton(
            tooltip: 'Scanner',
            icon: const Icon(Icons.qr_code_scanner),
            onPressed: widget.onScanRequested,
          ),
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () =>
                context.read<AuthBloc>().add(const AuthLogoutRequested()),
          ),
        ],
      ),
      body: Column(
        children: [
          _SearchBar(controller: _search),
          Expanded(
            child: BlocConsumer<EventsBloc, EventsState>(
              // A failed refresh or next page while a list is visible: a
              // snackbar, the list stays (the full-screen error is for the
              // case where there is nothing to show).
              listenWhen: (previous, current) =>
                  current.failure != null &&
                  current.failure != previous.failure &&
                  current.status == EventsStatus.success &&
                  current.cachedAt == null,
              listener: (context, state) {
                ScaffoldMessenger.of(context)
                  ..hideCurrentSnackBar()
                  ..showSnackBar(
                    SnackBar(content: Text(state.failure!.message)),
                  );
              },
              builder: (context, state) => switch (state) {
                EventsState(status: EventsStatus.initial) ||
                EventsState(
                  status: EventsStatus.loading,
                  events: [],
                ) => const LoadingView(),
                EventsState(status: EventsStatus.failure, :final failure) =>
                  ErrorView(
                    message: failure?.message ?? 'Could not load events.',
                    onRetry: () =>
                        context.read<EventsBloc>().add(const EventsRefreshed()),
                  ),
                EventsState(events: []) => _EmptyEvents(state: state),
                _ => _EventsList(state: state, onRefresh: _refresh),
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _SearchBar extends StatelessWidget {
  const _SearchBar({required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    final bloc = context.read<EventsBloc>();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: controller,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search events',
              prefixIcon: const Icon(Icons.search),
              // Rebuilds only the clear button when the text changes.
              suffixIcon: ValueListenableBuilder(
                valueListenable: controller,
                builder: (context, value, _) => value.text.isEmpty
                    ? const SizedBox.shrink()
                    : IconButton(
                        tooltip: 'Clear search',
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          controller.clear();
                          bloc.add(const EventsSearchChanged(''));
                        },
                      ),
              ),
            ),
            onChanged: (text) => bloc.add(EventsSearchChanged(text)),
          ),
          const SizedBox(height: 8),
          BlocSelector<EventsBloc, EventsState, bool>(
            selector: (state) => state.upcomingOnly,
            builder: (context, upcomingOnly) => FilterChip(
              label: const Text('Upcoming only'),
              selected: upcomingOnly,
              onSelected: (value) => bloc.add(EventsUpcomingToggled(value)),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyEvents extends StatelessWidget {
  const _EmptyEvents({required this.state});

  final EventsState state;

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
        : const EmptyView(
            icon: Icons.event_busy,
            title: 'No events yet',
            message: 'Events published by clubs will appear here.',
          );
  }
}

class _EventsList extends StatelessWidget {
  const _EventsList({required this.state, required this.onRefresh});

  final EventsState state;
  final Future<void> Function() onRefresh;

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
            onRefresh: onRefresh,
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
                  // Tapping opens the event details (next screen to build).
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
    final time = MaterialLocalizations.of(
      context,
    ).formatTimeOfDay(TimeOfDay.fromDateTime(savedAt));
    final day = MaterialLocalizations.of(context).formatShortDate(savedAt);
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
