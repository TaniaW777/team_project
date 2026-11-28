import '../../../../core/pagination/paginated.dart';
import '../../../../core/result/result.dart';
import '../entities/club.dart';

abstract interface class ClubsRepository {
  /// The clubs where the signed-in user has a role (organizer or staff).
  Future<Result<Paginated<Club>>> getMyClubs({required int page});

  /// One club, with the caller's role in it.
  Future<Result<Club>> getClub(String clubId);
}
