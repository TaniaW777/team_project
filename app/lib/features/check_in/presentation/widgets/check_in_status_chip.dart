import 'package:flutter/material.dart';

import '../../domain/entities/pending_check_in.dart';

/// Colour AND text, so a status is readable without relying on colour alone.
class CheckInStatusChip extends StatelessWidget {
  const CheckInStatusChip({super.key, required this.status});

  final CheckInSyncStatus status;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final (label, icon, background, foreground) = switch (status) {
      CheckInSyncStatus.pendingSync => (
        'Pending sync',
        Icons.schedule,
        colors.tertiaryContainer,
        colors.onTertiaryContainer,
      ),
      CheckInSyncStatus.synced => (
        'Synced',
        Icons.check_circle_outline,
        colors.primaryContainer,
        colors.onPrimaryContainer,
      ),
      CheckInSyncStatus.conflict => (
        'Already used',
        Icons.warning_amber_outlined,
        colors.errorContainer,
        colors.onErrorContainer,
      ),
      CheckInSyncStatus.rejected => (
        'Rejected',
        Icons.cancel_outlined,
        colors.errorContainer,
        colors.onErrorContainer,
      ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: foreground),
          const SizedBox(width: 4),
          Text(
            label,
            style: Theme.of(
              context,
            ).textTheme.labelMedium?.copyWith(color: foreground),
          ),
        ],
      ),
    );
  }
}
