import '../../../../core/network/error_mapper.dart';
import '../../../../core/pagination/paginated.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/campus_event.dart';
import '../../domain/repositories/events_repository.dart';
import '../datasources/events_local_data_source.dart';
import '../datasources/events_remote_data_source.dart';
import '../models/campus_event_model.dart';

/// Coordinates the API and the device cache; exceptions become failures
/// once, here, at the data border (F3).
class EventsRepositoryImpl implements EventsRepository {
  EventsRepositoryImpl({
    required this._remote,
    required this._local,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final EventsRemoteDataSource _remote;
  final EventsLocalDataSource _local;
  final DateTime Function() _now;

  @override
  Future<Result<Paginated<CampusEvent>>> getEvents({
    required int page,
    String query = '',
    bool upcomingOnly = false,
    String? clubId,
  }) {
    return guard<Paginated<CampusEvent>>(() async {
      final result = await _remote.fetchEvents(
        page: page,
        query: query,
        upcomingOnly: upcomingOnly,
        clubId: clubId,
      );
      // Only the default list is cached: it is what the app shows at start.
      if (page == 1 && query.isEmpty && !upcomingOnly && clubId == null) {
        await _saveCache(result.items);
      }
      return result;
    });
  }

  @override
  Future<CachedEvents?> getCachedEvents() async {
    try {
      final cached = await _local.read();
      if (cached == null) return null;
      return (events: cached.events, savedAt: cached.savedAt);
    } catch (_) {
      return null; // corrupt or unreadable cache: behave as if there was none
    }
  }

  /// Best effort: a cache that cannot be written must not turn a successful
  /// network answer into an error.
  Future<void> _saveCache(List<CampusEventModel> events) async {
    try {
      await _local.save(events, _now());
    } catch (_) {}
  }
}
