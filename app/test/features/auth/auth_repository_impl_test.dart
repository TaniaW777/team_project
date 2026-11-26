import 'package:dio/dio.dart';
import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/core/result/result.dart';
import 'package:eventpass/features/auth/data/datasources/auth_remote_data_source.dart';
import 'package:eventpass/features/auth/data/models/user_model.dart';
import 'package:eventpass/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import '../../helpers/memory_token_storage.dart';

class MockRemote extends Mock implements AuthRemoteDataSource {}

DioException apiError(int status, String message) {
  final options = RequestOptions(path: '/auth/login');
  return DioException(
    requestOptions: options,
    response: Response(
      requestOptions: options,
      statusCode: status,
      data: {
        'error': {'code': 'X', 'message': message},
      },
    ),
  );
}

void main() {
  late MockRemote remote;
  late MemoryTokenStorage storage;
  late AuthRepositoryImpl repository;
  const ada = UserModel(id: 'u1', name: 'Ada', email: 'ada@example.com');

  setUp(() {
    remote = MockRemote();
    storage = MemoryTokenStorage();
    repository = AuthRepositoryImpl(remote: remote, tokenStorage: storage);
  });

  test('login success returns the user and stores BOTH tokens', () async {
    when(
      () => remote.login(email: 'ada@example.com', password: 'pw'),
    ).thenAnswer(
      (_) async => (user: ada, accessToken: 'AT', refreshToken: 'RT'),
    );

    final result = await repository.login(
      email: 'ada@example.com',
      password: 'pw',
    );

    expect(result, isA<Ok<dynamic>>());
    expect((result as Ok).value, ada);
    expect(storage.accessToken, 'AT');
    expect(storage.refreshToken, 'RT');
  });

  test(
    'login failure is mapped once, at the data border; nothing stored',
    () async {
      when(
        () => remote.login(
          email: any(named: 'email'),
          password: any(named: 'password'),
        ),
      ).thenThrow(apiError(401, 'Invalid email or password'));

      final result = await repository.login(
        email: 'ada@example.com',
        password: 'x',
      );

      expect(result, isA<Err<dynamic>>());
      expect(
        (result as Err).failure,
        const UnauthorizedFailure('Invalid email or password'),
      );
      expect(storage.accessToken, isNull);
    },
  );

  test('currentUser without a stored token does not call the API', () async {
    final result = await repository.currentUser();

    expect((result as Err).failure, isA<UnauthorizedFailure>());
    verifyNever(() => remote.me());
  });

  test('currentUser with a token asks /auth/me', () async {
    storage.accessToken = 'AT';
    when(() => remote.me()).thenAnswer((_) async => ada);

    final result = await repository.currentUser();

    expect((result as Ok).value, ada);
  });

  test(
    'logout clears the device FIRST, even if the server is unreachable',
    () async {
      storage
        ..accessToken = 'AT'
        ..refreshToken = 'RT';
      when(() => remote.logout('RT')).thenThrow(
        DioException(requestOptions: RequestOptions(path: '/auth/logout')),
      );

      await repository.logout();

      expect(storage.accessToken, isNull);
      expect(storage.refreshToken, isNull);
      verify(() => remote.logout('RT')).called(1);
    },
  );
}
