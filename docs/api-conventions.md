# API conventions (shared contract for all modules)

Every EventPass module (auth, users, clubs, events, tickets, checkIns) follows
these rules. They come from the professor's lab and are fixed in
[ADR-003](decisions.md#adr-003-api-prefix-apiv1-and-shared-conventions).
Changing them requires agreement of the four members.

## Base URL and versioning

| Environment | Base URL |
|-------------|----------|
| Local (API) | `http://localhost:3000/api/v1` |
| Android emulator (app) | `http://10.0.2.2:3000/api/v1` |
| Deployed | `https://<host>/api/v1` (A14, later) |

- All resource routes are under **`/api/v1`**.
- `GET /health` (outside `/api/v1`) answers `{ "status": "ok", "uptime": <seconds> }`.
- Resources are plural nouns: `/api/v1/clubs`, `/api/v1/events/:id`.
- HTTP verbs carry the action: `GET` read, `POST` create/action, `PATCH` partial update, `DELETE` remove.

## Success envelope

```json
{ "data": { ... } }
```

List endpoints add pagination metadata:

```json
{
  "data": [ ... ],
  "meta": { "page": 1, "limit": 20, "total": 57, "totalPages": 3 }
}
```

`204 No Content` responses have no body.

## Error envelope (A5)

Every error, from every module, has exactly this shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details": { } } }
```

`details` is optional. For `422` it maps each invalid field to its messages
(`{ "email": ["Invalid email address"] }`), which the app shows next to the field (F10).

| Status | `code` | When |
|--------|--------|------|
| 400 | `BAD_REQUEST` | Malformed JSON body, or a request that makes no sense |
| 401 | `UNAUTHORIZED` | Missing, invalid or expired credentials |
| 403 | `FORBIDDEN` | The caller may see the object but not perform this action (role rule) |
| 404 | `NOT_FOUND` | Unknown route, or a resource that does not exist **or that the caller may not see** (lab rule against BOLA) |
| 409 | `CONFLICT` | Uniqueness or state conflict (duplicate email, last organizer, archived club...) |
| 409 | `CONCURRENT_UPDATE` | Concurrent changes or time budget exhausted; **nothing was applied**, retry |
| 409 | `EVENT_CLOSED` | Registration on a cancelled or finished event |
| 409 | `TICKET_ALREADY_USED` | Cancelling a ticket that was already checked in |
| 413 | `PAYLOAD_TOO_LARGE` | JSON body over 100 kB |
| 422 | `VALIDATION_ERROR` | Body, query or path parameter rejected by a Zod schema |
| 429 | `TOO_MANY_REQUESTS` | Rate limit on register and login |
| 500 | `INTERNAL_ERROR` | Unexpected bug; message is always "Something went wrong", details only in server logs |
| 503 | `TRANSACTION_OUTCOME_UNKNOWN` | A transaction commit may or may not have been applied: reload, then retry only if needed |

**403 or 404** ([ADR-024](decisions.md#adr-024-403-versus-404)): 404 when the caller
may not know the object exists, 403 when it is visible but the action is not allowed.
New codes are documented here first.

## Validation (A4)

- Every body, query and path parameter is parsed with a Zod schema in the controller
  (`schema.parse(req.body)`); the parsed value is what the service receives.
- Unknown fields are **dropped** (Zod objects strip unknown keys): a client can never
  set `owner`, `role`, `clubId`... unless the schema declares it.
- MongoDB ids in paths: 24 hexadecimal characters, otherwise `422`.

## Pagination and filtering (A9)

- Query parameters `page` (default 1, min 1) and `limit` (default 20, **max 100**).
- Filters are explicit, validated query parameters; every filtered or sorted field is indexed (A10).
- Shared building blocks (`src/shared/validation.ts`): `objectIdSchema`,
  `paginationSchema` (extend it with your filters), `pageMeta(total, page, limit)`,
  `normalizedEmailSchema`. Use them instead of re-writing the rules.

## Authentication

Full design: [authentication.md](authentication.md).

- Protected routes require `Authorization: Bearer <access token>`; a module
  protects its routes with the shared `authenticate` middleware
  (`src/shared/authenticate.ts`) and reads the caller with `currentUserId(req)`.
- The caller's identity always comes from the verified token, never from the body or the URL.
- Any 401 on a protected route means "access token missing, invalid or expired":
  the app refreshes once and replays.

| Method | Path | Auth | Success | Main errors |
|--------|------|------|---------|-------------|
| POST | `/api/v1/auth/register` | — (rate limited) | 201 `{ data: { user, accessToken, refreshToken } }` | 409, 422, 429 |
| POST | `/api/v1/auth/login` | — (rate limited) | 200 `{ data: { user, accessToken, refreshToken } }` | 401, 422, 429 |
| POST | `/api/v1/auth/refresh` | — | 200 `{ data: { accessToken, refreshToken } }` | 401, 422 |
| POST | `/api/v1/auth/logout` | — | 204 | 422 |
| GET | `/api/v1/auth/me` | Bearer | 200 `{ data: user }` | 401 |

`user` = `{ id, name, email, role, createdAt }`, where `role` is `user` or `admin`.

## Clubs and memberships

Full design, permission matrix and the `assertClubRole` contract:
[authorization.md](authorization.md). Every route requires a Bearer token.

| Method | Path | Who | Success | Main errors |
|--------|------|-----|---------|-------------|
| GET | `/api/v1/clubs?page&limit&q&mine&status` | signed-in (`status`: admin) | 200 `{ data: [club], meta }` | 401, 403, 422 |
| GET | `/api/v1/clubs/:clubId` | signed-in (archived: members, admin) | 200 `{ data: club }` | 401, 404, 422 |
| POST | `/api/v1/clubs` | admin | 201 `{ data: club }` | 401, 403, 409, 422 |
| PATCH | `/api/v1/clubs/:clubId` | organizer, admin (`status`: admin) | 200 `{ data: club }` | 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/clubs/:clubId` | admin (archives) | 204 | 401, 403, 404 |
| GET | `/api/v1/clubs/:clubId/members?page&limit&role` | organizer, admin | 200 `{ data: [membership], meta }` | 401, 403, 404 |
| POST | `/api/v1/clubs/:clubId/members` | organizer, admin | 201 (200 if already in that role) `{ data: membership }` | 401, 403, 404, 409, 422, 503 |
| PATCH | `/api/v1/clubs/:clubId/members/:userId` | organizer, admin | 200 `{ data: membership }` | 401, 403, 404, 409, 422, 503 |
| DELETE | `/api/v1/clubs/:clubId/members/:userId` | organizer, admin, the member themselves | 204 | 401, 403, 404, 409, 503 |

## Events, registrations and tickets

Contract and lifecycle: [tickets-contract.md](tickets-contract.md) (ADR-037/038).
Every route requires a Bearer token.

| Method | Path | Who | Success | Main errors |
|--------|------|-----|---------|-------------|
| GET | `/api/v1/events?page&limit&q&clubId&status&from` | signed-in | 200 `{ data: [event], meta }` (published by default, by `startsAt`) | 401, 422 |
| GET | `/api/v1/events/:eventId` | signed-in | 200 `{ data: event }` | 404, 422 |
| POST | `/api/v1/events` (`clubId` in the body) | organizer of the club | 201 `{ data: event }` | 403, 404, 409 (archived club), 422 |
| PATCH | `/api/v1/events/:eventId` | organizer of the club | 200 `{ data: event }` (a higher capacity promotes the waiting list) | 403, 404, 409 (capacity below confirmed, cancelled event), 422 |
| DELETE | `/api/v1/events/:eventId` | organizer of the club | 204 (soft cancel, idempotent) | 403, 404 |
| POST | `/api/v1/events/:eventId/registrations` | signed-in | 201 new ticket (`confirmed` or `waitlisted`), 200 already registered | 404, 409 `EVENT_CLOSED`, 409/503 transaction codes |
| GET | `/api/v1/tickets/me?page&limit&status` | attendee | 200 `{ data: [ticket], meta }` | 401, 422 |
| GET | `/api/v1/tickets/:ticketId` | the attendee; organizer/staff of the club | 200 `{ data: ticket }` | 404 for anyone else |
| DELETE | `/api/v1/tickets/:ticketId` | the attendee; organizer of the club | 204 (idempotent; promotes the first waitlisted) | 403 (staff), 404, 409 `TICKET_ALREADY_USED` |
| GET | `/api/v1/events/:eventId/dashboard` | organizer of the event's club (not staff, no admin bypass) | 200 `{ data: dashboard }` | 401, 403, 404, 422 |

`dashboard` (Member 3, `api/src/modules/dashboard`, one `$facet` aggregation
on `tickets`) = `{ eventId, title, status, startsAt, capacity, confirmed,
waitlisted, cancelled, checkedIn, seatsLeft, attendanceRate,
registrationsPerDay: [{ date: 'YYYY-MM-DD' (UTC), count }] }`;
`attendanceRate` = `checkedIn / confirmed`, `null` while nobody is confirmed.

`event` = `{ id, clubId, title, description, location, startsAt, endsAt,
capacity, confirmedCount, seatsLeft, status, createdAt }` (`capacity`/`seatsLeft`
`null` = unlimited). `ticket` = `{ id, eventId, clubId, status,
waitlistPosition, createdAt, confirmedAt, cancelledAt, checkedInAt }`.

`club` = `{ id, name, description, contactEmail, status, createdAt, myRole }`
(`myRole`: `organizer`, `staff` or `null`). `membership` =
`{ user: { id, name, email }, role, createdAt }`.
