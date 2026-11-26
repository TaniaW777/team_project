import 'package:dio/dio.dart';
import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/core/network/auth_interceptor.dart';
import 'package:eventpass/core/result/result.dart';
import 'package:eventpass/features/auth/data/datasources/auth_remote_data_source.dart';
import 'package:eventpass/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:eventpass/features/auth/domain/entities/user.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/memory_token_storage.dart';

// App <-> API CONTRACT TEST (Phase 5). The real data layer of the app (Dio +
// AuthInterceptor + AuthRemoteDataSource + AuthRepositoryImpl) against a REAL
// running EventPass API. Skipped unless an API URL is given, e.g.:
//   flutter test test/integration --dart-define=INTEGRATION_API_URL=http://127.0.0.1:3001/api/v1
// Point it at an API running on a TEST database only (it registers users).
const apiUrl = String.fromEnvironment('INTEGRATION_API_URL');

void main() {
  late MemoryTokenStorage storage;
  late AuthRepositoryImpl repository;
  late Dio plain;
  late int sessionExpired;

  setUp(() {
    storage = MemoryTokenStorage();
    sessionExpired = 0;
    Dio make() => Dio(BaseOptions(baseUrl: apiUrl));
    plain = make();
    final dio = make()
      ..interceptors.add(
        AuthInterceptor(
          tokenStorage: storage,
          plainDio: make(),
          onSessionExpired: () => sessionExpired++,
        ),
      );
    repository = AuthRepositoryImpl(
      remote: AuthRemoteDataSource(dio),
      tokenStorage: storage,
    );
  });

  final skip = apiUrl.isEmpty ? 'set INTEGRATION_API_URL to run' : false;
  String uniqueEmail() =>
      'contract-${DateTime.now().microsecondsSinceEpoch}@example.com';

  test(
    'register -> me -> silent refresh -> logout, against the real API',
    () async {
      final email = uniqueEmail();

      // Register: user parsed (incl. role), both tokens stored.
      final registered = await repository.register(
        name: 'Contract Test',
        email: ' $email ',
        password: 'correct-horse-9',
      );
      expect(registered, isA<Ok<User>>());
      final user = (registered as Ok<User>).value;
      expect(user.email, email);
      expect(user.role, 'user');
      expect(storage.accessToken, isNotNull);
      final firstRefresh = storage.refreshToken;
      expect(firstRefresh, isNotNull);

      // Session restore: /auth/me with the stored access token.
      expect(await repository.currentUser(), isA<Ok<User>>());

      // Expired/invalid access token: the API answers 401, the interceptor
      // refreshes ONCE with the stored refresh token and replays /auth/me.
      storage.accessToken = 'not-a-valid-token';
      final restored = await repository.currentUser();
      expect(restored, isA<Ok<User>>());
      expect((restored as Ok<User>).value.id, user.id);
      expect(storage.refreshToken, isNot(firstRefresh)); // rotated by the API
      expect(sessionExpired, 0);

      // The rotated-away refresh token is now refused by the API (reuse).
      final reuse = await plain.post<dynamic>(
        '/auth/refresh',
        data: {'refreshToken': firstRefresh},
        options: Options(validateStatus: (_) => true),
      );
      expect(reuse.statusCode, 401);
    },
    skip: skip,
  );

  test(
    'logout revokes the session on the server and clears the device',
    () async {
      final email = uniqueEmail();
      await repository.register(
        name: 'Contract Test',
        email: email,
        password: 'correct-horse-9',
      );
      final refreshToken = storage.refreshToken;

      await repository.logout();

      expect(storage.accessToken, isNull);
      expect(storage.refreshToken, isNull);
      final afterLogout = await plain.post<dynamic>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
        options: Options(validateStatus: (_) => true),
      );
      expect(afterLogout.statusCode, 401);
    },
    skip: skip,
  );

  test('API errors map to the app failures (422 fields, 409, 401)', () async {
    final invalid = await repository.register(
      name: 'A',
      email: 'not-an-email',
      password: 'short',
    );
    final validation = (invalid as Err<User>).failure;
    expect(validation, isA<ValidationFailure>());
    expect(
      (validation as ValidationFailure).fieldErrors.keys,
      containsAll(['name', 'email', 'password']),
    );

    final email = uniqueEmail();
    await repository.register(
      name: 'Ada',
      email: email,
      password: 'correct-horse-9',
    );
    final duplicate = await repository.register(
      name: 'Ada',
      email: email,
      password: 'correct-horse-9',
    );
    expect((duplicate as Err<User>).failure, isA<ServerFailure>());
    expect(duplicate.failure.message, 'This email is already registered');

    final wrong = await repository.login(
      email: email,
      password: 'wrong-password',
    );
    expect(
      (wrong as Err<User>).failure,
      const UnauthorizedFailure('Invalid email or password'),
    );
  }, skip: skip);
}
