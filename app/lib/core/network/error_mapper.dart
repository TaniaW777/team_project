import 'package:dio/dio.dart';

import '../error/failure.dart';
import '../result/result.dart';

/// Runs [body] and converts any exception into an [Err].
/// Every repository method goes through this single function: failures are
/// mapped ONCE, at the border of the data layer (lab §3.3, F3).
Future<Result<T>> guard<T>(Future<T> Function() body) async {
  try {
    return Ok(await body());
  } on DioException catch (e) {
    return Err(mapDioException(e));
  } catch (_) {
    return const Err(ServerFailure());
  }
}

/// Translates a low-level Dio error into a domain [Failure].
Failure mapDioException(DioException e) {
  final response = e.response;

  // No response at all: the request never reached the server.
  if (response == null) return const NetworkFailure();

  // The EventPass API always answers errors as:
  // { "error": { "code": "...", "message": "...", "details": {...} } }
  final body = response.data;
  final error = body is Map<String, dynamic> ? body['error'] : null;
  final message = error is Map<String, dynamic>
      ? error['message'] as String?
      : null;

  switch (response.statusCode) {
    case 401:
      return UnauthorizedFailure(message ?? 'Please sign in again.');
    case 422:
      final details = error is Map<String, dynamic> ? error['details'] : null;
      return ValidationFailure(
        message ?? 'Invalid data.',
        fieldErrors: _firstErrorPerField(details),
      );
    default:
      return message == null ? const ServerFailure() : ServerFailure(message);
  }
}

Map<String, String> _firstErrorPerField(Object? details) {
  if (details is! Map<String, dynamic>) return const {};
  return {
    for (final MapEntry(:key, :value) in details.entries)
      if (value is List && value.isNotEmpty) key: value.first.toString(),
  };
}
