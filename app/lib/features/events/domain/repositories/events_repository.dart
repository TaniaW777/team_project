import '../../../../core/pagination/paginated.dart';
import '../../../../core/result/result.dart';
import '../entities/campus_event.dart';

/// The last events list saved on the device, and when it was saved (F9).
typedef CachedEvents = ({List<CampusEvent> events, DateTime savedAt});

/// What the app needs from "events", without saying HOW (F3).
abstract interface class EventsRepository {
  /// One page of published events, optionally filtered by a text [query]
  /// and to events that have not started yet ([upcomingOnly]).
  ///
  /// The first page of the unfiltered list is also saved on the device, so
  /// it can be shown the next time the app starts without network (F9).
  Future<Result<Paginated<CampusEvent>>> getEvents({
    required int page,
    String query = '',
    bool upcomingOnly = false,
  });

  /// The list saved by [getEvents], or `null` if there is none (or it is
  /// unreadable). Never fails: a missing cache is not an error.
  Future<CachedEvents?> getCachedEvents();
}
