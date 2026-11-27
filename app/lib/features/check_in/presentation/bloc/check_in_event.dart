part of 'check_in_bloc.dart';

/// What can happen on the check-in screen.
sealed class CheckInEvent extends Equatable {
  const CheckInEvent();

  @override
  List<Object?> get props => [];
}

/// The screen opens: subscribe to the durable outbox.
final class CheckInStarted extends CheckInEvent {
  const CheckInStarted();
}

/// A QR code was read (camera or manual field). The bloc creates exactly one
/// UUID v4 key for this scan; a duplicate event is dropped.
final class CheckInQrCaptured extends CheckInEvent {
  const CheckInQrCaptured({required this.qrToken, required this.eventId});

  final String qrToken;
  final String eventId;

  @override
  List<Object?> get props => [qrToken, eventId];
}

/// The "Synchroniser" button: send all pending scans.
final class CheckInSyncRequested extends CheckInEvent {
  const CheckInSyncRequested();
}

/// The "Retry" button of the error view: same operation as a sync.
final class CheckInRetried extends CheckInEvent {
  const CheckInRetried();
}
