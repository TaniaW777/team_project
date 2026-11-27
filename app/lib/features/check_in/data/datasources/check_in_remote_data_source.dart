import 'package:dio/dio.dart';

import '../../domain/entities/check_in_result.dart';
import '../models/check_in_result_model.dart';
import '../models/pending_check_in_model.dart';

/// Offline pre-check bundle (stale by definition): public key + ticket ids
/// and statuses, no names or e-mails (tickets-contract.md §4 and §7).
typedef CheckInBundle = ({
  String publicKey,
  DateTime generatedAt,
  Map<String, String> ticketStatuses,
});

/// Talks to the Member 4 check-in endpoints. Throws [DioException] on
/// failure; mapping it to a domain [Failure] is the repository's job (F3).
class CheckInRemoteDataSource {
  const CheckInRemoteDataSource(this._dio);

  /// The API caps a sync batch at 100 items (§6).
  static const batchSize = 100;

  final Dio _dio;

  /// Immediate scan while online. The same key is sent on every retry.
  Future<CheckInResultModel> checkInOnline({
    required String eventId,
    required String qrToken,
    required String idempotencyKey,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/events/${Uri.encodeComponent(eventId)}/check-ins',
      data: {'qrToken': qrToken, 'idempotencyKey': idempotencyKey},
    );
    final data = _data(response.data);
    final parsed = data is Map<String, dynamic>
        ? CheckInResultModel.fromJson(data)
        : const CheckInResultModel(
            idempotencyKey: '',
            outcome: CheckInOutcome.retry,
          );
    // The immediate endpoint does not echo the key: put back the one we sent
    // so the repository can always match the answer to its outbox entry.
    return CheckInResultModel(
      idempotencyKey: idempotencyKey,
      outcome: parsed.outcome,
      reason: parsed.reason,
      checkedInAt: parsed.checkedInAt,
    );
  }

  /// Sends at most [batchSize] pending scans. The caller slices the outbox.
  Future<List<CheckInResultModel>> syncBatch(
    List<PendingCheckInModel> items,
  ) async {
    if (items.isEmpty) return const <CheckInResultModel>[];
    if (items.length > batchSize) {
      throw ArgumentError.value(items.length, 'items', 'batch too large');
    }
    final response = await _dio.post<Map<String, dynamic>>(
      '/check-ins/sync',
      data: {
        'items': [
          for (final item in items)
            {
              'idempotencyKey': item.idempotencyKey,
              'qrToken': item.qrToken,
              'eventId': item.eventId,
              // Audit only: the server never orders check-ins by this value.
              'scannedAt': item.scannedAt.toUtc().toIso8601String(),
            },
        ],
      },
    );
    final data = _data(response.data);
    if (data is! List) return const <CheckInResultModel>[];
    return [
      for (final item in data)
        if (item is Map<String, dynamic>) CheckInResultModel.fromJson(item),
    ];
  }

  /// Optional offline pre-check. The server remains the only judge: a
  /// ticket cancelled after download is still rejected at sync time.
  Future<CheckInBundle> fetchBundle(String eventId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/events/${Uri.encodeComponent(eventId)}/check-in-bundle',
    );
    final data = _data(response.data);
    if (data is! Map<String, dynamic>) {
      throw const FormatException('Invalid check-in bundle');
    }
    final statuses = <String, String>{};
    final tickets = data['tickets'];
    if (tickets is List) {
      for (final ticket in tickets) {
        if (ticket is Map<String, dynamic> && ticket['id'] is String) {
          statuses[ticket['id'] as String] =
              (ticket['status'] as String?) ?? 'unknown';
        }
      }
    }
    return (
      publicKey: data['publicKey'] as String? ?? '',
      generatedAt: data['generatedAt'] is String
          ? DateTime.parse(data['generatedAt'] as String).toUtc()
          : DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      ticketStatuses: statuses,
    );
  }

  Object? _data(Object? body) =>
      body is Map<String, dynamic> ? body['data'] : null;
}
