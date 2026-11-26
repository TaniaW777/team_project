import 'package:eventpass/core/pagination/paginated.dart';
import 'package:eventpass/features/events/domain/entities/campus_event.dart';

/// Builds a test event; only the id and title usually matter.
CampusEvent testEvent(String id, {String? title, int? seatsLeft = 10}) {
  return CampusEvent(
    id: id,
    clubId: 'club-1',
    title: title ?? 'Event $id',
    description: '',
    location: 'Amphi A',
    startsAt: DateTime.utc(2026, 12, 1, 18),
    endsAt: DateTime.utc(2026, 12, 1, 20),
    capacity: seatsLeft == null ? null : 50,
    confirmedCount: seatsLeft == null ? 0 : 50 - seatsLeft,
    seatsLeft: seatsLeft,
    status: 'published',
  );
}

Paginated<CampusEvent> pageOf(
  List<CampusEvent> items, {
  int page = 1,
  int totalPages = 1,
}) {
  return Paginated(
    items: items,
    page: page,
    totalPages: totalPages,
    total: items.length,
  );
}

/// One event as the API sends it (`toEventDto`).
Map<String, dynamic> eventJson(String id, {int? capacity = 50}) => {
  'id': id,
  'clubId': 'club-1',
  'title': 'Event $id',
  'description': 'About $id',
  'location': 'Amphi A',
  'startsAt': '2026-12-01T18:00:00.000Z',
  'endsAt': '2026-12-01T20:00:00.000Z',
  'capacity': capacity,
  'confirmedCount': 3,
  'seatsLeft': capacity == null ? null : capacity - 3,
  'status': 'published',
  'createdAt': '2026-11-20T10:00:00.000Z',
};
