import 'package:flutter/material.dart';

import '../../domain/entities/campus_event.dart';

/// One event in the list: title, date, place and how many places are left.
class EventCard extends StatelessWidget {
  const EventCard({super.key, required this.event, this.onTap});

  final CampusEvent event;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      event.title,
                      style: theme.textTheme.titleMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  _PlacesChip(event: event),
                ],
              ),
              const SizedBox(height: 8),
              _InfoLine(
                icon: Icons.schedule,
                text: formatEventDate(context, event.startsAt),
              ),
              const SizedBox(height: 4),
              _InfoLine(icon: Icons.place_outlined, text: event.location),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Mon, Dec 1, 2026 · 6:30 PM" in the language and format of the device.
String formatEventDate(BuildContext context, DateTime date) {
  final localizations = MaterialLocalizations.of(context);
  final day = localizations.formatMediumDate(date);
  final time = localizations.formatTimeOfDay(
    TimeOfDay.fromDateTime(date),
    alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
  );
  return '$day · $time';
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(icon, size: 16, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            text,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

/// Places left, with colour AND text (colour alone is not accessible).
class _PlacesChip extends StatelessWidget {
  const _PlacesChip({required this.event});

  final CampusEvent event;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final (label, background, foreground) = switch (event) {
      CampusEvent(isCancelled: true) => (
        'Cancelled',
        colors.errorContainer,
        colors.onErrorContainer,
      ),
      CampusEvent(isUnlimited: true) => (
        'Open',
        colors.secondaryContainer,
        colors.onSecondaryContainer,
      ),
      CampusEvent(isFull: true) => (
        'Full · waiting list',
        colors.tertiaryContainer,
        colors.onTertiaryContainer,
      ),
      CampusEvent(:final seatsLeft) => (
        seatsLeft == 1 ? '1 place left' : '$seatsLeft places left',
        colors.primaryContainer,
        colors.onPrimaryContainer,
      ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        label,
        style: Theme.of(
          context,
        ).textTheme.labelMedium?.copyWith(color: foreground),
      ),
    );
  }
}
