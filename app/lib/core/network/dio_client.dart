import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../storage/token_storage.dart';
import 'auth_interceptor.dart';

Dio _baseDio(String baseUrl) => Dio(
  BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 15),
    headers: {'Accept': 'application/json'},
  ),
);

/// Builds the single Dio instance used by every data source (lab §3.4).
Dio createDio({
  required String baseUrl,
  required TokenStorage tokenStorage,
  required void Function() onSessionExpired,
}) {
  final dio = _baseDio(baseUrl);
  dio.interceptors.add(
    AuthInterceptor(
      tokenStorage: tokenStorage,
      plainDio: _baseDio(baseUrl),
      onSessionExpired: onSessionExpired,
    ),
  );
  if (kDebugMode) {
    // One line per request/response while developing; headers (tokens) and
    // bodies (passwords) are not printed.
    dio.interceptors.add(
      LogInterceptor(
        requestHeader: false,
        requestBody: false,
        responseBody: false,
      ),
    );
  }
  return dio;
}
