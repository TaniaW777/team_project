import 'package:equatable/equatable.dart';

/// One page of a paginated API list (A9): the items plus where we are.
/// The API answers `{ data: [...], meta: { page, limit, total, totalPages } }`
/// (docs/api-conventions.md). Pure Dart: usable by every domain layer.
class Paginated<T> extends Equatable {
  const Paginated({
    required this.items,
    required this.page,
    required this.totalPages,
    required this.total,
  });

  final List<T> items;
  final int page;
  final int totalPages;
  final int total;

  /// True when another page can be requested.
  bool get hasMore => page < totalPages;

  @override
  List<Object?> get props => [items, page, totalPages, total];
}
