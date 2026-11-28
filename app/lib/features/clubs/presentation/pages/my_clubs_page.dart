import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/routes.dart';
import '../../../../core/widgets/state_views.dart';
import '../../domain/entities/club.dart';
import '../cubit/my_clubs_cubit.dart';

/// "My clubs" tab: the clubs where I am organizer or door staff.
class MyClubsPage extends StatelessWidget {
  const MyClubsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<MyClubsCubit>();
    return Scaffold(
      appBar: AppBar(title: const Text('My clubs')),
      body: BlocBuilder<MyClubsCubit, MyClubsState>(
        builder: (context, state) => switch (state) {
          MyClubsLoading() => const LoadingView(),
          MyClubsFailure(:final failure) => ErrorView(
            message: failure.message,
            onRetry: cubit.load,
          ),
          MyClubsLoaded(clubs: []) => const EmptyView(
            icon: Icons.groups_outlined,
            title: 'You are not in a club yet',
            message:
                'Club organizers and door staff see their clubs here. '
                'Ask a club organizer to add you.',
          ),
          MyClubsLoaded(:final clubs) => RefreshIndicator(
            onRefresh: cubit.load,
            child: ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              itemCount: clubs.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, index) => _ClubTile(club: clubs[index]),
            ),
          ),
        },
      ),
    );
  }
}

class _ClubTile extends StatelessWidget {
  const _ClubTile({required this.club});

  final Club club;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          child: Text(club.name.isEmpty ? '?' : club.name[0].toUpperCase()),
        ),
        title: Text(club.name),
        subtitle: Text(
          club.description.isEmpty ? 'No description' : club.description,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: RoleChip(role: club.myRole),
        onTap: () => context.push(AppRoutes.club(club.id)),
      ),
    );
  }
}

/// The user's role in a club, in words (not only a colour).
class RoleChip extends StatelessWidget {
  const RoleChip({super.key, required this.role});

  final String? role;

  @override
  Widget build(BuildContext context) {
    final label = switch (role) {
      'organizer' => 'Organizer',
      'staff' => 'Door staff',
      _ => null,
    };
    if (label == null) return const SizedBox.shrink();
    return Chip(label: Text(label), visualDensity: VisualDensity.compact);
  }
}
