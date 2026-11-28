import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/club.dart';
import '../../domain/usecases/clubs_usecases.dart';

/// One club and my role in it (club page header, "New event" button).
class ClubCubit extends Cubit<ClubState> {
  ClubCubit(this._getClub) : super(const ClubLoading());

  final GetClub _getClub;

  Future<void> load(String clubId) async {
    emit(const ClubLoading());
    final result = await _getClub(clubId);
    emit(switch (result) {
      Ok(:final value) => ClubLoaded(value),
      Err(:final failure) => ClubFailure(failure),
    });
  }
}

sealed class ClubState extends Equatable {
  const ClubState();

  @override
  List<Object?> get props => [];
}

final class ClubLoading extends ClubState {
  const ClubLoading();
}

final class ClubLoaded extends ClubState {
  const ClubLoaded(this.club);

  final Club club;

  @override
  List<Object?> get props => [club];
}

final class ClubFailure extends ClubState {
  const ClubFailure(this.failure);

  final Failure failure;

  @override
  List<Object?> get props => [failure];
}
