import 'package:equatable/equatable.dart';

/// A pure Dart object: no JSON, no Flutter, no Dio (F1).
/// EventPass: `role` is the GLOBAL role (`user` or `admin`, ADR-012);
/// club roles come from the clubs API (`myRole`).
class User extends Equatable {
  const User({
    required this.id,
    required this.name,
    required this.email,
    this.role = 'user',
  });

  final String id;
  final String name;
  final String email;
  final String role;

  bool get isAdmin => role == 'admin';

  @override
  List<Object?> get props => [id, name, email, role];
}
