# Requirement traceability (Project Book A1–A14, F1–F14, P1–P5)

Status values: **PASS** (implemented and verified), **PARTIAL** (part delivered and
verified, rest planned), **NOT STARTED**, **BLOCKED**, **NEEDS REVIEW**.
Owner follows the Team Plan responsibility matrix (§5). Last update: Phase 3.

> **Phase 3 verification status.** Verified against the Docker `mongo-test`
> replica set: `npm test` 143/143 PASS (Phase 1–3, including concurrency,
> failpoint and regression tests), `npm run typecheck` PASS; the concurrency
> file passed 3 further repeated runs (19/19 each); both deliberate breaks
> made the expected tests fail and were restored.

## API

| ID | Requirement | Owner | Status | Evidence / next step |
|----|-------------|-------|--------|----------------------|
| A1 | Node 24+, Express 5, Mongoose, TS type-checked in CI | M1 (CI: M4) | PARTIAL | Node 24.11, Express 5, Mongoose 9, `npm run typecheck` green; typecheck step in `.github/workflows/ci.yml`, pending first GitHub run |
| A2 | Layered: routes, controllers, services, models; one module per resource | M1 sets pattern, all | PARTIAL | `modules/auth`, `modules/users`, `modules/clubs` (routes → controllers → services → models). Events, tickets, check-ins: Members 2, 4 |
| A3 | Env validated at startup, no secret in repo | M1 | PASS | `src/config/env.ts` incl. JWT secret ≥ 32 chars and TTL format (ADR-013); empty secret in template (ADR-018); startup tests |
| A4 | Schema validation of body/query/path, unknown fields dropped | All | PARTIAL | Auth and club/membership schemas for every body, query and path parameter, mass-assignment tests PASS; shared helpers (ADR-025). Other modules: Members 2, 4 |
| A5 | One error format, meaningful status codes | M1 | PASS | Single envelope incl. 401/403/409/429; 409 `CONCURRENT_UPDATE` and 503 `TRANSACTION_OUTCOME_UNKNOWN` tested with real conflicts and injected commit failures |
| A6 | Argon2id/bcrypt, short access token, rotating hashed refresh token, logout revokes | M1 | PASS | Argon2id (ADR-016), 15-min HS256 JWT, SHA-256-hashed rotating refresh tokens with reuse detection, logout revokes the family; `test/auth.test.ts`. Limitation: ADR-020 |
| A7 | Object-level authorization, at least one role rule | All | PASS (clubs) / PARTIAL (project) | Admin-only club creation/archiving (role rule), club-scoped organizer/staff checks inside the club transaction (incl. club edits, ADR-034), `assertClubRole` contract; BOLA, contract and race tests PASS. Events/tickets/check-ins: Members 2, 4 |
| A8 | ≥ 3 related resources besides users | M2, M4 (+ M1 clubs) | PASS (clubs, events, tickets) / PARTIAL (check-ins) | clubs → events → tickets (+ memberships, users), ADR-038; check-ins (Member 4) still to implement against `docs/tickets-contract.md` |
| A9 | Pagination on every list, capped size, a filter/search | All | PASS (clubs) / PARTIAL (project) | Clubs list (page, limit ≤ 100, `q`, `mine`, `status`) and members list (`role`), tested; batched `myRole` (1 query per page) tested |
| A10 | Indexes on filter/sort fields | All | PARTIAL | Auth indexes (Phase 2); `clubs.name` unique (case-insensitive), `{status, name}`; memberships `{club, user}` unique, `{club, role}`, `{user, club}`. `users.role` index still deferred (no query uses it) |
| A11 | helmet, auth rate limit, body size limit | M1 | PASS | helmet, 100 kB limit (413), rate limit on register/login (429, `test/rate-limit.test.ts`). `TRUST_PROXY` setting for the hosting proxy (ADR-036) |
| A12 | Integration tests: auth, each resource, authorization | All | PARTIAL | 173/173 PASS: auth, clubs/memberships, events and tickets (capacity, FIFO, cancellation, BOLA, check-in claim vs cancel), deployment readiness; app↔API contract 3/3. Check-ins: Member 4 |
| A13 | README endpoint table + requests.http / collection / OpenAPI | All | PARTIAL | Auth + clubs endpoints in `api/README.md`, `docs/api-conventions.md`, `api/requests.http` |
| A14 | Deployed over HTTPS (Atlas + host) | M4 coordinates | NOT STARTED (prepared) | Code ready (start without `.env`, `TRUST_PROXY`, replica-set check); steps in `docs/deployment.md`; needs Atlas + hosting accounts and approval |

## Flutter app

| ID | Requirement | Owner | Status | Next step |
|----|-------------|-------|--------|-----------|
> **Phase 4 status.** Verified: `flutter analyze` no issues, `flutter test`
> 30/30, formatting clean, web release build OK (ADR-035). Not yet verified:
> sign-in on an Android device/emulator against a running API (licenses not
> accepted, no emulator started) - required for the M2 checklist.

| ID | Requirement | Owner | Status | Evidence / next step |
|----|-------------|-------|--------|-----------|
| F1 | Feature-first, domain/data/presentation, domain without Flutter/Dio | M3 (+ M1 foundation) | PASS (foundation + auth) | `lib/core/`, `lib/features/auth/{domain,data,presentation}`; domain imports only `equatable` and `core/result` |
| F2 | BLoC/Cubit, no logic in widgets | M3 | PASS (auth) | `AuthBloc`; pages only add events and draw states |
| F3 | Repository contracts in domain, failures mapped at data border | M3 (+ M1) | PASS (auth) | `AuthRepository` / `AuthRepositoryImpl`, `guard()` + `mapDioException`; repository + mapper tests pass |
| F4 | Single DI composition root | M1 + M3 | PASS | `core/di/injection.dart` (get_it) |
| F5 | Declarative navigation with auth-driven guard | M1 + M3 | PASS (unit) | go_router + pure `authRedirect`, `refreshListenable` on AuthBloc; guard tests pass. On-device check pending |
| F6 | Secure token storage, concurrency-safe refresh | M1 | PASS (unit) | `SecureTokenStorage`; `QueuedInterceptor`: 3 simultaneous 401 → 1 refresh (test fails with a plain `Interceptor`) |
| F7 | Loading / empty / error+retry / content | M3 | NOT STARTED | Data screens: Member 3 |
| F8 | Optimistic update + deliberate event transformer | M3 | PARTIAL | Transformer: `droppable()` on login/register (tested). Optimistic update: Member 3 |
| F9 | Cache then network for main list | M3 | NOT STARTED | Member 3 (events list) |
| F10 | Client validation + 422 errors next to fields | M3 (+ M1 auth forms) | PASS (auth, unit) | Login/register validators + server field errors under the fields; 422 → state tested |
| F11 | bloc_test for every bloc with logic | All | PASS (AuthBloc) | 9 bloc tests (success + failure paths) pass |
| F12 | `flutter analyze` clean, formatted | All | PASS (current code) | `flutter analyze`: no issues; `dart format --set-exit-if-changed`: clean |
| F13 | API URL via `--dart-define` | M1 + M3 | PASS | `API_BASE_URL` required, no default; configuration screen if missing; web build with the define OK |
| F14 | Release APK on a real phone | M4 | NOT STARTED | Android licenses must be accepted first |

## Team practices

| ID | Requirement | Owner | Status | Note |
|----|-------------|-------|--------|------|
| P1 | Monorepo `api/` + `app/`, instructor invited from M0 | Team lead | PARTIAL | `api/` created; `app/` Phase 4; instructor invitation is a manual team-lead task |
| P2 | Branches + PRs reviewed by another member | All | NOT STARTED | Managed by the team (no Git by the assistant) |
| P3 | CI on every PR: API typecheck/tests, Flutter format/analyze/tests | M4 | NEEDS REVIEW | `.github/workflows/ci.yml` (API: Compose `mongo-test`, `npm ci`, typecheck, test; app: pub get, format, analyze, test). Validated locally; pending its first GitHub run |
| P4 | Issue board kept up to date | Team lead | NOT STARTED | Manual team-lead task |
| P5 | Commit history over the whole period | All | NOT STARTED | Managed by the team |
