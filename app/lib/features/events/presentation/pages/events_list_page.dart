import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../auth/presentation/bloc/auth_bloc.dart';
import '../bloc/events_bloc.dart';
import '../widgets/events_list_body.dart';

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
          const Expanded(child: EventsListBody()),
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
