import 'package:dio/dio.dart';

import '../storage/token_storage.dart';

/// 1. Adds `Authorization: Bearer <access token>` to every request.
/// 2. When the API answers 401, silently refreshes the tokens and replays
///    the request, so the user never notices the access token expired.
///
/// A [QueuedInterceptor] handles errors ONE AT A TIME (lab §3.4, F6). If
/// several requests fail with 401 together, only the first one refreshes;
/// the others wait in the queue, see that the stored token changed, and
/// replay with it. This matters doubly for EventPass: the API treats a
/// refresh token presented twice as theft and revokes the whole session
/// (docs/authentication.md).
class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor({
    required this._tokenStorage,
    required this._plainDio,
    required this._onSessionExpired,
  });

  final TokenStorage _tokenStorage;

  /// A Dio WITHOUT this interceptor, used to refresh and to replay.
  /// Using the main Dio here would re-enter the queue and deadlock.
  final Dio _plainDio;

  final void Function() _onSessionExpired;

  static const _publicPaths = [
    '/auth/login',
    '/auth/register',
    '/auth/refresh',
  ];

  bool _isPublic(RequestOptions options) =>
      _publicPaths.any(options.path.endsWith);

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    if (!_isPublic(options)) {
      final token = await _tokenStorage.readAccessToken();
      if (token != null) options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final request = err.requestOptions;
    if (err.response?.statusCode != 401 || _isPublic(request)) {
      return handler.next(err);
    }

    try {
      // Another request may have refreshed while this one was queued.
      final sentHeader = request.headers['Authorization'];
      var token = await _tokenStorage.readAccessToken();
      if (token == null || sentHeader == 'Bearer $token') {
        final refreshed = await _refreshTokens();
        if (refreshed == null) {
          // EventPass: no refresh token on the device -> the session is over
          // (the lab would have posted `null` and received a 422).
          await _endSession();
          return handler.next(err);
        }
        token = refreshed;
      }

      // Replay the original request with the fresh token.
      request.headers['Authorization'] = 'Bearer $token';
      final response = await _plainDio.fetch<dynamic>(request);
      return handler.resolve(response);
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        // The refresh token is invalid too: the session is over.
        await _endSession();
      }
      return handler.next(e);
    }
  }

  Future<void> _endSession() async {
    await _tokenStorage.clear();
    _onSessionExpired();
  }

  /// Returns the new access token, or null when there is no refresh token.
  Future<String?> _refreshTokens() async {
    final refreshToken = await _tokenStorage.readRefreshToken();
    if (refreshToken == null) return null;
    final response = await _plainDio.post<Map<String, dynamic>>(
      '/auth/refresh',
      data: {'refreshToken': refreshToken},
    );
    final data = response.data!['data'] as Map<String, dynamic>;
    final accessToken = data['accessToken'] as String;
    await _tokenStorage.save(
      accessToken: accessToken,
      refreshToken: data['refreshToken'] as String,
    );
    return accessToken;
  }
}
