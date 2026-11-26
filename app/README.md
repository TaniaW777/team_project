# EventPass app (Flutter)

Flutter + BLoC, Clean Architecture, feature first, following the professor's
lab (Lab 3). Shared foundation and authentication: Member 1 (with Member 3,
App Lead). Feature screens (events, tickets, dashboard, check-in): Members 3
and 4, added under `lib/features/`.

## Run

Prerequisites: Flutter 3.44+ (Dart 3.12+), the API running
(`api/`: `npm run db:up`, then `npm run dev`).

```powershell
cd app
flutter pub get
# Android emulator (10.0.2.2 = your computer):
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
# Chrome / iOS simulator:
flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

`API_BASE_URL` is **required** (F13): there is no URL in the source code. A
build without it shows a "API_BASE_URL is not set" screen instead of calling a
guessed address. Real phone: your computer's Wi-Fi IP; release build: the
HTTPS URL of the deployed API. Plain `http://` is allowed in **debug** Android
builds only (`android/app/src/debug/AndroidManifest.xml`).

## Checks

```powershell
dart format --output=none --set-exit-if-changed lib test   # F12 formatting
flutter analyze                                           # F12 lints
flutter test                                              # F11 bloc tests + core tests
```

App ↔ API contract test (real Dio stack against a running API on a **test**
database; skipped otherwise). Start the API with `node --env-file=.env.test
src/server.ts` in `api/` (port 3001, `mongo-test`), then:

```powershell
flutter test test/integration --dart-define=INTEGRATION_API_URL=http://127.0.0.1:3001/api/v1
```

## Structure

```
lib/
  main.dart                 checks API_BASE_URL, configures DI, starts AuthBloc
  app.dart                  MaterialApp.router (+ missing-configuration screen)
  core/
    config/app_config.dart  API_BASE_URL from --dart-define
    error/failure.dart      sealed Failure (Network, Unauthorized, Validation, Server)
    result/result.dart      sealed Result (Ok / Err)
    network/                Dio client, AuthInterceptor (silent, queued refresh), error mapper
    storage/                TokenStorage contract + secure storage implementation
    di/injection.dart       the single composition root (get_it)
    router/app_router.dart  go_router + authRedirect (route guard)
    app_bloc_observer.dart  logs bloc transitions (types only)
  features/
    auth/
      domain/   entities (User with role), repository contract, use cases
      data/     UserModel, AuthRemoteDataSource (Dio), AuthRepositoryImpl
      presentation/  AuthBloc (events, states), login and register pages
test/                       bloc_test, repository, interceptor, error mapper, route guard
```

## Rules for every feature (Members 2, 3, 4)

- `domain/` imports neither Flutter nor Dio (F1). Repository contracts live in
  `domain/`, implementations in `data/`, and every repository method goes
  through `guard()` so failures are mapped once at the data border (F3).
- Data sources receive the shared `Dio` from `core/di/injection.dart`: the
  Bearer token and the silent refresh are automatic. Never add tokens by hand.
- Register your dependencies in a new section of `configureDependencies()`;
  do not create another GetIt instance (F4). Page-scoped blocs: `registerFactory`.
- Add your routes to `createRouter` under the signed-in area; replace the
  temporary `/home` placeholder (`AppRoutes.home`). The guard needs no change.
- Read the current user with `context.read<AuthBloc>()`; sign out with
  `AuthLogoutRequested`. `user.isAdmin` gives the global role; club roles come
  from the clubs API (`myRole`).
- Error codes from the API: `docs/api-conventions.md`. A 409 `CONCURRENT_UPDATE`
  can be retried; a 503 `TRANSACTION_OUTCOME_UNKNOWN` means reload, then retry.
