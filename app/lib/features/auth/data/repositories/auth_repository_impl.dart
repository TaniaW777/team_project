import '../../../../core/error/failure.dart';
import '../../../../core/network/error_mapper.dart';
import '../../../../core/result/result.dart';
import '../../../../core/storage/token_storage.dart';
import '../../domain/entities/user.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_remote_data_source.dart';

/// Coordinates the API and the token storage; translates models into
/// entities and exceptions into failures (lab §3.6, F3).
class AuthRepositoryImpl implements AuthRepository {
  const AuthRepositoryImpl({
    required this._remote,
    required this._tokenStorage,
  });

  final AuthRemoteDataSource _remote;
  final TokenStorage _tokenStorage;

  @override
  Future<Result<User>> login({
    required String email,
    required String password,
  }) {
    return guard(() async {
      final session = await _remote.login(email: email, password: password);
      return _persist(session);
    });
  }

  @override
  Future<Result<User>> register({
    required String name,
    required String email,
    required String password,
  }) {
    return guard(() async {
      final session = await _remote.register(
        name: name,
        email: email,
        password: password,
      );
      return _persist(session);
    });
  }

  @override
  Future<Result<User>> currentUser() async {
    // No token on the device: do not even call the API.
    final token = await _tokenStorage.readAccessToken();
    if (token == null) return const Err(UnauthorizedFailure());
    return guard(_remote.me);
  }

  @override
  Future<void> logout() async {
    final refreshToken = await _tokenStorage.readRefreshToken();
    // Always clear the device first: logout must work offline too.
    await _tokenStorage.clear();
    if (refreshToken != null) {
      // Best effort: tell the server to revoke the session.
      await guard(() => _remote.logout(refreshToken));
    }
  }

  Future<User> _persist(AuthSession session) async {
    await _tokenStorage.save(
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    );
    return session.user;
  }
}
