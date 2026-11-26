import 'package:dio/dio.dart';
import 'package:eventpass/core/network/auth_interceptor.dart';
import 'package:eventpass/core/result/result.dart';
import 'package:eventpass/features/auth/data/datasources/auth_remote_data_source.dart';
import 'package:eventpass/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:eventpass/features/events/data/datasources/events_remote_data_source.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/memory_token_storage.dart';

// App <-> API CONTRACT TEST for the events list: the real Dio stack and
// EventsRemoteDataSource against a REAL running EventPass API. Proves that
// the JSON of GET /events (data + meta) is parsed as the app expects.
// Skipped unless an API URL is given (same switch as auth_api_contract_test):
//   flutter test test/integration --dart-define=INTEGRATION_API_URL=http://127.0.0.1:3001/api/v1
// It registers one user. With an empty database it checks the empty page;
// with events (e.g. demo data) it also checks paging and search.
const apiUrl = String.fromEnvironment('INTEGRATION_API_URL');

void main() {
  final skip = apiUrl.isEmpty ? 'set INTEGRATION_API_URL to run' : false;

  test(
    'GET /events: pages, meta and search parsed from the real API',
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
        name: 'Events Contract',
        email: 'events-${DateTime.now().microsecondsSinceEpoch}@example.com',
        password: 'correct-horse-9',
      );
      expect(signedIn, isA<Ok<dynamic>>());

      final remote = EventsRemoteDataSource(dio);
      final first = await remote.fetchEvents(page: 1);

      expect(first.page, 1);
      expect(
        first.items.length,
        lessThanOrEqualTo(EventsRemoteDataSource.pageSize),
      );
      expect(first.total, greaterThanOrEqualTo(first.items.length));
      if (first.items.isEmpty) return; // empty database: nothing more to check

      // Published events, sorted by start date (listEvents in the API).
      expect(first.items.every((e) => e.status == 'published'), isTrue);
      for (var i = 1; i < first.items.length; i++) {
        expect(
          first.items[i].startsAt.isBefore(first.items[i - 1].startsAt),
          isFalse,
        );
      }

      if (first.hasMore) {
        final second = await remote.fetchEvents(page: 2);
        final firstIds = {for (final e in first.items) e.id};
        expect(second.items.any((e) => firstIds.contains(e.id)), isFalse);
      }

      final title = first.items.first.title;
      final found = await remote.fetchEvents(page: 1, query: title);
      expect(found.items.map((e) => e.title), contains(title));

      final upcoming = await remote.fetchEvents(page: 1, upcomingOnly: true);
      final now = DateTime.now();
      expect(upcoming.items.every((e) => !e.startsAt.isBefore(now)), isTrue);
    },
    skip: skip,
  );
}
