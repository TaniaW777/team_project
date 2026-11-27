import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:get_it/get_it.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../features/auth/data/datasources/auth_remote_data_source.dart';
import '../../features/auth/data/repositories/auth_repository_impl.dart';
import '../../features/auth/domain/repositories/auth_repository.dart';
import '../../features/auth/domain/usecases/auth_usecases.dart';
import '../../features/auth/presentation/bloc/auth_bloc.dart';
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
  // Factory: a new EventsBloc each time the screen opens (page-scoped).
  sl.registerFactory(() => EventsBloc(getEvents: sl(), getCachedEvents: sl()));
}
