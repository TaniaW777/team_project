import 'package:bloc_test/bloc_test.dart';
import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/features/auth/presentation/bloc/auth_bloc.dart';
import 'package:eventpass/features/events/presentation/bloc/events_bloc.dart';
import 'package:eventpass/features/events/presentation/pages/events_list_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'events_fixtures.dart';

class MockEventsBloc extends MockBloc<EventsEvent, EventsState>
    implements EventsBloc {}

class MockAuthBloc extends MockBloc<AuthEvent, AuthState> implements AuthBloc {}

// Widget tests: the page draws the four states of F7 (and the offline banner
// of F9) from the bloc state, and turns taps into bloc events.
void main() {
  late MockEventsBloc bloc;

  setUp(() => bloc = MockEventsBloc());

  Future<void> pump(WidgetTester tester, EventsState state) async {
    when(() => bloc.state).thenReturn(state);
    await tester.pumpWidget(
      MaterialApp(
        home: MultiBlocProvider(
          providers: [
            BlocProvider<AuthBloc>(create: (_) => MockAuthBloc()),
            BlocProvider<EventsBloc>.value(value: bloc),
          ],
          child: const EventsListPage(),
        ),
      ),
    );
  }

  testWidgets('loading with nothing to show: a spinner', (tester) async {
    await pump(tester, const EventsState(status: EventsStatus.loading));

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('error: the message and a Retry button that reloads', (
    tester,
  ) async {
    await pump(
      tester,
      const EventsState(
        status: EventsStatus.failure,
        failure: NetworkFailure('Cannot reach the server.'),
      ),
    );

    expect(find.text('Cannot reach the server.'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    verify(() => bloc.add(const EventsRefreshed())).called(1);
  });

  testWidgets('empty: a message instead of a blank screen', (tester) async {
    await pump(tester, const EventsState(status: EventsStatus.success));

    expect(find.text('No events yet'), findsOneWidget);
  });

  testWidgets('empty search: says what was searched', (tester) async {
    await pump(
      tester,
      const EventsState(status: EventsStatus.success, query: 'jazz'),
    );

    expect(find.text('No events match "jazz"'), findsOneWidget);
  });

  testWidgets('content: one card per event with its places', (tester) async {
    await pump(
      tester,
      EventsState(
        status: EventsStatus.success,
        events: [
          testEvent('a', title: 'Jazz night', seatsLeft: 3),
          testEvent('b', title: 'Open mic', seatsLeft: 0),
          testEvent('c', title: 'Career fair', seatsLeft: null),
        ],
      ),
    );

    expect(find.text('Jazz night'), findsOneWidget);
    expect(find.text('3 places left'), findsOneWidget);
    expect(find.text('Full · waiting list'), findsOneWidget);
    expect(find.text('Open'), findsOneWidget);
  });

  testWidgets('offline start: the cached list with an offline banner', (
    tester,
  ) async {
    await pump(
      tester,
      EventsState(
        status: EventsStatus.success,
        events: [testEvent('a', title: 'Jazz night')],
        cachedAt: DateTime(2026, 11, 25, 9, 30),
        failure: const NetworkFailure(),
      ),
    );

    expect(find.text('Jazz night'), findsOneWidget);
    expect(find.textContaining('Offline.'), findsOneWidget);
  });

  testWidgets('typing in the search box sends EventsSearchChanged', (
    tester,
  ) async {
    await pump(tester, const EventsState(status: EventsStatus.success));

    await tester.enterText(find.byType(TextField), 'music');
    verify(() => bloc.add(const EventsSearchChanged('music'))).called(1);
  });
}
