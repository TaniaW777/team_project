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
    pagination/paginated.dart  one page of a list + hasMore (every list feature)
    bloc/event_transformers.dart  debounceRestartable for search boxes (F8)
    widgets/state_views.dart      shared loading / empty / error views (F7)
  features/
    auth/
      domain/   entities (User with role), repository contract, use cases
      data/     UserModel, AuthRemoteDataSource (Dio), AuthRepositoryImpl
      presentation/  AuthBloc (events, states), login and register pages
    events/                 signed-in home: browse, search, filter (Member 3)
      domain/   CampusEvent, EventsRepository contract, GetEvents / GetCachedEvents
      data/     CampusEventModel, remote (GET /events) + local (device cache) sources
      presentation/  EventsBloc (debounced search, droppable next page,
                     cache then network), events list page, event card
    check_in/               QR check-in + offline outbox (Member 4)
      domain/   PendingCheckIn (UUID v4 idempotency key), CheckInResult,
                CheckInRepository contract, one use case per action
      data/     versioned SharedPreferencesAsync outbox (checkin.outbox.v1),
                remote source (online scan, sync batches <= 100, bundle),
                repository impl with §7 status mapping
      presentation/  CheckInBloc (droppable capture, restartable sync),
                     scanner page with manual token entry, status chips
test/                       bloc_test, repository, widget, interceptor, error mapper, route guard
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
  The error mapper keeps the API `code` and `details` (e.g. `checkedInAt`) in
  `ApiFailure`; `failure.isRetryable` distinguishes terminal check-in errors
  (`INVALID_QR`, `WRONG_EVENT`, `ALREADY_CHECKED_IN`, `TICKET_NOT_CONFIRMED`,
  `IDEMPOTENCY_KEY_REUSED`) from retryable ones (network/5xx, `CONCURRENT_UPDATE`,
  `TRANSACTION_OUTCOME_UNKNOWN`).

## Check-in (Member 4)

Route `/check-in` (`AppRoutes.checkIn`) is behind the same auth redirect as
`/home`; the events list has a discreet "Scanner" shortcut. The page uses
`mobile_scanner` for QR codes and also offers a manual QR-token field (useful
for tests and devices without a camera).

Each scan gets **one UUID v4 idempotency key** and is written to
`checkin.outbox.v1` (SharedPreferencesAsync) **before** any request. The key is
reused on every retry; the outbox is sorted by `scannedAt` for audit only — the
server decides check-ins by arrival order. `syncOutbox()` sends at most 100
items per batch and applies the contract mapping:

| Server result / failure | Device state |
|---|---|
| `accepted`, `duplicate` | `synced` |
| `already_checked_in` | `conflict` (shows the server `checkedInAt`) |
| `rejected` + reason | `rejected` |
| network, 5xx, 409 `CONCURRENT_UPDATE`, 503 `TRANSACTION_OUTCOME_UNKNOWN` | stays `pendingSync` |

The QR is always **verified by the server**: `GET /events/:eventId/check-in-bundle`
is only an optional, stale offline pre-check (no local signature validation,
no `jose` dependency).

### Camera permissions

- Android: `android.permission.CAMERA` and an optional camera feature are
  declared in `android/app/src/main/AndroidManifest.xml`. `minSdk` is at
  least 21 (CameraX requirement).
- iOS: `NSCameraUsageDescription` is set in `ios/Runner/Info.plist`.

The check-in API contract test is skipped unless `INTEGRATION_API_URL` is set,
like the auth/events ones:

```powershell
flutter test test/integration --dart-define=INTEGRATION_API_URL=http://127.0.0.1:3001/api/v1
```
