import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/campus_event_model.dart';

/// Saves the first page of the events list on the device (F9: the last data
/// is visible when the app starts offline).
///
/// Events are public to every signed-in user and contain no personal data,
/// so `shared_preferences` is enough (tokens, which are secret, stay in
/// secure storage).
class EventsLocalDataSource {
  const EventsLocalDataSource(this._prefs);

  /// Bump the version when the cached JSON shape changes: an old cache is
  /// then simply ignored instead of crashing the parser.
  static const _key = 'events.firstPage.v1';

  final SharedPreferencesAsync _prefs;

  Future<void> save(List<CampusEventModel> events, DateTime savedAt) {
    return _prefs.setString(
      _key,
      jsonEncode({
        'savedAt': savedAt.toUtc().toIso8601String(),
        'events': [for (final event in events) event.toJson()],
      }),
    );
  }

  /// `null` when nothing was saved yet. Throws if the stored value is corrupt
  /// (the repository treats that as "no cache").
  Future<({List<CampusEventModel> events, DateTime savedAt})?> read() async {
    final raw = await _prefs.getString(_key);
    if (raw == null) return null;
    final json = jsonDecode(raw) as Map<String, dynamic>;
    return (
      events: [
        for (final item in json['events'] as List<dynamic>)
          CampusEventModel.fromJson(item as Map<String, dynamic>),
      ],
      savedAt: DateTime.parse(json['savedAt'] as String).toLocal(),
    );
  }
}
