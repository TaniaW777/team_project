import 'package:dio/dio.dart';

import '../../../../core/pagination/paginated.dart';
import '../models/campus_event_model.dart';

/// Talks to `GET /events`. Throws DioException on failure; turning
/// exceptions into Failures is the repository's job (lab §3.6).
class EventsRemoteDataSource {
  const EventsRemoteDataSource(this._dio, {DateTime Function()? now})
    : _now = now ?? DateTime.now;

  /// Events per page. The API caps `limit` at 100 (A9).
  static const pageSize = 20;

  final Dio _dio;
  final DateTime Function() _now;

  Future<Paginated<CampusEventModel>> fetchEvents({
    required int page,
    String query = '',
    bool upcomingOnly = false,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/events',
      queryParameters: {
        'page': page,
        'limit': pageSize,
        if (query.isNotEmpty) 'q': query,
        // `from`: events starting at or after this instant (listEventsSchema).
        if (upcomingOnly) 'from': _now().toUtc().toIso8601String(),
      },
    );
    final body = response.data!;
    final meta = body['meta'] as Map<String, dynamic>;
    return Paginated(
      items: [
        for (final item in body['data'] as List<dynamic>)
          CampusEventModel.fromJson(item as Map<String, dynamic>),
      ],
      page: meta['page'] as int,
      totalPages: meta['totalPages'] as int,
      total: meta['total'] as int,
    );
  }
}
