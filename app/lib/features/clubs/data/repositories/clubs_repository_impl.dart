import '../../../../core/network/error_mapper.dart';
import '../../../../core/pagination/paginated.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/club.dart';
import '../../domain/repositories/clubs_repository.dart';
import '../datasources/clubs_remote_data_source.dart';

class ClubsRepositoryImpl implements ClubsRepository {
  const ClubsRepositoryImpl(this._remote);

  final ClubsRemoteDataSource _remote;

  @override
  Future<Result<Paginated<Club>>> getMyClubs({required int page}) =>
      guard<Paginated<Club>>(() => _remote.fetchMyClubs(page: page));

  @override
  Future<Result<Club>> getClub(String clubId) =>
      guard<Club>(() => _remote.fetchClub(clubId));
}
