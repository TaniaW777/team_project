import 'dart:async';
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../domain/entities/pending_check_in.dart';
import '../models/pending_check_in_model.dart';

/// Durable offline outbox for QR scans (docs/tickets-contract.md §7).
///
/// Every read and every write goes through one serialized queue: a scan
/// arriving during a sync cannot be lost or overwritten. Enqueue is also
/// idempotent by `idempotencyKey` — the same scan is never stored twice.
class CheckInLocalDataSource {
  /// Versioned key: an incompatible old outbox is ignored instead of
  /// crashing the parser.
  static const key = 'checkin.outbox.v1';

  CheckInLocalDataSource(this._prefs) {
    _controller = StreamController<List<PendingCheckInModel>>.broadcast(
      onListen: () => _publish(),
    );
  }

  final SharedPreferencesAsync _prefs;

  Future<void>? _tail;

  late final StreamController<List<PendingCheckInModel>> _controller;

  /// Chains [action] after all previous operations. The chaining future never
  /// completes with an error, so one failed write does not poison the queue.
  Future<T> _serialized<T>(Future<T> Function() action) {
    final previous = _tail ?? Future<void>.value();
    final done = Completer<void>();
    _tail = done.future;
    return previous.then((_) async {
      try {
        return await action();
      } finally {
        if (!done.isCompleted) done.complete();
      }
    });
  }

  Future<List<PendingCheckInModel>> readAll() => _serialized(_readAll);

  Future<List<PendingCheckInModel>> _readAll() async {
    final raw = await _prefs.getString(key);
    if (raw == null) return <PendingCheckInModel>[];
    try {
      final json = jsonDecode(raw);
      if (json is! Map<String, dynamic> ||
          json['version'] != PendingCheckInModel.formatVersion ||
          json['items'] is! List) {
        return <PendingCheckInModel>[];
      }
      final items = <PendingCheckInModel>[];
      for (final item in json['items'] as List<dynamic>) {
        if (item is! Map<String, dynamic>) continue;
        try {
          items.add(PendingCheckInModel.fromJson(item));
        } catch (_) {
          // One corrupt entry must not hide the rest of the outbox.
        }
      }
      items.sort(_byScannedAt);
      return items;
    } catch (_) {
      return <PendingCheckInModel>[];
    }
  }

  Future<void> _writeAll(List<PendingCheckInModel> items) {
    return _prefs.setString(
      key,
      jsonEncode({
        'version': PendingCheckInModel.formatVersion,
        'items': [for (final item in items) item.toJson()],
      }),
    );
  }

  /// Adds a scan unless its idempotency key is already in the outbox.
  Future<void> enqueue(PendingCheckInModel item) async {
    await _serialized(() async {
      final items = await _readAll();
      if (items.any((e) => e.idempotencyKey == item.idempotencyKey)) return;
      items.add(item);
      items.sort(_byScannedAt);
      await _writeAll(items);
    });
    _publish();
  }

  /// Replaces the known entries with the resolved versions. Entries added
  /// meanwhile are kept, and unknown keys are never introduced here.
  Future<void> updateAll(Iterable<PendingCheckInModel> updates) async {
    await _serialized(() async {
      final items = await _readAll();
      final known = {for (final item in items) item.idempotencyKey};
      final resolved = updates.where((u) => known.contains(u.idempotencyKey));
      final keys = {for (final item in resolved) item.idempotencyKey};
      final merged = <PendingCheckInModel>[
        ...items.where((item) => !keys.contains(item.idempotencyKey)),
        ...resolved,
      ];
      merged.sort(_byScannedAt);
      await _writeAll(merged);
    });
    _publish();
  }

  /// Keeps conflicts and rejections for audit, drops only the synced scans.
  Future<void> clearSynced() async {
    await _serialized(() async {
      final items = await _readAll();
      final kept = items
          .where((item) => item.status != CheckInSyncStatus.synced)
          .toList();
      if (kept.length != items.length) await _writeAll(kept);
    });
    _publish();
  }

  /// Current outbox on listen, then a new snapshot after each local change.
  Stream<List<PendingCheckInModel>> watch() => _controller.stream;

  void _publish() {
    if (_controller.isClosed || !_controller.hasListener) return;
    readAll().then((items) {
      if (!_controller.isClosed && _controller.hasListener) {
        _controller.add(items);
      }
    }, onError: (_) {});
  }

  Future<void> dispose() => _controller.close();

  int _byScannedAt(PendingCheckInModel a, PendingCheckInModel b) {
    final byTime = a.scannedAt.compareTo(b.scannedAt);
    // Deterministic order when two scans have the same device timestamp.
    return byTime != 0 ? byTime : a.idempotencyKey.compareTo(b.idempotencyKey);
  }
}
