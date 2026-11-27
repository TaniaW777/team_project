import '../../domain/entities/club.dart';

/// JSON of a club (`toClubDto` in api/src/modules/clubs/club.model.ts).
class ClubModel extends Club {
  const ClubModel({
    required super.id,
    required super.name,
    required super.description,
    required super.status,
    required super.myRole,
  });

  factory ClubModel.fromJson(Map<String, dynamic> json) {
    return ClubModel(
      id: json['id'] as String,
      name: json['name'] as String,
      description: (json['description'] as String?) ?? '',
      status: json['status'] as String,
      myRole: json['myRole'] as String?,
    );
  }
}
