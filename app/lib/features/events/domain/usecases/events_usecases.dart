import '../../../../core/pagination/paginated.dart';
import '../../../../core/result/result.dart';
import '../entities/campus_event.dart';
import '../repositories/events_repository.dart';

// One class = one thing the user can do (lab §3.5).

class GetEvents {
  const GetEvents(this._repository);

  final EventsRepository _repository;

  Future<Result<Paginated<CampusEvent>>> call({
    required int page,
    String query = '',
    bool upcomingOnly = false,
  }) {
    return _repository.getEvents(
      page: page,
      query: query.trim(),
      upcomingOnly: upcomingOnly,
    );
  }
}

class GetCachedEvents {
  const GetCachedEvents(this._repository);

  final EventsRepository _repository;

  Future<CachedEvents?> call() => _repository.getCachedEvents();
}
