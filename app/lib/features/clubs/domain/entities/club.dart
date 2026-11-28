import 'package:equatable/equatable.dart';

/// A club, as seen by the signed-in user. Pure Dart (F1).
class Club extends Equatable {
  const Club({
    required this.id,
    required this.name,
    required this.description,
    required this.status,
    required this.myRole,
  });

  final String id;
  final String name;
  final String description;

  /// `active` or `archived`.
  final String status;

  /// The caller's role in THIS club: `organizer`, `staff` or `null` (none).
  /// Computed by the server from the memberships, never chosen by the app.
  /// It only decides what the app SHOWS; the API checks it again on every
  /// request (A7).
  final String? myRole;

  bool get isOrganizer => myRole == 'organizer';
  bool get isStaff => myRole == 'staff';

  @override
  List<Object?> get props => [id, name, description, status, myRole];
}
