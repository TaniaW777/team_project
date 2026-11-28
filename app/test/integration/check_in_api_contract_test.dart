import 'package:dio/dio.dart';
import 'package:eventpass/core/network/auth_interceptor.dart';
import 'package:eventpass/core/result/result.dart';
import 'package:eventpass/features/auth/data/datasources/auth_remote_data_source.dart';
import 'package:eventpass/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:eventpass/features/events/data/datasources/events_remote_data_source.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uuid/uuid.dart';

import '../helpers/memory_token_storage.dart';

// App <-> API CONTRACT TEST for Member 4 endpoints, using the real Dio stack
// against a running API on a TEST database. Skipped unless a URL is given:
//   flutter test test/integration --dart-define=INTEGRATION_API_URL=http://127.0.0.1:3001/api/v1
// It registers a plain attendee: check-in is staff-only, so the expected
// outcome is either the 403 error envelope or the per-item `rejected` result.
const apiUrl = String.fromEnvironment('INTEGRATION_API_URL');

void main() {
  final skip = apiUrl.isEmpty ? 'set INTEGRATION_API_URL to run' : false;

  test(
    'check-in endpoints: error envelope / per-item result parsed by the app',
    () async {
      final storage = MemoryTokenStorage();
      Dio make() => Dio(BaseOptions(baseUrl: apiUrl));
      final dio = make()
        ..interceptors.add(
          AuthInterceptor(
            tokenStorage: storage,
            plainDio: make(),
            onSessionExpired: () {},
          ),
        );
      final auth = AuthRepositoryImpl(
        remote: AuthRemoteDataSource(dio),
        tokenStorage: storage,
      );
      final signedIn = await auth.register(
        name: 'Check-in Contract',
        email: 'checkin-${DateTime.now().microsecondsSinceEpoch}@example.com',
        password: 'correct-horse-9',
      );
      expect(signedIn, isA<Ok<dynamic>>());

      final events = EventsRemoteDataSource(dio);
      final page = await events.fetchEvents(page: 1);
      if (page.items.isEmpty) return; // no event: nothing to scan

      final key = const Uuid().v4();
      final online = await dio.post<Map<String, dynamic>>(
        '/events/${page.items.first.id}/check-ins',
        data: {'qrToken': 'not-a-signed-token', 'idempotencyKey': key},
      );
      // A signed-out-of-club attendee gets 403; an invalid QR gets 422. Both
      // must use the documented { error: { code, message } } envelope.
      expect([403, 422], contains(online.statusCode));
      final error = online.data?['error'];
      expect(error, isA<Map<String, dynamic>>());
      expect((error as Map<String, dynamic>)['code'], isA<String>());

      final sync = await dio.post<Map<String, dynamic>>(
        '/check-ins/sync',
        data: {
          'items': [
            {
              'idempotencyKey': key,
              'qrToken': 'not-a-signed-token',
              'eventId': page.items.first.id,
              'scannedAt': DateTime.now().toUtc().toIso8601String(),
            },
          ],
        },
      );
      // Either forbidden at batch level, or a 200 with a per-item result.
      expect([200, 403], contains(sync.statusCode));
      final data = sync.data?['data'];
      if (sync.statusCode == 200) {
        expect(data, isA<List<dynamic>>());
        final item = (data as List<dynamic>).single as Map<String, dynamic>;
        expect(item['idempotencyKey'], key);
        expect([
          'accepted',
          'duplicate',
          'already_checked_in',
          'rejected',
          'retry',
        ], contains(item['result']));
      }
    },
    skip: skip,
  );
}
