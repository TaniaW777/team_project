import 'package:bloc_test/bloc_test.dart';
import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/features/check_in/domain/entities/pending_check_in.dart';
import 'package:eventpass/features/check_in/presentation/bloc/check_in_bloc.dart';
import 'package:eventpass/features/check_in/presentation/pages/check_in_scan_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'check_in_fixtures.dart';

class MockCheckInBloc extends MockBloc<CheckInEvent, CheckInState>
    implements CheckInBloc {}

void main() {
  late MockCheckInBloc bloc;

  setUp(() => bloc = MockCheckInBloc());

  Future<void> pump(WidgetTester tester, CheckInState state) async {
    when(() => bloc.state).thenReturn(state);
    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<CheckInBloc>.value(
          value: bloc,
          // A platform camera is unavailable in widget tests: the manual
          // token field keeps the page fully testable.
          child: const CheckInScanPage(enableCamera: false),
        ),
      ),
    );
  }

  testWidgets('loading with no scans: a spinner', (tester) async {
    await pump(tester, const CheckInState(status: CheckInStatus.loading));

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('failure with no scans: message and Retry', (tester) async {
    await pump(
      tester,
      const CheckInState(
        status: CheckInStatus.failure,
        failure: NetworkFailure('Cannot reach the server.'),
      ),
    );

    expect(find.text('Cannot reach the server.'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    verify(() => bloc.add(const CheckInRetried())).called(1);
  });

  testWidgets('empty outbox: an explicit empty view', (tester) async {
    await pump(tester, const CheckInState(status: CheckInStatus.success));

    expect(find.text('No scans yet'), findsOneWidget);
  });

  testWidgets('a conflicted scan shows its status, reason and time', (
    tester,
  ) async {
    await pump(
      tester,
      CheckInState(
        status: CheckInStatus.success,
        items: [
          pendingScan(
            status: CheckInSyncStatus.conflict,
            reason: 'ALREADY_CHECKED_IN',
            checkedIn: checkedInAt,
          ),
        ],
      ),
    );

    expect(find.text('Already used'), findsOneWidget);
    expect(find.textContaining('ALREADY_CHECKED_IN'), findsOneWidget);
    expect(find.textContaining('event-1'), findsOneWidget);
  });

  testWidgets('manual token entry adds a CheckInQrCaptured event', (
    tester,
  ) async {
    await pump(tester, const CheckInState(status: CheckInStatus.success));

    await tester.enterText(
      find.byKey(const Key('checkInEventIdField')),
      'event-42',
    );
    await tester.enterText(
      find.byKey(const Key('checkInTokenField')),
      'manual-token',
    );
    await tester.tap(find.text('Check in'));

    verify(
      () => bloc.add(
        const CheckInQrCaptured(qrToken: 'manual-token', eventId: 'event-42'),
      ),
    ).called(1);
  });

  testWidgets('the sync button adds CheckInSyncRequested', (tester) async {
    await pump(tester, const CheckInState(status: CheckInStatus.success));

    await tester.tap(find.text('Synchroniser'));

    verify(() => bloc.add(const CheckInSyncRequested())).called(1);
  });
}
