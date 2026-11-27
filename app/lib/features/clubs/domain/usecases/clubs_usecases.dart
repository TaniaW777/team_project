import '../../../../core/pagination/paginated.dart';
import '../../../../core/result/result.dart';
import '../entities/club.dart';
import '../repositories/clubs_repository.dart';

class GetMyClubs {
  const GetMyClubs(this._repository);

  final ClubsRepository _repository;

  Future<Result<Paginated<Club>>> call({int page = 1}) =>
      _repository.getMyClubs(page: page);
}

class GetClub {
  const GetClub(this._repository);

  final ClubsRepository _repository;

  Future<Result<Club>> call(String clubId) => _repository.getClub(clubId);
}
