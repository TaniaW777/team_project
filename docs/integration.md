# Integration status and handover (Phase 5)

Audience: the four members. Owner: Member 1 (team lead).

## 1. What exists in this workspace

| Area | Status | Owner | Evidence |
|------|--------|-------|----------|
| API foundation, auth, sessions, users | Done, verified | M1 | `npm test` (148/148 incl. regression) |
| Clubs, memberships, permissions, `assertClubRole` | Done, verified | M1 | concurrency + race + contract tests |
| Docker dev/test databases (replica sets) | Done, verified on Windows | M1 | `docs/development-database.md` |
| Flutter foundation + auth (DI, router guard, secure storage, queued refresh) | Done, verified by tests and an app↔API contract run | M1 (+ M3) | `flutter test` 30/30; contract test 3/3 against the real API |
| Deployment readiness (API) | Prepared, not deployed | M1 / M4 | `docs/deployment.md` |
| Events, registration, capacity, waiting list, tickets | Implemented, verified (ADR-038) | M2 scope | `api/src/modules/{events,tickets}`; 25 tests incl. concurrency |
| **Signed QR codes** | **Not in this workspace** | **M4** | contract: `tickets-contract.md` §4 |
| **Check-in, offline outbox (advanced feature)** | **Not in this workspace** | **M4** | no checkins module |
| **App screens: events, tickets, dashboard** | **Not in this workspace** | **M3** | only `app/lib/features/auth` |
| CI workflow | Added, validated locally, not yet run on GitHub | M1 (added), M4 (owns) | `.github/workflows/ci.yml` |
| Deployed API, release APK on a phone | Not done | M4 coordinates, M1 supports | needs accounts/approvals |

"Not in this workspace" means not present in this copy of the repository; it
may exist on another member's branch. The team lead merges through pull
requests (no Git by the assistant).

## 2. Contracts other modules build on

| Contract | Where | Use |
|----------|-------|-----|
| Error envelope and codes | `docs/api-conventions.md` | every module, every screen |
| `authenticate` + `loadActor` + `currentActor` | `api/src/shared/` | protect routes; the caller ONLY from here |
| `assertClubRole(actor, clubId, roles, options)` | `docs/authorization.md` §6 | events (`['organizer']`), check-in (`['organizer','staff']`) |
| `objectIdSchema`, `paginationSchema`, `pageMeta` | `api/src/shared/validation.ts` | every list and path id (A4, A9) |
| Transactions pattern (shared write + bounded retries) | `club-transaction.ts` | capacity / waiting list if a transaction is needed |
| App: shared `Dio` (Bearer + silent refresh), `guard()`, `Result`/`Failure` | `app/lib/core/` | every data source and repository |
| App: one DI root, routes in `createRouter`, `AuthBloc` | `app/README.md` | every feature |

### Decisions still to confirm with the team

- **D3** (M2, M4): admins do not act on events/check-ins without a membership.
- **D4** (M4): door staff are assigned per club (`staff` membership).
- Tickets: proposed contract in [tickets-contract.md](tickets-contract.md)
  (ADR-037): M2 creates and owns tickets, M4 signs QR codes and checks in
  through `claimTicketForCheckIn`. Agree its §8 decisions before coding.

## 3. Smallest next action per owner

| Owner | Action |
|-------|--------|
| M2 | `modules/events` (lab layering) using `assertClubRole(..., ['organizer'])`; registration with an atomic capacity rule; waiting-list promotion; tests incl. concurrent registration |
| M3 | Replace the `/home` placeholder with the events list (loading/empty/error/content, cache-then-network); register blocs in `injection.dart` |
| M4 | Watch the first CI run and make the checks required on `main`; signed QR + check-in using `assertClubRole(..., ['organizer','staff'])`; deployment with M1 |
| M1 | Review PRs against these contracts; deploy with M4 once accounts are approved; Android end-to-end check once licenses are approved |

## 4. CI workflow

**Implemented:** `.github/workflows/ci.yml` (P3), from the proposal below plus
read-only permissions, cancellation of superseded runs, 20-minute job limits
and database logs on failure. No deployment step. Validated locally (YAML
parsed and checked against the project: paths, versions, scripts, Compose
service, step order; import paths exact-case for Linux; `npm ls` matches the
lock file). **Not yet run on GitHub**: the first pull request will be its
first real run. Member 4 (Quality Lead) owns it from here (branch protection,
required checks). Original proposal:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  api:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: api/package-lock.json
      - run: docker compose up -d --wait mongo-test
      - run: cp .env.test.example .env.test
      - run: npm ci
      - run: npm run typecheck
      - run: npm test

  app:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: app
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with:
          channel: stable
          flutter-version: 3.44.0
      - run: flutter pub get
      - run: dart format --output=none --set-exit-if-changed lib test
      - run: flutter analyze
      - run: flutter test
```

Notes: the API job uses the same Compose file as laptops (`mongo-test`);
`subosito/flutter-action` is the usual community action for Flutter (no
official one exists) - Member 4 decides.

## 5. Verification boundaries (honest)

- **Verified:** API suites, Flutter unit/bloc tests, the app's real networking
  stack against the real API (contract test), web release build.
- **Not verified:** the app on an Android emulator or phone (Android SDK
  licenses not accepted), the deployed API, the first CI run on GitHub.
