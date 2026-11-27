import 'package:eventpass/features/events/data/models/campus_event_model.dart';
import 'package:flutter_test/flutter_test.dart';

import 'events_fixtures.dart';

void main() {
  test('fromJson reads the API format (toEventDto)', () {
    final event = CampusEventModel.fromJson(eventJson('a'));

    expect(event.id, 'a');
    expect(event.title, 'Event a');
    expect(event.startsAt.toUtc(), DateTime.utc(2026, 12, 1, 18));
    expect(event.capacity, 50);
    expect(event.seatsLeft, 47);
    expect(event.isFull, isFalse);
    expect(event.isUnlimited, isFalse);
  });

  test('capacity null = unlimited places', () {
    final event = CampusEventModel.fromJson(eventJson('a', capacity: null));

    expect(event.isUnlimited, isTrue);
    expect(event.seatsLeft, isNull);
    expect(event.isFull, isFalse);
  });

  test('toJson then fromJson gives the same event (device cache)', () {
    final event = CampusEventModel.fromJson(eventJson('a'));

    expect(CampusEventModel.fromJson(event.toJson()), event);
  });
}
