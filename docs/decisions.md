# Technical decisions (ADR log)

Each entry records **what** was decided, **why**, and the **alternatives** considered.
Entries marked **LAB MODIFICATION** are changes to the professor's reference
implementation (`lab.pdf`, "Secure Todo"); they feed section 2 of the final
report ("what you kept from the lab and what you changed, and why").

| ID | Title | Status | Phase |
|----|-------|--------|-------|
| ADR-001 | Lab-aligned architecture | Accepted | 1 |
| ADR-002 | Monorepo layout | Accepted | 1 |
| ADR-003 | API prefix `/api/v1` and shared conventions | Accepted | 1 |
| ADR-004 | TypeScript without a build step, `node:test` | Accepted | 1 |
| ADR-005 | MongoDB for local development | Superseded by ADR-033 | 1 |
| ADR-006 | Environment files and templates | Accepted | 1 |
| ADR-007 | LAB MODIFICATION: 413 for oversized bodies | Accepted | 1 |
| ADR-008 | LAB MODIFICATION: startup fails cleanly without a database | Accepted | 1 |
| ADR-009 | LAB MODIFICATION: stricter test-database guard | Accepted | 1 |
| ADR-010 | Authentication variables introduced with the auth module | Accepted | 1 |
| ADR-011 | User model in `modules/users/` | Accepted | 2 |
| ADR-012 | Global roles `user` / `admin`; club roles in memberships | Accepted | 2 |
| ADR-013 | LAB MODIFICATION: `ACCESS_TOKEN_TTL` format validated at startup | Accepted | 2 |
| ADR-014 | LAB MODIFICATION: e-mail normalised before validation (Zod 4) | Accepted | 2 |
| ADR-015 | LAB MODIFICATION: duplicate-key race answers 409 | Accepted | 2 |
| ADR-016 | Argon2id parameters: library defaults, measured | Accepted | 2 |
| ADR-017 | Credentials rate limiter built by a factory | Accepted | 2 |
| ADR-018 | Empty `JWT_ACCESS_SECRET` in `.env.example` | Accepted | 2 |
| ADR-019 | LAB MODIFICATION: refresh rotation re-checks a concurrent revocation | **Needs review** | 2 |
| ADR-020 | Access tokens are not recalled by logout (known limitation) | Accepted | 2 |
| ADR-021 | `trust proxy` decided when the hosting platform is known | Accepted (deferred) | 2 |
| ADR-022 | Clubs, club roles and admin-only creation | Accepted | 3 |
| ADR-023 | Clubs are archived, never deleted | Accepted | 3 |
| ADR-024 | 403 versus 404 | Accepted | 3 |
| ADR-025 | Shared validation helpers | Accepted | 3 |
| ADR-026 | The actor: `loadActor`, `requireRole`, `currentActor` | Accepted | 3 |
| ADR-027 | Membership changes use transactions with a shared club write | Accepted | 3 |
| ADR-028 | Bounded retries, deadline and unknown commit outcome | Accepted | 3 |
| ADR-029 | The API requires a replica set (startup check) | Accepted | 3 |
| ADR-030 | Club names unique regardless of case | Accepted | 3 |
| ADR-031 | Test-only transaction hooks | Accepted | 3 |
| ADR-032 | `promote-admin` script | Accepted | 3 |
| ADR-033 | Docker Compose as the shared development and test database | Accepted | 3 |
| ADR-034 | Club edits run in the club transaction (authorization race fix) | Accepted | 3 |
| ADR-035 | Flutter foundation and auth: lab Lab 3, with EventPass changes | Accepted | 4 |
| ADR-036 | Deployment readiness: optional `.env`, `TRUST_PROXY` | Accepted | 5 |
| ADR-037 | Ticket integration contract (M2 ↔ M4) | **Proposed** (team agreement needed) | 5 |
| ADR-038 | Events and tickets implementation (Member 2 scope) | Accepted (provisional on ADR-037) | 5 |

---

## ADR-001 Lab-aligned architecture

**Decision.** The API follows the structure and conventions of the professor's lab:
`src/config/` (env, db), `src/shared/` (errors, error handler, logger, later the
authentication middleware), `src/modules/<resource>/` with
`*.model.ts`, `*.schemas.ts`, `*.service.ts`, `*.controller.ts`, `*.routes.ts`,
and integration tests in `api/test/`. Validation is done in controllers with
`schema.parse(...)`; a `ZodError` becomes a 422 in the central error handler.

**Why.** The Project Book (§3, §9) names the lab as the reference implementation
and asks groups to reuse its structure and core code. Staying close to it keeps
the code explainable at the defence and makes the "kept / changed" section of
the report precise.

**Alternatives.** A custom `src/core/{errors,middleware}` layout with a
validation middleware (rejected: no requirement needs it and it would diverge
from the lab without a concrete reason).

## ADR-002 Monorepo layout

**Decision.** Repository root: `api/` (Node.js API), `app/` (Flutter, Phase 4),
`docs/`, `.github/workflows/` (CI, owned by Member 4), `README.md`.
Matches Project Book §5.2 and P1. Folders are created only when they get real content.

## ADR-003 API prefix `/api/v1` and shared conventions

**Decision.** Every resource route lives under `/api/v1` (lab convention). The
health check stays at `/health`, outside the versioned contract. Response
envelopes, status codes and pagination follow the lab and are written down in
[`api-conventions.md`](api-conventions.md), which every module must follow.

**Why.** One contract for the four members; versioning lets the API evolve
without breaking installed apps. The Team Plan's `/api/...` paths were proposals
(Team Plan §9), not requirements.

**Action.** Announce to Members 2, 3 and 4 before they write endpoints or data sources.

## ADR-004 TypeScript without a build step, `node:test`

**Decision.** As in the lab: Node 24 runs `.ts` files directly (type stripping),
`--env-file` loads variables, `--watch` restarts in development, `tsc --noEmit`
type-checks, and tests use the built-in `node:test` + `supertest`.

**Consequences for every member.** Imports must include the `.ts` extension;
types are imported with `import type`; `enum` and constructor parameter
properties are forbidden (`erasableSyntaxOnly` makes the compiler refuse them).

**Versions installed (Phase 1).** TypeScript 7.0.2 (native compiler) accepts
the lab's `tsconfig.json` unchanged. `@types/node` is pinned to `^24` so the
type checker matches the runtime (`engines: node >= 24`).

## ADR-005 MongoDB for local development

> **Superseded in Phase 3 by [ADR-033](#adr-033-docker-compose-as-the-shared-development-and-test-database):**
> the API now needs a replica set; the team uses the Docker Compose
> databases on ports 27027 / 27028. Kept below for history.

**Decision.** Any MongoDB 8 on `127.0.0.1:27017` works: a local service, or the
lab's Docker setup (`api/docker-compose.yml`, container `eventpass-mongo`).
Databases: `eventpass_dev` (development), `eventpass_test` (tests).
Deployment uses MongoDB Atlas (A14, later phase).

## ADR-006 Environment files and templates

**Decision.**
- `api/.env.example` and `api/.env.test.example` are committed templates with
  fake, non-secret values.
- `api/.env` and `api/.env.test` are local copies, ignored by Git
  (root `.gitignore`: `.env`, `.env.*` except the two templates).
- The test script reads `.env.test`; set it up with
  `copy .env.test.example .env.test` (CI: `cp .env.test.example .env.test`).

**Why.** A3: no secret in the repository, ever. The lab committed `.env.test`
directly; we prefer a template so that nobody is tempted to put real values in
a tracked file.

## ADR-007 LAB MODIFICATION: 413 for oversized bodies

**Lab behaviour.** `express.json({ limit: '100kb' })` rejects a larger body with
an error of type `entity.too.large`. The lab's error handler has no branch for
it, so the client received **500 INTERNAL_ERROR** and the event was logged as a bug.

**Change.** `src/shared/error-handler.ts` answers **413** with code
`PAYLOAD_TOO_LARGE` in the standard error envelope. Nothing else in the handler changed.

**Verified by.** `test/app.test.ts` ("a body over the 100 kB limit answers 413").

## ADR-008 LAB MODIFICATION: startup fails cleanly without a database

**Lab behaviour.** `server.ts` did `await connectDatabase()` at top level with no
error handling: a connection failure ended the process with an unhandled
rejection and a raw stack trace.

**Change.** `src/server.ts` wraps startup in `main()`. If the connection fails,
it logs one fatal line (error name and message only, never the connection
string), sets exit code 1 and returns **before** `listen()`, so the HTTP port
is never opened in an invalid state. Graceful shutdown is unchanged.

**Verified by.** `test/server-startup.test.ts` (invalid `MONGO_URI` → exit code 1,
"Cannot connect to MongoDB", never "API listening").

**Known limit.** With an unreachable (but valid) URI, the driver retries for its
default server-selection timeout (30 s) before failing; behaviour is the same, only slower.

## ADR-009 LAB MODIFICATION: stricter test-database guard

**Lab behaviour.** `test/helpers.ts` refused to run unless
`MONGO_URI.endsWith('_test')`. A URI such as `.../eventpass_dev?appName=x_test`
passes that check, and `NODE_ENV` was not checked.

**Change.** `assertSafeTestDatabase()` extracts the real database name from the
URI and requires it to end with `_test`, **and** requires `NODE_ENV=test`. The
drop helpers additionally refuse to drop a connected database whose name does
not end with `_test`. Error messages never contain the URI (it may hold credentials).

**Verified by.** `test/database.test.ts` (7 guard cases + a real connect/reset on `eventpass_test`).

## ADR-010 Authentication variables introduced with the auth module

**Decision.** The lab's `env.ts` already lists `JWT_ACCESS_SECRET`,
`ACCESS_TOKEN_TTL` and `REFRESH_TOKEN_TTL_DAYS`. Phase 1 has no code using them,
so they are added in Phase 2 together with the authentication module. Phase 1
therefore needs no secret at all. This is a phasing choice, not a change of the
lab's design.

---

## ADR-011 User model in `modules/users/`

**Decision.** `src/modules/users/user.model.ts` holds the lab's user schema,
model and DTO. The lab keeps it in `modules/auth/`. Only the location changes:
A2 asks for one module per resource, and clubs (Phase 3) will reference users
without reaching into the auth module. No users router is created until an
endpoint needs one (`GET /api/v1/auth/me` already serves the profile).

## ADR-012 Global roles `user` / `admin`; club roles in memberships

**Decision.** The user document gains `role: 'user' | 'admin'` (default `user`),
and the DTO exposes it. Clients can never choose it: the register schema has no
`role`, so Zod drops it (tested). Admin accounts come from a seed script.
Club-specific roles (organiser, door staff) live in club memberships (Phase 3),
so rights in club A never leak to club B. Roles are a `const` array, not a
TypeScript `enum` (not erasable syntax). The access token carries only `sub`:
role checks (Phase 3) read the role from the database, so a role change applies
immediately. The `role` index is added in Phase 3 with the first query on it.

## ADR-013 LAB MODIFICATION: `ACCESS_TOKEN_TTL` format validated at startup

**Lab behaviour.** `ACCESS_TOKEN_TTL` accepted any string; a typo such as
`15 minutes` only failed when the first token was signed (500 at login).
**Change.** `env.ts` requires `^\d+[smhd]$` (for example `15m`).
**Verified by.** `test/server-startup.test.ts` (malformed value → exit 1, variable named).

## ADR-014 LAB MODIFICATION: e-mail normalised before validation (Zod 4)

**Lab behaviour.** With Zod 4.6, `z.email().trim().toLowerCase()` checks the
format before trimming: `" Ada@Mail.COM "` is **rejected**, contrary to the
lab's own diagram (§1.2), which promises `ada@mail.com`. Measured before the
change.
**Change.** `z.string().trim().toLowerCase().pipe(z.email())`: normalise, then
validate. Same intent as the lab, now actually achieved.
**Verified by.** `test/auth.test.ts` ("trims and lowercases the e-mail").

## ADR-015 LAB MODIFICATION: duplicate-key race answers 409

**Lab behaviour.** `register` checks `User.exists` and then inserts. Two
simultaneous registrations of one e-mail both pass the check; the unique index
rejects the second insert with MongoDB error 11000, which reached the error
handler as a **500**.
**Change.** `auth.service.register` translates error 11000 into
`409 CONFLICT`. The unique index remains the real guarantee.
**Verified by.** `test/auth.test.ts` (two parallel registrations → exactly one 201 and one 409, one document).

## ADR-016 Argon2id parameters: library defaults, measured

**Decision.** `argon2.hash()` with the library defaults, as in the lab:
Argon2id, m = 64 MiB, t = 3, p = 4 (stored in every hash:
`$argon2id$v=19$m=65536,t=3,p=4$...`). This exceeds the OWASP minimum
(19 MiB, t = 2, p = 1). The hash string carries its own salt and parameters,
so a later change keeps old hashes verifiable.

**Measured (Phase 2, 8-core Windows laptop, argon2 0.45.2).**

| Load | Wall time | Extra memory (RSS) |
|------|-----------|--------------------|
| 1 hash or verify | ~48 ms | +64 MB |
| 4 simultaneous verifies | ~143 ms | +256 MB |
| 8 simultaneous verifies | ~289 ms | +256 MB |
| 16 simultaneous verifies | ~566 ms | +256 MB |

Memory stops at +256 MB because argon2 runs on Node's libuv thread pool
(4 threads by default): at most 4 hashes run at once, the rest queue. Peak
memory is therefore bounded (~256 MB above the base process), and the login
rate limit bounds the queue. **Deployment check (A14):** on a 512 MB instance
this leaves little headroom; if needed, lower `memoryCost` (OWASP: 19456 KiB,
t = 2) — a decision to be taken and documented then, not silently.

## ADR-017 Credentials rate limiter built by a factory

**Decision.** `auth.routes.ts` exports `createCredentialsLimiter()`; the app
uses it with the lab's exact settings (15-minute window, 10 requests in
production / 100 otherwise, skipped when `NODE_ENV=test`, draft-8 headers,
429 in the standard error envelope). The factory lets a test build a limiter
with `limit: 2` and check the 429 response, which the lab's skipped limiter
could not show.
**Verified by.** `test/rate-limit.test.ts`.

## ADR-018 Empty `JWT_ACCESS_SECRET` in `.env.example`

**Lab behaviour.** The template held a long placeholder string that passes the
32-character rule, so it could be deployed by mistake.
**Change.** The template leaves the value empty, with the command that generates
a secret. The API refuses to start until a real secret is set (tested).

## ADR-019 LAB MODIFICATION: refresh rotation re-checks a concurrent revocation

**Status: needs review by the team lead** (see the Phase 2 report).

**Lab behaviour.** `rotateRefreshToken` claims a token atomically, then inserts
the new token. A concurrent replay of the same token sees `usedAt` set and
deletes the family. If that deletion happens **between** the claim and the
insert, the new token survives: the session is not fully revoked.

**Change.** After inserting the new token, the winner checks that the token it
claimed still exists. If not, the family was revoked meanwhile: it deletes the
family again (including its new token) and answers 401. In every interleaving
the family ends with no usable token.

**Evidence and honesty note.** `test/auth.test.ts` sends 5 concurrent refreshes
with one token and asserts: at most one success, all others 401, zero tokens
left in the family, and the winner's token refused afterwards. It passed 10/10
runs with the change. It **also passed 10/10 runs without it**: on a local
MongoDB the risky interleaving did not occur, so the test documents the
required behaviour but does not prove the race in this environment. The
change is kept because the interleaving is possible in principle (slower,
remote database) and costs one indexed lookup per refresh.

**Client rule (unchanged).** A client must serialise its refreshes (the lab's
`QueuedInterceptor`): concurrent use of one refresh token is treated as theft
and ends the session.

## ADR-020 Access tokens are not recalled by logout (known limitation)

**Decision (lab design, kept).** Access tokens are verified by signature only,
without a database lookup. Logout deletes the refresh-token family, so no new
access token can be obtained, but an access token already issued stays valid
until it expires (at most `ACCESS_TOKEN_TTL`, 15 minutes). Recalling it would
require a lookup on every request (deny-list or session check), which the lab
deliberately avoids for speed.
**Mitigations.** Short TTL; the app deletes its tokens locally on logout.
**Verified by.** `test/auth.test.ts` ("KNOWN LIMITATION ..."), and by hand against the running server.

## ADR-021 `trust proxy` decided when the hosting platform is known

**Decision.** `app.set('trust proxy', ...)` is **not** set now. Behind a hosting
proxy, Express would otherwise see the proxy's IP for every client and the
login rate limit would be shared by everyone; but trusting a proxy that does
not exist lets clients forge `X-Forwarded-For` and bypass the limit. The value
(usually `1`, the number of proxies in front of the app) is set and tested
when the hosting platform (A14) is chosen.

---

## ADR-022 Clubs, club roles and admin-only creation

**Decision.** A club is an official campus association created by a platform
admin (`POST /clubs`, admin only - the role-based rule for A7). Management
rights come from `clubmemberships` documents with role `organizer` or `staff`;
there is no plain "member" role (attendees register to events, they do not
join clubs). Memberships are referenced, not embedded: the relation is
many-to-many, queried from both sides, and needs a unique (club, user) index.
The admin appoints the first organizer; a club can have several. The admin is
platform governance (clubs, memberships), not an automatic organizer of events.
Details: [authorization.md](authorization.md).

## ADR-023 Clubs are archived, never deleted

**Decision.** `DELETE /clubs/:clubId` (admin) sets `status: archived`
(idempotent, 204). Events and check-ins of Members 2 and 4 will reference
clubs, so hard deletion would orphan them. Archived clubs are hidden from
non-members (404), read-only for members (409) and restorable by an admin
(`PATCH { status: "active" }`).

## ADR-024 403 versus 404

**Decision.** 404 when the caller may not know the object exists (lab BOLA
rule: missing club, archived club for an outsider). 403 `FORBIDDEN` when the
object is visible but the action is not allowed (active clubs are visible to
every signed-in user, so hiding them would be pointless). New:
`AppError.forbidden()`.

## ADR-025 Shared validation helpers

**Decision.** `src/shared/validation.ts` holds `objectIdSchema`,
`paginationSchema`, `pageMeta()` and `normalizedEmailSchema`: the lab's own
per-module patterns, moved so every module applies A4 and A9 identically.
The Phase 2 auth schemas are left unchanged.

## ADR-026 The actor: `loadActor`, `requireRole`, `currentActor`

**Decision.** `loadActor` runs after the lab's `authenticate` and reads
`{ id, role }` from the database (a deleted user gets 401). `requireRole`
guards routes on the global role; club roles are checked in services.
Identity and roles never come from client data. **Limitation:** the global
role is read at the start of the request; an admin demoted while one of their
requests is in flight keeps admin rights for that request. Club roles are
re-read inside the membership transaction.

## ADR-027 Membership changes use transactions with a shared club write

**Decision.** Every membership change runs in one MongoDB transaction that
first increments `club.membershipVersion` (shared write), then reads the
actor's club role, checks the archived status, permissions and the
last-organizer rule, and makes one membership write, before committing.
Concurrent changes of one club write the same document, so MongoDB lets only
one commit at a time (`WriteConflict` + retry), and every retry reads the
committed result of the other. This prevents write skew (two transactions
deleting different organizers after both counting 2), which snapshot
isolation alone allows - demonstrated by a model test.

**Why not an expiring lock (rejected in review).** A lease lock leaves a gap
between checking the lease and writing; a paused process could write after
its lease expired. The transaction makes the check and the write atomic.

**Infrastructure.** Transactions need a replica set: see ADR-029, ADR-033.

## ADR-028 Bounded retries, deadline and unknown commit outcome

**Decision.** Implemented in `club-transaction.ts`, unit-tested with fake
sessions (`test/transaction-runner.test.ts`):

- 4 whole-transaction attempts, only after `TransientTransactionError`;
  waits random(0, min(100 ms, 10 ms × 2^(n-1))).
- After `UnknownTransactionCommitResult`: retry **only** `commitTransaction()`,
  3 commit attempts in total, waits ≤ 200 ms; the body is never re-run.
- Overall budget 5 s, checked before each attempt, operation, wait and commit
  retry. Each read/findAndModify gets `maxTimeMS = min(2 s, time left)`; the
  commit gets `maxCommitTimeMS = min(2 s, time left)`. The server cancels the
  work itself; no `Promise.race` leaves work running.
- Contention or budget exhausted before commit → 409 `CONCURRENT_UPDATE`
  (nothing applied). Unknown commit after the retries → 503
  `TRANSACTION_OUTCOME_UNKNOWN` ("may or may not have been applied").
- Desired-state retries: add with the same role → 200, with another role →
  409; role already set → 200 unchanged; remove of an absent member → 404.

**Limits (documented, not hidden).** The membership insert takes no
`maxTimeMS` (conflicts fail immediately; otherwise bounded by the server's
60 s transaction lifetime). Network stalls are not bounded by server-side
limits. One operation may start just before the deadline and run up to its
own limit (about 5 s + 2 s worst case in practice).

## ADR-029 The API requires a replica set (startup check)

**Decision.** After connecting, `connectDatabase()` runs `hello` and refuses
to start (`ReplicaSetRequiredError`, ADR-008 path: one fatal line, exit 1,
port never opened) when there is no replica set or no writable primary. The
message names the fix and never the connection string. The decision function
`describeReplicaSetProblem` is unit-tested; Docker and Atlas both pass it.
The test helpers run the same check before any test.

## ADR-030 Club names unique regardless of case

**Decision.** Unique index on `name` with collation `{ locale: 'en', strength: 2 }`;
the list sorts with the same collation (so it uses the `{ status, name }`
index). Parallel duplicates are translated to 409 (ADR-015 pattern).

## ADR-031 Test-only transaction hooks

**Decision.** `setTransactionTestHooks()` (`onAttemptFailed`, `beforeCommit`,
`onCommitUnknown`) throws unless `NODE_ENV=test` (tested in a child process
with `NODE_ENV=production`); hooks default to `null`. Tests use them with
promises they resolve themselves and with test-controlled sessions, so retry,
exhaustion and interleaving tests never rely on sleeps as evidence.

## ADR-032 `promote-admin` script

**Decision.** `npm run promote-admin -- <email> [--confirm]` promotes an
existing user. All guards run before connecting: usage check (exit 2),
refusal of `NODE_ENV=test` and of `*_test` databases, `--confirm` required in
production; a missing user changes nothing; output shows the database name
only, never the URI. `databaseNameOf()` moved unchanged to `src/config/db.ts`
so the script does not import test code.

## ADR-033 Docker Compose as the shared development and test database

**Decision.** `api/docker-compose.yml` runs two `mongo:8.0` single-node
replica sets: `mongo` (127.0.0.1:27027, named volume) and `mongo-test`
(127.0.0.1:27028, `tmpfs`, `enableTestCommands=1`). An idempotent healthcheck
initiates the replica set and reports healthy only with a writable primary;
`npm run db:up` = `docker compose up -d --wait`. Same file on Windows, Linux
and CI; no native MongoDB configuration; native installations on 27017 are
left untouched. Guide: [development-database.md](development-database.md).

**Verification (Phase 3 verification round).** Run on Windows with Docker
Desktop 29.1.3 / Compose 2.40.3: `docker compose config` valid; `npm run db:up`
brought both containers to `healthy` (MongoDB 8.0.38, `rs0`, writable
primary); host listeners only on `127.0.0.1:27027` / `127.0.0.1:27028`;
`enableTestCommands` true on `mongo-test` only. After `docker compose restart`
the development replica-set id was unchanged (persistent volume) and the test
one was new (tmpfs wiped, healthcheck re-initiated it). Not yet run on Linux.

## ADR-034 Club edits run in the club transaction (authorization race fix)

**Problem.** `updateClub` read the caller's club role, then wrote the club
outside any transaction. An organizer demoted or removed between the two steps
could still edit the club on stale authorization.

**Decision (smallest safe change).** `updateClub` now runs inside
`runClubMembershipTransaction`: shared write on the club first, then the
caller's role read in the transaction (`clubRoleInTransaction`), the
permission and archive checks, and the edit. It is serialised with membership
changes: if the demotion commits first, the edit's retry sees the new role and
gets 403; if the edit commits first, it was legitimately made by an organizer.
Permissions and the role model are unchanged. The earlier conditional
`{ _id, status }` filter is no longer needed (a concurrent archive now
conflicts on the shared write and the retry reads the new status).
Archiving (`DELETE`) is admin-only and keeps the documented admin-role limit
(ADR-026). `membershipVersion` therefore also increments on club edits; it is
an internal coordination counter, never exposed.

**Verified by.** Three deterministic interleaving tests in
`test/club-transaction.test.ts` (demotion first → 403 and no edit; edit first
→ both succeed in that order; removal first → 403). The old implementation
could not be run against them deterministically (its non-transactional write
would wait on the paused transaction's lock until the 60 s transaction
lifetime), so the pre-fix failure is reasoned, not demonstrated.

## ADR-035 Flutter foundation and auth: lab Lab 3, with EventPass changes

**Decision.** `app/` follows the lab's Lab 3 code and structure (`core/`
config, error, result, network, storage, di, router; `features/auth/` domain,
data, presentation; get_it, go_router, Dio + `QueuedInterceptor`, secure
storage, BLoC). Changes, each small and documented in the code:

- **`API_BASE_URL` has no default** (F13: "not from source code"). The lab
  defaulted to `http://10.0.2.2:3000/api/v1`; a build without
  `--dart-define=API_BASE_URL=...` now shows a configuration screen.
- **`User.role`** (`user` / `admin`, ADR-012) parsed from the API.
- **`droppable()`** on login and registration events (F8, deliberate
  transformer): a double tap never sends two requests.
- **Interceptor: no refresh token on the device ends the session** instead of
  posting `null` (which the API would answer with 422).
- **The route guard is a pure function** `authRedirect(state, location)`, so it
  is unit-tested without widgets; `createRouter` uses it unchanged.
- **Logging:** the Dio log prints no headers or bodies (tokens, passwords);
  the bloc observer logs state types only.
- **Android:** cleartext HTTP in the debug manifest only; `INTERNET`
  permission in the main manifest (release builds call the deployed API).
- `/home` is a temporary signed-in placeholder (lab §3.10) that Member 3
  replaces.

**Packages and verification (Phase 4 verification round).** `flutter pub get`
resolved: flutter_bloc 9.1.2, bloc 9.2.2, bloc_concurrency 0.3.1, equatable
2.1.0, dio 5.11.1, get_it 8.3.0, go_router 16.3.0, flutter_secure_storage
9.2.4, bloc_test 10.0.1, mocktail 1.0.5, flutter_lints 6.0.0 (newer majors of
equatable, get_it, go_router and flutter_secure_storage exist; not adopted, to
stay on the lab's APIs). `flutter analyze`: no issues. `flutter test`: 30/30.
`flutter build web --release` with `API_BASE_URL`: builds. Deliberate break:
replacing `QueuedInterceptor` by `Interceptor` made the concurrency test fail
(3 refreshes instead of 1); restored. Not yet done: a run on an Android
emulator or phone against the API (Android SDK licenses not accepted; no
emulator running).

## ADR-036 Deployment readiness: optional `.env`, `TRUST_PROXY`

**Defect found in the Phase 5 audit.** `npm start` ran `node --env-file=.env`.
Hosting platforms inject variables but provide no `.env` file, and Node stops
with exit code 9 when that file is missing (checked locally): the deployed API
would never have started.

**Decision.** `start`, `dev` and `promote-admin` use
`--env-file-if-exists=.env` (Node 24): the file is read when present (local),
the platform's variables are used otherwise. `test` keeps the strict flag
(CI copies `.env.test.example` first). Regression test:
`test/deployment.test.ts` (script flags + a real start from environment
variables alone).

**`TRUST_PROXY`** (closes ADR-021): new validated variable, integer 0-5,
default 0 (trust none). On a platform with one load balancer set it to 1 so
`req.ip` - and the login rate limit - is per client. Invalid values stop the
server at startup (tested). Not behaviour-tested behind a real proxy.

## ADR-037 Ticket integration contract (M2 ↔ M4)

**Status: Proposed** - needs Members 2 and 4 (and the team for TD3, TD9).
Full contract: [tickets-contract.md](tickets-contract.md).

**Decision (proposed).** One `tickets` document per (event, attendee), owned
and written by Member 2 (`waitlisted` / `confirmed` / `cancelled`, FIFO
`waitlistSeq`); seat-changing operations use a transaction anchored on the
event document (ADR-027 pattern). Check-in (Member 4) claims a ticket with a
conditional single-document update exposed by Member 2
(`claimTicketForCheckIn`), plus a unique `checkins.ticket` index; cancellation
uses the mirror condition, so check-in and cancellation cannot both succeed.
QR codes are Ed25519-signed JWTs (stateless, verified server-side against the
live ticket; public key for offline pre-check). Offline sync is idempotent on
a client UUID per scan and resolved by server arrival order.

**Why.** Reuses the existing invariant machinery (shared write, bounded
retries, error codes) instead of new infrastructure; keeps one writer per
collection; keeps the server the only judge of seats and check-ins.

**Checked.** The installed `jose` signs/verifies Ed25519 tokens (local script,
throwaway key). Nothing of the contract is implemented.

## ADR-038 Events and tickets implementation (Member 2 scope)

**Status: Accepted, provisional on ADR-037.** `api/src/modules/events`
(model, schemas, service, routes, `event-transaction.ts`) and
`api/src/modules/tickets` (model, schemas, service, routes).

- **Seats:** registration, cancellation, promotion and capacity changes run in
  `runEventTransaction`: first write `$inc seatVersion` on the event, then the
  decision and the writes, with the existing bounded runner
  (`SEAT_POLICY` = 10 attempts for registration bursts, same 5 s budget).
  Every seat-changing path ALSO writes the event counters
  (`confirmedCount` / `waitlistCounter`) in the same transaction; those writes
  conflict the same way, so the shared write is defence in depth here.
- **FIFO:** `waitlistSeq` from `$inc waitlistCounter`; promotion takes the
  lowest `waitlistSeq` (`findOneAndUpdate` with `sort`), in the same
  transaction as the cancellation or capacity increase. A newcomer is
  waitlisted whenever someone is already waiting.
- **Check-in vs cancel:** conditional single-document updates on the ticket
  (`checkedInAt: null` in both filters); `claimTicketForCheckIn` is the only
  writer of `checkedInAt`.
- **Permissions:** `assertClubRole(..., ['organizer'])` for create / update /
  cancel (no admin bypass, D3); tickets visible to the attendee and to
  organizer/staff of the club, 404 for anyone else; staff cannot cancel (403).
- **Conservative choices** (to confirm): no cancellation deadline; capacity
  cannot drop below confirmed registrations; registration open until `endsAt`.

**Evidence.** 25 tests (events + tickets), including 12 simultaneous
registrations for 5 seats (all 12 got 201; exactly 5 confirmed), simultaneous
cancellations promoting in order, and a check-in claim racing a cancellation
(5 rounds, exactly one wins each time). Deliberate breaks: removing the
`seatVersion` write did NOT make the tests fail (the counter writes still
serialise - see above); deciding from a seat count read before the
transaction DID (more than 5 confirmed). Both restored.
