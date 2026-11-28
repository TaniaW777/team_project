import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/widgets/state_views.dart';
import '../../../events/presentation/widgets/events_list_body.dart';
import '../cubit/club_cubit.dart';
import 'my_clubs_page.dart';

/// A club and its published events.
/// Two state holders: [ClubCubit] (the club and my role) and an
/// [EventsBloc] restricted to this club (the list, reused from the events
/// feature).
class ClubEventsPage extends StatelessWidget {
  const ClubEventsPage({super.key, required this.clubId});

  final String clubId;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ClubCubit, ClubState>(
      builder: (context, state) => switch (state) {
        ClubLoading() => Scaffold(appBar: AppBar(), body: const LoadingView()),
        ClubFailure(:final failure) => Scaffold(
          appBar: AppBar(),
          body: ErrorView(
            message: failure.message,
            onRetry: () => context.read<ClubCubit>().load(clubId),
          ),
        ),
        ClubLoaded(:final club) => Scaffold(
          appBar: AppBar(
            title: Text(club.name),
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 12),
                child: RoleChip(role: club.myRole),
              ),
            ],
          ),
          body: const EventsListBody(
            emptyTitle: 'No events in this club',
            emptyMessage: 'Published events of the club will appear here.',
          ),
        ),
      },
    );
  }
}
