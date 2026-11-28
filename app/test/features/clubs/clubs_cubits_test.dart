import 'package:bloc_test/bloc_test.dart';
import 'package:eventpass/core/error/failure.dart';
import 'package:eventpass/core/pagination/paginated.dart';
import 'package:eventpass/core/result/result.dart';
import 'package:eventpass/features/clubs/data/models/club_model.dart';
import 'package:eventpass/features/clubs/domain/entities/club.dart';
import 'package:eventpass/features/clubs/domain/repositories/clubs_repository.dart';
import 'package:eventpass/features/clubs/domain/usecases/clubs_usecases.dart';
import 'package:eventpass/features/clubs/presentation/cubit/club_cubit.dart';
import 'package:eventpass/features/clubs/presentation/cubit/my_clubs_cubit.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockClubsRepository extends Mock implements ClubsRepository {}

void main() {
  late MockClubsRepository repository;
  const music = Club(
    id: 'c1',
    name: 'Music Club',
    description: 'Concerts',
    status: 'active',
    myRole: 'organizer',
  );
  const offline = NetworkFailure();

  setUp(() => repository = MockClubsRepository());

  group('MyClubsCubit', () {
    blocTest<MyClubsCubit, MyClubsState>(
      'success: my clubs',
      setUp: () => when(() => repository.getMyClubs(page: 1)).thenAnswer(
        (_) async => const Ok(
          Paginated(items: [music], page: 1, totalPages: 1, total: 1),
        ),
      ),
      build: () => MyClubsCubit(GetMyClubs(repository)),
      act: (cubit) => cubit.load(),
      expect: () => [
        const MyClubsLoading(),
        const MyClubsLoaded([music]),
      ],
    );

    blocTest<MyClubsCubit, MyClubsState>(
      'no club: an empty list (the empty view)',
      setUp: () => when(() => repository.getMyClubs(page: 1)).thenAnswer(
        (_) async =>
            const Ok(Paginated(items: [], page: 1, totalPages: 0, total: 0)),
      ),
      build: () => MyClubsCubit(GetMyClubs(repository)),
      act: (cubit) => cubit.load(),
      expect: () => [const MyClubsLoading(), const MyClubsLoaded([])],
    );

    blocTest<MyClubsCubit, MyClubsState>(
      'failure: the error state',
      setUp: () => when(
        () => repository.getMyClubs(page: 1),
      ).thenAnswer((_) async => const Err(offline)),
      build: () => MyClubsCubit(GetMyClubs(repository)),
      act: (cubit) => cubit.load(),
      expect: () => [const MyClubsLoading(), const MyClubsFailure(offline)],
    );
  });

  group('ClubCubit', () {
    blocTest<ClubCubit, ClubState>(
      'success: the club with my role',
      setUp: () => when(
        () => repository.getClub('c1'),
      ).thenAnswer((_) async => const Ok(music)),
      build: () => ClubCubit(GetClub(repository)),
      act: (cubit) => cubit.load('c1'),
      expect: () => [const ClubLoading(), const ClubLoaded(music)],
    );

    blocTest<ClubCubit, ClubState>(
      'failure: the error state',
      setUp: () => when(
        () => repository.getClub('c1'),
      ).thenAnswer((_) async => const Err(offline)),
      build: () => ClubCubit(GetClub(repository)),
      act: (cubit) => cubit.load('c1'),
      expect: () => [const ClubLoading(), const ClubFailure(offline)],
    );
  });

  test('ClubModel reads myRole (null when I have no role)', () {
    final mine = ClubModel.fromJson({
      'id': 'c1',
      'name': 'Music Club',
      'description': 'Concerts',
      'status': 'active',
      'myRole': 'staff',
    });
    final other = ClubModel.fromJson({
      'id': 'c2',
      'name': 'Chess',
      'status': 'active',
      'myRole': null,
    });

    expect(mine.isStaff, isTrue);
    expect(mine.isOrganizer, isFalse);
    expect(other.myRole, isNull);
    expect(other.description, '');
  });
}
