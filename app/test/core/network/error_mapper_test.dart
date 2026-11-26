import 'package:dio/dio.dart';
import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/core/network/error_mapper.dart';
import 'package:eventpass/core/result/result.dart';
import 'package:flutter_test/flutter_test.dart';

DioException withResponse(int status, Object? data) {
  final options = RequestOptions(path: '/x');
  return DioException(
    requestOptions: options,
    response: Response(requestOptions: options, statusCode: status, data: data),
  );
}

void main() {
  test('no response at all -> NetworkFailure', () {
    final failure = mapDioException(
      DioException(requestOptions: RequestOptions(path: '/x')),
    );
    expect(failure, isA<NetworkFailure>());
  });

  test('401 keeps the API message', () {
    final failure = mapDioException(
      withResponse(401, {
        'error': {
          'code': 'UNAUTHORIZED',
          'message': 'Invalid email or password',
        },
      }),
    );
    expect(failure, const UnauthorizedFailure('Invalid email or password'));
  });

  test('422 -> ValidationFailure with the FIRST message of each field', () {
    final failure = mapDioException(
      withResponse(422, {
        'error': {
          'code': 'VALIDATION_ERROR',
          'message': 'The request contains invalid data',
          'details': {
            'email': ['Invalid email address', 'second'],
            'password': ['Too small'],
          },
        },
      }),
    );
    expect(
      failure,
      const ValidationFailure(
        'The request contains invalid data',
        fieldErrors: {
          'email': 'Invalid email address',
          'password': 'Too small',
        },
      ),
    );
  });

  test('409 / 403 / 503 -> ServerFailure with the API message', () {
    final failure = mapDioException(
      withResponse(409, {
        'error': {
          'code': 'CONFLICT',
          'message': 'This email is already registered',
        },
      }),
    );
    expect(failure, const ServerFailure('This email is already registered'));
  });

  test('a body that is not our error envelope -> generic ServerFailure', () {
    expect(mapDioException(withResponse(500, 'oops')), const ServerFailure());
  });

  test('guard turns any other exception into Err(ServerFailure)', () async {
    final result = await guard<int>(() async => throw StateError('bug'));
    expect((result as Err).failure, const ServerFailure());
  });
}
