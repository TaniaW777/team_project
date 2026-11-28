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
  final rawError = body is Map<String, dynamic> ? body['error'] : null;
  final error = rawError is Map<String, dynamic> ? rawError : null;
  final message = error?['message'] as String?;
  final code = error?['code'] as String?;
  final details = _stringKeyedMap(error?['details']);

  // Check-in codes carry information the repository needs (checkedInAt,
  // retryability). They win over the generic status-code mapping below, so
  // a 422 INVALID_QR is terminal while a plain 422 stays a ValidationFailure.
  if (code != null && ApiErrorCodes.all.contains(code)) {
    return ApiFailure(
      message ?? _defaultMessage(code),
      code: code,
      details: details,
    );
  }

  switch (response.statusCode) {
    case 401:
      return UnauthorizedFailure(message ?? 'Please sign in again.');
    case 422:
      return ValidationFailure(
        message ?? 'Invalid data.',
        fieldErrors: _firstErrorPerField(error?['details']),
      );
    default:
      return message == null ? const ServerFailure() : ServerFailure(message);
  }
}

Map<String, dynamic> _stringKeyedMap(Object? value) {
  if (value is! Map) return const {};
  return {
    for (final MapEntry(:key, :value) in value.entries) key.toString(): value,
  };
}

String _defaultMessage(String code) => switch (code) {
  ApiErrorCodes.invalidQr => 'This QR code is not valid.',
  ApiErrorCodes.wrongEvent => 'This ticket is for another event.',
  ApiErrorCodes.alreadyCheckedIn => 'This ticket was already checked in.',
  ApiErrorCodes.ticketNotConfirmed => 'This ticket is not confirmed.',
  ApiErrorCodes.idempotencyKeyReused =>
    'This scan key was already used for another ticket.',
  ApiErrorCodes.forbidden => 'You are not allowed to check in this ticket.',
  ApiErrorCodes.concurrentUpdate => 'The event changed. Try again.',
  ApiErrorCodes.transactionOutcomeUnknown =>
    'The outcome is unknown. Try again.',
  _ => 'The server rejected this request.',
};

Map<String, String> _firstErrorPerField(Object? details) {
  if (details is! Map<String, dynamic>) return const {};
  return {
    for (final MapEntry(:key, :value) in details.entries)
      if (value is List && value.isNotEmpty) key: value.first.toString(),
  };
}
