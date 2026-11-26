/// Compile-time configuration (lab §3.3).
///
/// EventPass (F13): the API URL comes ONLY from `--dart-define`; there is no
/// URL in the source code. Launch for example:
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
/// (10.0.2.2 = the host machine from the Android emulator; use
/// http://localhost:3000/api/v1 on Chrome / iOS simulator, the computer's
/// Wi-Fi IP on a real phone, the HTTPS URL of the deployed API for a release).
abstract final class AppConfig {
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL');

  /// False when the app was started without `--dart-define=API_BASE_URL=...`.
  static bool get isConfigured => apiBaseUrl.isNotEmpty;
}
