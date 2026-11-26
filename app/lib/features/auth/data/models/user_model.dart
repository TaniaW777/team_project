import '../../domain/entities/user.dart';

/// The data-layer version of [User]: it knows the JSON format of the API
/// (`{ id, name, email, role, createdAt }`, docs/api-conventions.md).
class UserModel extends User {
  const UserModel({
    required super.id,
    required super.name,
    required super.email,
    super.role,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] as String,
      name: json['name'] as String,
      email: json['email'] as String,
      role: (json['role'] as String?) ?? 'user',
    );
  }
}
