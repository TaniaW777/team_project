import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:eventpass/core/network/auth_interceptor.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/memory_token_storage.dart';

/// A fake API behind Dio (no network, no extra package): protected routes
/// accept only `Bearer <validToken>`; /auth/refresh rotates the tokens.
class FakeApi implements HttpClientAdapter {
  String validToken = 'AT2'; // the stored AT1 is "expired"
  bool refreshFails = false;
  int refreshCalls = 0;
  final refreshTokensSeen = <String?>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.path.endsWith('/auth/refresh')) {
      refreshCalls++;
      refreshTokensSeen.add((options.data as Map)['refreshToken'] as String?);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      if (refreshFails) return _json(401, _error('Invalid refresh token'));
      return _json(200, {
        'data': {'accessToken': 'AT2', 'refreshToken': 'RT2'},
      });
    }
    if (options.path.endsWith('/auth/login')) {
      return _json(401, _error('Invalid email or password'));
    }
    if (options.headers['Authorization'] != 'Bearer $validToken') {
      return _json(401, _error('Invalid or expired access token'));
    }
    return _json(200, {'data': 'ok'});
  }

  @override
  void close({bool force = false}) {}

  static Map<String, Object> _error(String message) => {
    'error': {'code': 'UNAUTHORIZED', 'message': message},
  };

  static ResponseBody _json(int status, Object body) => ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );
}

void main() {
  late FakeApi api;
  late MemoryTokenStorage storage;
  late Dio dio;
  late int sessionExpired;

  setUp(() {
    api = FakeApi();
    storage = MemoryTokenStorage(accessToken: 'AT1', refreshToken: 'RT1');
    sessionExpired = 0;
    Dio make() =>
        Dio(BaseOptions(baseUrl: 'http://api.test/api/v1'))
          ..httpClientAdapter = api;
    dio = make()
      ..interceptors.add(
        AuthInterceptor(
          tokenStorage: storage,
          plainDio: make(),
          onSessionExpired: () => sessionExpired++,
        ),
      );
  });

  test(
    'three simultaneous 401s trigger ONE refresh; all three succeed',
    () async {
      final responses = await Future.wait([
        dio.get<dynamic>('/clubs'),
        dio.get<dynamic>('/clubs/1'),
        dio.get<dynamic>('/clubs/2'),
      ]);

      expect(responses.map((r) => r.statusCode), [200, 200, 200]);
      expect(api.refreshCalls, 1); // RT1 presented exactly once (no reuse)
      expect(api.refreshTokensSeen, ['RT1']);
      expect(storage.accessToken, 'AT2');
      expect(storage.refreshToken, 'RT2');
      expect(sessionExpired, 0);
    },
  );

  test(
    'refresh rejected: tokens cleared, session-expired signalled, 401 surfaces',
    () async {
      api.refreshFails = true;

      await expectLater(
        dio.get<dynamic>('/clubs'),
        throwsA(
          isA<DioException>().having(
            (e) => e.response?.statusCode,
            'status',
            401,
          ),
        ),
      );
      expect(storage.accessToken, isNull);
      expect(storage.refreshToken, isNull);
      expect(sessionExpired, 1);
    },
  );

  test(
    'no refresh token on the device: no refresh call, session ends',
    () async {
      storage.refreshToken = null;

      await expectLater(
        dio.get<dynamic>('/clubs'),
        throwsA(isA<DioException>()),
      );
      expect(api.refreshCalls, 0);
      expect(sessionExpired, 1);
    },
  );

  test('a 401 on a public route (wrong password) is NOT refreshed', () async {
    await expectLater(
      dio.post<dynamic>('/auth/login', data: {'email': 'a', 'password': 'b'}),
      throwsA(isA<DioException>()),
    );
    expect(api.refreshCalls, 0);
    expect(sessionExpired, 0);
  });

  test('a valid token is sent as Bearer and needs no refresh', () async {
    storage.accessToken = 'AT2';
    final response = await dio.get<dynamic>('/clubs');
    expect(response.statusCode, 200);
    expect(api.refreshCalls, 0);
  });
}
