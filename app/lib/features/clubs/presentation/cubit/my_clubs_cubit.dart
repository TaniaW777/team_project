import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/club.dart';
import '../../domain/usecases/clubs_usecases.dart';

/// The clubs where I have a role. A Cubit, not a Bloc: one action (load),
/// no transformer needed, so methods are simpler than events (F2).
class MyClubsCubit extends Cubit<MyClubsState> {
  MyClubsCubit(this._getMyClubs) : super(const MyClubsLoading());

  final GetMyClubs _getMyClubs;

  Future<void> load() async {
    emit(const MyClubsLoading());
    final result = await _getMyClubs();
    emit(switch (result) {
      Ok(:final value) => MyClubsLoaded(value.items),
      Err(:final failure) => MyClubsFailure(failure),
    });
  }
}

sealed class MyClubsState extends Equatable {
  const MyClubsState();

  @override
  List<Object?> get props => [];
}

final class MyClubsLoading extends MyClubsState {
  const MyClubsLoading();
}

/// An empty list is a normal result (the page shows the empty view).
final class MyClubsLoaded extends MyClubsState {
  const MyClubsLoaded(this.clubs);

  final List<Club> clubs;

  @override
  List<Object?> get props => [clubs];
}

final class MyClubsFailure extends MyClubsState {
  const MyClubsFailure(this.failure);

  final Failure failure;

  @override
  List<Object?> get props => [failure];
}
