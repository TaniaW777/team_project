import 'package:dio/dio.dart';

import '../../../../core/pagination/paginated.dart';
import '../models/club_model.dart';

/// Talks to the `/clubs` endpoints (Member 1's module, read only here).
class ClubsRemoteDataSource {
  const ClubsRemoteDataSource(this._dio);

  static const pageSize = 50;

  final Dio _dio;

  Future<Paginated<ClubModel>> fetchMyClubs({required int page}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/clubs',
      queryParameters: {'mine': 'true', 'page': page, 'limit': pageSize},
    );
    final body = response.data!;
    final meta = body['meta'] as Map<String, dynamic>;
    return Paginated(
      items: [
        for (final item in body['data'] as List<dynamic>)
          ClubModel.fromJson(item as Map<String, dynamic>),
      ],
      page: meta['page'] as int,
      totalPages: meta['totalPages'] as int,
      total: meta['total'] as int,
    );
  }

  Future<ClubModel> fetchClub(String clubId) async {
    final response = await _dio.get<Map<String, dynamic>>('/clubs/$clubId');
    return ClubModel.fromJson(response.data!['data'] as Map<String, dynamic>);
  }
}
