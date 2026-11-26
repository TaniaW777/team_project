import '../../domain/entities/campus_event.dart';

/// The data-layer version of [CampusEvent]: it knows the JSON of the API
/// (`toEventDto` in api/src/modules/events/event.model.ts).
class CampusEventModel extends CampusEvent {
  const CampusEventModel({
    required super.id,
    required super.clubId,
    required super.title,
    required super.description,
    required super.location,
    required super.startsAt,
    required super.endsAt,
    required super.capacity,
    required super.confirmedCount,
    required super.seatsLeft,
    required super.status,
  });

  factory CampusEventModel.fromJson(Map<String, dynamic> json) {
    return CampusEventModel(
      id: json['id'] as String,
      clubId: json['clubId'] as String,
      title: json['title'] as String,
      description: (json['description'] as String?) ?? '',
      location: json['location'] as String,
      // The API sends UTC ISO-8601 dates; the app displays local time.
      startsAt: DateTime.parse(json['startsAt'] as String).toLocal(),
      endsAt: DateTime.parse(json['endsAt'] as String).toLocal(),
      capacity: json['capacity'] as int?,
      confirmedCount: json['confirmedCount'] as int,
      seatsLeft: json['seatsLeft'] as int?,
      status: json['status'] as String,
    );
  }

  /// Same shape as the API, so the device cache is read with [fromJson].
  Map<String, dynamic> toJson() => {
    'id': id,
    'clubId': clubId,
    'title': title,
    'description': description,
    'location': location,
    'startsAt': startsAt.toUtc().toIso8601String(),
    'endsAt': endsAt.toUtc().toIso8601String(),
    'capacity': capacity,
    'confirmedCount': confirmedCount,
    'seatsLeft': seatsLeft,
    'status': status,
  };
}
