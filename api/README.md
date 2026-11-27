# EventPass API

Node.js 24 + Express 5 + Mongoose 9 + Zod 4, written in TypeScript and run
without a build step (see [ADR-004](../docs/decisions.md#adr-004-typescript-without-a-build-step-nodetest)).
Structure and conventions follow the professor's lab ([ADR-001](../docs/decisions.md#adr-001-lab-aligned-architecture)).

## Run locally

Prerequisites: Node.js 24 or newer and **Docker** (Docker Desktop on Windows,
Docker Engine + Compose plugin on Linux). MongoDB runs in Docker as a replica
set - the API needs one for transactions. Full guide, troubleshooting and
reset instructions: [docs/development-database.md](../docs/development-database.md).

```powershell
cd api
npm install
copy .env.example .env              # Linux/macOS: cp .env.example .env
copy .env.test.example .env.test    # Linux/macOS: cp .env.test.example .env.test
# set JWT_ACCESS_SECRET in .env (command in the file)
# QR_SIGNING_PRIVATE_KEY has obvious development/test values in both templates
npm run db:up                       # MongoDB dev (27027) + test (27028), waits until healthy
npm run dev                         # http://localhost:3000/health
```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run db:up` | Starts the Docker MongoDB containers and waits until both are healthy |
| `npm run db:status` | Shows the state of the containers |
| `npm run db:down` | Stops the containers (development data is kept) |
| `npm run dev` | Starts the API with `.env`, restarts on file changes |
| `npm start` | Starts the API with `.env` |
| `npm run typecheck` | Type-checks `src/`, `test/` and `scripts/` (`tsc --noEmit`) |
| `npm test` | Runs the tests with `.env.test` (needs the `mongo-test` container) |
| `npm run promote-admin -- <email> [--confirm]` | Makes an existing user a global admin (see below) |

The tests only ever touch a database whose name ends with `_test` and refuse
to run unless `NODE_ENV=test` ([ADR-009](../docs/decisions.md#adr-009-lab-modification-stricter-test-database-guard)).
`test/qr-service.test.ts` and `test/checkin-service.test.ts` are pure unit
tests: they can be run with `node --env-file=.env.test --test ...` without
MongoDB (`npm test` still needs the `mongo-test` container for its other suites).

### Creating an admin

Admins cannot be created through the API. Register the account normally,
then, with the development database running:

```powershell
npm run promote-admin -- ada@example.com
```

Safeguards ([ADR-032](../docs/decisions.md#adr-032-promote-admin-script)): it
refuses `NODE_ENV=test` and any `*_test` database, requires `--confirm` when
`NODE_ENV=production`, changes nothing if the user does not exist, and prints
the database name only (never the connection string). To demote an admin, set
`role` back to `"user"` in the database by hand.

## Environment variables

Validated at startup by `src/config/env.ts`; the server refuses to start and
names the faulty variable if one is invalid. It also refuses to start if
MongoDB is not a replica set with a writable primary ([ADR-029](../docs/decisions.md#adr-029-the-api-requires-a-replica-set-startup-check)).

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NODE_ENV` | no | `development` | `development`, `test` or `production` |
| `PORT` | no | `3000` | HTTP port |
| `MONGO_URI` | **yes** | — | MongoDB connection string (local Docker values in `.env.example`; Atlas: `mongodb+srv://...` in the hosting platform's secrets) |
| `JWT_ACCESS_SECRET` | **yes** | — | Signs access tokens; at least 32 characters. Empty in `.env.example`: generate your own (command in the file) |
| `ACCESS_TOKEN_TTL` | no | `15m` | Access-token lifetime: a number followed by `s`, `m`, `h` or `d` |
| `REFRESH_TOKEN_TTL_DAYS` | no | `30` | Refresh-token lifetime in days |
| `QR_TTL_GRACE_SECONDS` | no | `43200` | QR validity after the event ends (12 h, TD7) |
| `CORS_ORIGIN` | no | `*` | Allowed browser origin |
| `TRUST_PROXY` | no | `0` | Reverse proxies in front of the API (`1` on most hosting platforms); keeps the login rate limit per client |
| `QR_SIGNING_PRIVATE_KEY` | **yes** | — | PKCS8 PEM Ed25519 key for ticket QR codes, **separate from** `JWT_ACCESS_SECRET`; obvious dev/test keys in the templates, a platform secret in production |

On a hosting platform there is no `.env` file: `npm start` reads `.env` only
if it exists and otherwise uses the platform's variables. Deployment steps:
[docs/deployment.md](../docs/deployment.md).

## Structure

```
src/
  app.ts              builds the Express app (middleware, routes, error handling)
  server.ts           connects MongoDB, then listens; graceful shutdown
  config/env.ts       validated configuration
  config/db.ts        MongoDB connection, replica-set check, databaseNameOf
  shared/errors.ts    AppError: the only error type sent to clients
  shared/error-handler.ts   404 + central error handler (one error format)
  shared/logger.ts    pino logger (redacts Authorization and cookies)
  shared/authenticate.ts    Bearer-token guard + currentUserId(req)
  shared/authorize.ts       loadActor, requireRole, currentActor
  shared/validation.ts      objectIdSchema, paginationSchema, pageMeta, normalizedEmailSchema
  types/express.d.ts  adds req.userId and req.actor to Express's Request type
  modules/
    users/user.model.ts       user schema, roles, toUserDto
    auth/                     schemas, token service, service, controller, routes,
                              refresh-token model
    clubs/                    club + membership models, schemas, services,
                              controllers, routes, club-transaction (transactions)
    events/, tickets/         Member 2: events, seats and ticket lifecycle
    dashboard/                Member 3: one-event attendance dashboard
    checkins/                 Member 4: checkin model, QR service (EdDSA JWT),
                              check-in service (transaction + sync), schemas,
                              controllers and routes
scripts/promote-admin.ts      admin promotion (guarded)
test/                 tests (node:test + supertest)
docker-compose.yml    MongoDB dev + test replica sets
```

## Endpoints

All resource routes live under `/api/v1`. Conventions (envelopes, status
codes, pagination): [docs/api-conventions.md](../docs/api-conventions.md).

| Method | Path | Auth | Success | Main errors |
|--------|------|------|---------|-------------|
| GET | `/health` | none | 200 `{ status, uptime }` | — |
| POST | `/api/v1/auth/register` | none, rate limited | 201 `{ data: { user, accessToken, refreshToken } }` | 409, 422, 429 |
| POST | `/api/v1/auth/login` | none, rate limited | 200 `{ data: { user, accessToken, refreshToken } }` | 401, 422, 429 |
| POST | `/api/v1/auth/refresh` | refresh token in body | 200 `{ data: { accessToken, refreshToken } }` | 401, 422 |
| POST | `/api/v1/auth/logout` | refresh token in body | 204 | 422 |
| GET | `/api/v1/auth/me` | Bearer | 200 `{ data: user }` | 401 |
| GET | `/api/v1/clubs` | Bearer | 200 `{ data: [club], meta }` | 401, 403, 422 |
| GET | `/api/v1/clubs/:clubId` | Bearer | 200 `{ data: club }` | 401, 404, 422 |
| POST | `/api/v1/clubs` | Bearer, admin | 201 `{ data: club }` | 401, 403, 409, 422 |
| PATCH | `/api/v1/clubs/:clubId` | Bearer, organizer or admin | 200 `{ data: club }` | 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/clubs/:clubId` | Bearer, admin (archives) | 204 | 401, 403, 404 |
| GET | `/api/v1/clubs/:clubId/members` | Bearer, organizer or admin | 200 `{ data: [membership], meta }` | 401, 403, 404 |
| POST | `/api/v1/clubs/:clubId/members` | Bearer, organizer or admin | 201 / 200 `{ data: membership }` | 401, 403, 404, 409, 422, 503 |
| PATCH | `/api/v1/clubs/:clubId/members/:userId` | Bearer, organizer or admin | 200 `{ data: membership }` | 401, 403, 404, 409, 422, 503 |
| DELETE | `/api/v1/clubs/:clubId/members/:userId` | Bearer, organizer, admin or self | 204 | 401, 403, 404, 409, 503 |

Events (`/api/v1/events`, registrations at `/api/v1/events/:eventId/registrations`)
and tickets (`/api/v1/tickets/me`, `/api/v1/tickets/:ticketId`): full table in
[docs/api-conventions.md](../docs/api-conventions.md#events-registrations-and-tickets).
Check-in endpoints (`GET /api/v1/tickets/:ticketId/qr`,
`POST|GET /api/v1/events/:eventId/check-ins`, `POST /api/v1/check-ins/sync`,
`GET /api/v1/events/:eventId/check-in-bundle`) are documented in
[docs/api-conventions.md](../docs/api-conventions.md#check-ins-qr-codes-and-offline-sync-member-4).

`user` = `{ id, name, email, role, createdAt }`. Authentication:
[docs/authentication.md](../docs/authentication.md). Clubs, memberships,
permissions, error codes (`CONCURRENT_UPDATE`, `TRANSACTION_OUTCOME_UNKNOWN`)
and the `assertClubRole` contract: [docs/authorization.md](../docs/authorization.md).

Manual requests: [`requests.http`](requests.http) (VS Code REST Client).
