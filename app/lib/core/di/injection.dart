import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:get_it/get_it.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../features/auth/data/datasources/auth_remote_data_source.dart';
import '../../features/auth/data/repositories/auth_repository_impl.dart';
import '../../features/auth/domain/repositories/auth_repository.dart';
import '../../features/auth/domain/usecases/auth_usecases.dart';
import '../../features/auth/presentation/bloc/auth_bloc.dart';
import '../../features/clubs/data/datasources/clubs_remote_data_source.dart';
import '../../features/clubs/data/repositories/clubs_repository_impl.dart';
import '../../features/clubs/domain/repositories/clubs_repository.dart';
import '../../features/clubs/domain/usecases/clubs_usecases.dart';
import '../../features/clubs/presentation/cubit/club_cubit.dart';
import '../../features/clubs/presentation/cubit/my_clubs_cubit.dart';
import '../../features/events/data/datasources/events_local_data_source.dart';
import '../../features/events/data/datasources/events_remote_data_source.dart';
import '../../features/events/data/repositories/events_repository_impl.dart';
import '../../features/events/domain/repositories/events_repository.dart';
import '../../features/events/domain/usecases/events_usecases.dart';
import '../../features/events/presentation/bloc/events_bloc.dart';
import '../config/app_config.dart';
import '../network/dio_client.dart';
import '../storage/token_storage.dart';

/// The service locator ("sl"). This file is the COMPOSITION ROOT (F4): the
/// only place that knows which concrete class implements which contract.
/// Other features (Members 2, 3, 4) add their registrations below, in a
/// section of their own; they receive `Dio` and `TokenStorage` from here.
final sl = GetIt.instance;

void configureDependencies() {
  // ---- Core ----
  sl.registerLazySingleton<TokenStorage>(
    () => SecureTokenStorage(const FlutterSecureStorage()),
  );
  sl.registerLazySingleton<Dio>(
    () => createDio(
      baseUrl: AppConfig.apiBaseUrl,
      tokenStorage: sl(),
      onSessionExpired: () => sl<AuthBloc>().add(const AuthSessionExpired()),
    ),
  );

  // ---- Auth feature ----
  sl.registerLazySingleton(() => AuthRemoteDataSource(sl()));
  sl.registerLazySingleton<AuthRepository>(
    () => AuthRepositoryImpl(remote: sl(), tokenStorage: sl()),
  );
  sl.registerLazySingleton(() => LoginUser(sl()));
  sl.registerLazySingleton(() => RegisterUser(sl()));
  sl.registerLazySingleton(() => GetCurrentUser(sl()));
  sl.registerLazySingleton(() => LogoutUser(sl()));
  // Singleton: one AuthBloc for the whole app (global state).
  sl.registerLazySingleton(
    () => AuthBloc(
      loginUser: sl(),
      registerUser: sl(),
      getCurrentUser: sl(),
      logoutUser: sl(),
    ),
  );

  // ---- Events feature (Member 3) ----
  sl.registerLazySingleton(() => SharedPreferencesAsync());
  sl.registerLazySingleton(() => EventsRemoteDataSource(sl()));
  sl.registerLazySingleton(() => EventsLocalDataSource(sl()));
  sl.registerLazySingleton<EventsRepository>(
    () => EventsRepositoryImpl(remote: sl(), local: sl()),
  );
  sl.registerLazySingleton(() => GetEvents(sl()));
  sl.registerLazySingleton(() => GetCachedEvents(sl()));
  // Factories: a new bloc/cubit each time a screen opens (page-scoped).
  // param1 = optional club id: sl<EventsBloc>() for all events,
  // sl<EventsBloc>(param1: clubId) for the events of one club.
  sl.registerFactoryParam<EventsBloc, String?, void>(
    (clubId, _) =>
        EventsBloc(getEvents: sl(), getCachedEvents: sl(), clubId: clubId),
  );

  // ---- Clubs (read only; the clubs API is Member 1's) ----
  sl.registerLazySingleton(() => ClubsRemoteDataSource(sl()));
  sl.registerLazySingleton<ClubsRepository>(() => ClubsRepositoryImpl(sl()));
  sl.registerLazySingleton(() => GetMyClubs(sl()));
  sl.registerLazySingleton(() => GetClub(sl()));
  sl.registerFactory(() => MyClubsCubit(sl()));
  sl.registerFactory(() => ClubCubit(sl()));
}
