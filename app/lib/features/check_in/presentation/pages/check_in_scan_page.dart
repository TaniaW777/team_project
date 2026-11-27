import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../../core/widgets/state_views.dart';
import '../../domain/entities/pending_check_in.dart';
import '../bloc/check_in_bloc.dart';
import '../widgets/check_in_status_chip.dart';

/// Door staff screen: scan a QR (camera) or paste a token (tests / broken
/// camera), then synchronise the durable outbox. No business logic here:
/// the page only reports user actions and draws the bloc state (F2/F7).
class CheckInScanPage extends StatefulWidget {
  const CheckInScanPage({super.key, this.enableCamera = true});

  /// Set to false in widget tests and on devices without a camera; the
  /// manual token field remains available.
  final bool enableCamera;

  @override
  State<CheckInScanPage> createState() => _CheckInScanPageState();
}

class _CheckInScanPageState extends State<CheckInScanPage> {
  final _eventId = TextEditingController();
  final _token = TextEditingController();

  @override
  void dispose() {
    _eventId.dispose();
    _token.dispose();
    super.dispose();
  }

  void _submitManual() {
    final token = _token.text.trim();
    final eventId = _eventId.text.trim();
    if (token.isEmpty || eventId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter an event id and a QR token.')),
      );
      return;
    }
    context.read<CheckInBloc>().add(
      CheckInQrCaptured(qrToken: token, eventId: eventId),
    );
    _token.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Check-in')),
      body: BlocConsumer<CheckInBloc, CheckInState>(
        listenWhen: (previous, current) =>
            current.failure != null && current.failure != previous.failure,
        listener: (context, state) {
          ScaffoldMessenger.of(context)
            ..hideCurrentSnackBar()
            ..showSnackBar(SnackBar(content: Text(state.failure!.message)));
        },
        builder: (context, state) => SafeArea(
          child: Column(
            children: [
              if (widget.enableCamera)
                SizedBox(
                  height: 240,
                  child: MobileScanner(
                    onDetect: (capture) {
                      final value = capture.barcodes.isEmpty
                          ? null
                          : capture.barcodes.first.rawValue;
                      final eventId = _eventId.text.trim();
                      if (value == null || value.isEmpty || eventId.isEmpty) {
                        return;
                      }
                      context.read<CheckInBloc>().add(
                        CheckInQrCaptured(qrToken: value, eventId: eventId),
                      );
                    },
                  ),
                ),
              _ManualEntry(
                eventController: _eventId,
                tokenController: _token,
                submit: _submitManual,
              ),
              _SyncBar(state: state),
              Expanded(child: _Outbox(state: state)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ManualEntry extends StatelessWidget {
  const _ManualEntry({
    required this.eventController,
    required this.tokenController,
    required this.submit,
  });

  final TextEditingController eventController;
  final TextEditingController tokenController;
  final VoidCallback submit;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Column(
        children: [
          TextField(
            key: const Key('checkInEventIdField'),
            controller: eventController,
            decoration: const InputDecoration(
              labelText: 'Event ID',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('checkInTokenField'),
            controller: tokenController,
            decoration: const InputDecoration(
              labelText: 'QR token',
              border: OutlineInputBorder(),
            ),
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => submit(),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: submit,
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('Check in'),
            ),
          ),
        ],
      ),
    );
  }
}

class _SyncBar extends StatelessWidget {
  const _SyncBar({required this.state});

  final CheckInState state;

  @override
  Widget build(BuildContext context) {
    final pending = state.pendingCount;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Text(
            pending == 1 ? '1 scan to sync' : '$pending scans to sync',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const Spacer(),
          OutlinedButton.icon(
            onPressed: state.isSyncing
                ? null
                : () => context.read<CheckInBloc>().add(
                    const CheckInSyncRequested(),
                  ),
            icon: state.isSyncing
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.sync),
            label: const Text('Synchroniser'),
          ),
        ],
      ),
    );
  }
}

class _Outbox extends StatelessWidget {
  const _Outbox({required this.state});

  final CheckInState state;

  @override
  Widget build(BuildContext context) {
    if (state.status == CheckInStatus.initial ||
        (state.status == CheckInStatus.loading && state.items.isEmpty)) {
      return const LoadingView();
    }
    if (state.status == CheckInStatus.failure && state.items.isEmpty) {
      return ErrorView(
        message: state.failure?.message ?? 'Could not load check-ins.',
        onRetry: () => context.read<CheckInBloc>().add(const CheckInRetried()),
      );
    }
    if (state.items.isEmpty) {
      return const EmptyView(
        icon: Icons.qr_code_2,
        title: 'No scans yet',
        message: 'Scan a QR code or enter a token manually.',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      itemCount: state.items.length,
      separatorBuilder: (_, _) => const SizedBox(height: 4),
      itemBuilder: (context, index) => _OutboxTile(item: state.items[index]),
    );
  }
}

class _OutboxTile extends StatelessWidget {
  const _OutboxTile({required this.item});

  final PendingCheckIn item;

  @override
  Widget build(BuildContext context) {
    final key = item.idempotencyKey.length > 8
        ? item.idempotencyKey.substring(0, 8)
        : item.idempotencyKey;
    final localizations = MaterialLocalizations.of(context);
    final scanned = localizations.formatTimeOfDay(
      TimeOfDay.fromDateTime(item.scannedAt.toLocal()),
    );
    final checkedIn = item.checkedInAt == null
        ? ''
        : ' · checked in ${localizations.formatTimeOfDay(TimeOfDay.fromDateTime(item.checkedInAt!.toLocal()))}';
    final reason = item.reason == null ? '' : ' · ${item.reason}';
    return Card(
      child: ListTile(
        leading: const Icon(Icons.qr_code_2),
        title: Text('${item.eventId} · $key'),
        subtitle: Text('Scanned $scanned$checkedIn$reason'),
        trailing: CheckInStatusChip(status: item.status),
      ),
    );
  }
}
