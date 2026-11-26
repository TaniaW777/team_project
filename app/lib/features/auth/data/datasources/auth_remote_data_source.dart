import 'package:dio/dio.dart';

import '../models/user_model.dart';

/// A Dart 3 record: a lightweight, typed group of values.
typedef AuthSession = ({
  UserModel user,
  String accessToken,
  String refreshToken,
});

/// Talks to the /auth endpoints. Throws DioException on failure; turning
/// exceptions into Failures is the repository's job (lab §3.6).
class AuthRemoteDataSource {
  const AuthRemoteDataSource(this._dio);

  final Dio _dio;

  Future<AuthSession> login({
    required String email,
    required String password,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'email': email, 'password': password},
    );
    return _parseSession(response.data!);
  }

  Future<AuthSession> register({
    required String name,
    required String email,
    required String password,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/auth/register',
      data: {'name': name, 'email': email, 'password': password},
    );
    return _parseSession(response.data!);
  }

  Future<UserModel> me() async {
    final response = await _dio.get<Map<String, dynamic>>('/auth/me');
    return UserModel.fromJson(response.data!['data'] as Map<String, dynamic>);
  }

  Future<void> logout(String refreshToken) async {
    await _dio.post<void>('/auth/logout', data: {'refreshToken': refreshToken});
  }

  AuthSession _parseSession(Map<String, dynamic> body) {
    final data = body['data'] as Map<String, dynamic>;
    return (
      user: UserModel.fromJson(data['user'] as Map<String, dynamic>),
      accessToken: data['accessToken'] as String,
      refreshToken: data['refreshToken'] as String,
    );
  }
}
