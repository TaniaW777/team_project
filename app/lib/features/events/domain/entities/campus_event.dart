import 'package:equatable/equatable.dart';

/// An event organised by a club. Pure Dart: no JSON, no Flutter, no Dio (F1).
///
/// Named `CampusEvent` (not `Event`) so it is never confused with a BLoC
/// event (`EventsStarted`, `EventsSearchChanged`...).
class CampusEvent extends Equatable {
  const CampusEvent({
    required this.id,
    required this.clubId,
    required this.title,
    required this.description,
    required this.location,
    required this.startsAt,
    required this.endsAt,
    required this.capacity,
    required this.confirmedCount,
    required this.seatsLeft,
    required this.status,
  });

  final String id;
  final String clubId;
  final String title;
  final String description;
  final String location;
  final DateTime startsAt;
  final DateTime endsAt;

  /// Maximum number of confirmed places; `null` means unlimited.
  final int? capacity;
  final int confirmedCount;

  /// Computed by the server; `null` when the capacity is unlimited.
  final int? seatsLeft;

  /// `published` or `cancelled` (api: EVENT_STATUSES).
  final String status;

  bool get isUnlimited => capacity == null;
  bool get isFull => seatsLeft == 0;
  bool get isCancelled => status == 'cancelled';

  @override
  List<Object?> get props => [
    id,
    clubId,
    title,
    description,
    location,
    startsAt,
    endsAt,
    capacity,
    confirmedCount,
    seatsLeft,
    status,
  ];
}
