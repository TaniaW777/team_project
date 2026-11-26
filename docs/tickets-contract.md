# Ticket integration contract (Members 2 and 4)

Status: **PROPOSED** (ADR-037). **Member 2's side is implemented** (ADR-038):
`api/src/modules/events`, `api/src/modules/tickets`, including
`claimTicketForCheckIn` / `getTicketForCheckIn`. Implementation choices for
open items: events are created with `POST /events` (`clubId` in the body);
cancellation is allowed until check-in, by the attendee or an organizer of
the club, with no deadline (TD6, conservative default to confirm); a cancelled
event closes registration but keeps its tickets (Member 4 should refuse
check-in on a cancelled event). Bridges registration / capacity / waiting list
(Member 2) and signed QR / check-in / offline outbox (Member 4). Builds on
[api-conventions.md](api-conventions.md), [authorization.md](authorization.md)
(`assertClubRole`, transactions pattern) and the T8 server rules: places never
oversold, waiting list promoted in order, QR signed and verified by the server,
a ticket checked in only once. Items marked **[TEAM]** need agreement (§8).

## 1. Ownership in one table

| Concern | Owner | Writes |
|---------|-------|--------|
| Event (capacity, counters), registration, cancellation, waiting list, promotion | **M2** | `events`, `tickets` (all fields) |
| Ticket read endpoints for attendees and organizers | **M2** | — |
| QR signing and verification, QR endpoint | **M4** | — (stateless) |
| Check-in (online + offline sync), attendance list | **M4** | `checkins`; `tickets.checkedInAt` **only through M2's `claimTicketForCheckIn`** (§5) |
| Ticket screens / scanner UI | M3 / M4 | — |

## 2. Data model

### `tickets` (M2) - one document per (event, attendee), ever

| Field | Type | Meaning / rule |
|-------|------|----------------|
| `event` | ObjectId → Event | required, immutable |
| `club` | ObjectId → Club | copied from the event at creation, immutable; lets M4 call `assertClubRole(actor, ticket.club, ...)` without loading the event |
| `attendee` | ObjectId → User | from `currentActor(req)` only, never from the body |
| `status` | `waitlisted` \| `confirmed` \| `cancelled` | see §3 |
| `waitlistSeq` | Number \| null | strictly increasing per event, assigned when (re)entering the waiting list; promotion order = ascending `waitlistSeq` |
| `confirmedAt`, `promotedAt`, `cancelledAt` | Date \| null | audit |
| `checkedInAt` | Date \| null | set **once**, by the check-in claim (§5); never cleared |
| `createdAt`, `updatedAt` | timestamps | |

Indexes: `{ event, attendee }` **unique** (re-registering after a cancellation
reuses the same document); `{ event, status, waitlistSeq }` (promotion,
dashboard counts); `{ attendee, createdAt: -1 }` (`/tickets/me`).

### `events` fields M4 and M3 rely on (M2 defines the rest)

`club`, `status` (`published` / `cancelled` ...), `startsAt`, `endsAt`,
`capacity` (integer ≥ 1, or `null` = unlimited), `confirmedCount`,
`waitlistCounter` (source of `waitlistSeq`).

### `checkins` (M4)

| Field | Meaning |
|-------|---------|
| `ticket` | **unique**: second guard against double check-in |
| `event`, `club` | copied from the ticket |
| `staff` | actor id who scanned (from the token, never from the body) |
| `idempotencyKey` | client-generated UUID v4 per scan, **unique** |
| `source` | `online` \| `offline` |
| `scannedAt` | device time (informational, never trusted for ordering) |
| `checkedInAt` | server time (authoritative) |

Indexes: `{ ticket }` unique, `{ idempotencyKey }` unique, `{ event, checkedInAt }`.

## 3. Lifecycle

```
register ──(seat free)──► confirmed ──scan──► confirmed + checkedInAt (final)
    │                        │  ▲
    └─(full)─► waitlisted ───┘  │ promotion (lowest waitlistSeq first)
                  │             │
   cancel ◄───────┴─────────────┘   cancelled ──register again──► waitlisted/confirmed (same document)
```

| Transition | Rule (server-side, M2 unless noted) |
|-----------|-------------------------------------|
| register | event `published` and not ended; `confirmed` if `confirmedCount < capacity`, else `waitlisted` with next `waitlistSeq`. Already `waitlisted`/`confirmed` → **200** with the existing ticket (desired state, like `addMember`). |
| cancel `confirmed` | allowed only if `checkedInAt == null`; frees a seat → promote the first waitlisted ticket **in the same transaction** |
| cancel `waitlisted` | always allowed while the event is open |
| promotion | also when an organizer raises `capacity` (promote up to the new free seats, same transaction) |
| check-in (M4) | only `confirmed` with `checkedInAt == null` |

### Invariants

- **I1** `confirmedCount` = number of `confirmed` tickets ≤ `capacity`.
- **I2** one ticket document per (event, attendee) (unique index).
- **I3** a ticket is checked in at most once (`checkedInAt` claim + unique `checkins.ticket`).
- **I4** promotion strictly by ascending `waitlistSeq`.
- **I5** a checked-in ticket cannot be cancelled; a cancelled/waitlisted ticket cannot be checked in.

### Concurrency (reuses ADR-027/028)

- **Seats (I1, I4):** register, cancel, promote and capacity changes run in one
  transaction whose **first write is on the event document** (the shared
  write: `$inc` on `confirmedCount` / `waitlistCounter`), exactly like
  `membershipVersion` for clubs. Counts are read after it, in the transaction.
  Use the bounded runner (`runTransaction` in `api/src/modules/clubs/club-transaction.ts`;
  409 `CONCURRENT_UPDATE`, 503 `TRANSACTION_OUTCOME_UNKNOWN`).
- **Check-in vs cancel (I3, I5):** both are **conditional single-document
  updates on the ticket**, so MongoDB serialises them:
  cancel = `{ _id, status: 'confirmed', checkedInAt: null } → status: cancelled`;
  claim = `{ _id, event, status: 'confirmed', checkedInAt: null } → checkedInAt: now`.
  Exactly one wins.
- Required tests (each side): concurrent registrations on the last seat;
  concurrent cancel + promotion order; two concurrent scans of one ticket;
  cancel racing a scan.

## 4. QR codes (M4)

**Recommended [TEAM-QR]: Ed25519-signed JWT** (`jose`, `alg: EdDSA`), checked
locally with the installed `jose`: signs, verifies, rejects a tampered token,
public key exportable as PEM, token ≈ 290 characters.

| Item | Value |
|------|-------|
| Header | `alg: EdDSA`, `typ: eventpass-ticket+jwt` |
| Claims | `iss: eventpass-api`, `tid` (ticket id), `eid` (event id), `iat`, `exp` = event `endsAt` + grace **[TEAM]** |
| Not in the payload | names, e-mails, status (status is always read server-side) |
| Keys | `QR_SIGNING_PRIVATE_KEY` (PKCS8 PEM, platform secret, **separate from** `JWT_ACCESS_SECRET`), validated in `env.ts` when M4 adds it |
| Why asymmetric | the staff app can **pre-check** a QR offline with the public key without holding any secret; the server stays the only judge |

The token is **not stored**: it is signed on demand. A leaked QR is useless
once the ticket is cancelled or checked in, because verification always reads
the ticket.

**Server verification (in this order, first failure wins):** signature,
`alg`, `iss`, `typ`, `exp` → `tid`/`eid` well-formed → `eid` equals the event
being scanned → ticket exists and `ticket.event == eid` → caller authorised
(`assertClubRole(actor, ticket.club, ['organizer','staff'])`) → status
`confirmed` → atomic claim.

## 5. Module boundary (code)

M2 exports from `tickets` (the only code that writes tickets):

```ts
// Inside M4's check-in transaction: conditional update, returns the ticket
// (with checkedInAt) or null if it is not confirmed / already checked in.
claimTicketForCheckIn(ticketId: string, eventId: string, at: Date,
                      session: ClientSession): Promise<TicketClaim | null>
getTicketForCheckIn(ticketId: string): Promise<{ id; event; club; status; checkedInAt } | null>
```

M4 exports from `checkins`: `signTicketQr(ticket)` / `verifyTicketQr(token)`.
M2 never imports M4 code; M4 imports only the two functions above from M2.

## 6. API contracts (base `/api/v1`, Bearer token on every route)

Error envelope and existing codes: [api-conventions.md](api-conventions.md).
New codes below must be added there when implemented **[TEAM-CODES]**.

### Member 2

| Method | Path | Who | Success | Main errors |
|--------|------|-----|---------|-------------|
| POST | `/events/:eventId/registrations` | any signed-in user | **201** new ticket (`confirmed` or `waitlisted`); **200** already registered | 404 event, 409 `EVENT_CLOSED`, 409/503 transaction codes |
| GET | `/tickets/me?page&limit&status` | attendee | 200 `{ data: [ticket], meta }` | — |
| GET | `/tickets/:ticketId` | the attendee; organizer/staff of `ticket.club` | 200 `{ data: ticket }` | **404** for anyone else (BOLA) |
| DELETE | `/tickets/:ticketId` | the attendee; organizer of `ticket.club` | **204** (cancelled; promotion done) | 404, 409 `TICKET_ALREADY_USED` |

`ticket` = `{ id, eventId, clubId, status, waitlistPosition | null,
createdAt, confirmedAt, cancelledAt, checkedInAt }` (`waitlistPosition`
computed from `waitlistSeq` for the attendee's own ticket).

### Member 4

| Method | Path | Who | Success | Main errors |
|--------|------|-----|---------|-------------|
| GET | `/tickets/:ticketId/qr` | the attendee, ticket `confirmed` | 200 `{ data: { qrToken } }` | 404 (other user), 409 `TICKET_NOT_CONFIRMED` |
| POST | `/events/:eventId/check-ins` | organizer/staff of the event's club | **201** `{ data: { result: 'accepted', ticketId, checkedInAt } }`; **200** `result: 'duplicate'` (same `idempotencyKey` replayed) | 422 `INVALID_QR`, 409 `ALREADY_CHECKED_IN` (details `{ checkedInAt }`), 409 `TICKET_NOT_CONFIRMED`, 422 `WRONG_EVENT`, 403 |
| POST | `/check-ins/sync` | staff (per item: club of the ticket) | **200** `{ data: [ { idempotencyKey, result, reason?, checkedInAt? } ] }` | 422 if the batch itself is invalid (max 100 items) |
| GET | `/events/:eventId/check-ins?page&limit` | organizer (and staff?) **[TEAM]** | 200 `{ data: [checkIn], meta }` | 403, 404 |
| GET | `/events/:eventId/check-in-bundle` | staff of the club | 200 `{ data: { publicKey, generatedAt, tickets: [ { id, status } ] } }` | 403 |

Online body: `{ qrToken, idempotencyKey }`. Sync item:
`{ idempotencyKey, qrToken, eventId, scannedAt }`.

**Idempotency:** `idempotencyKey` is a UUID v4 created by the scanner **once
per scan** and reused on every retry of that scan. Same key + same ticket →
the stored result (`duplicate`); same key with a different QR → 422
`IDEMPOTENCY_KEY_REUSED`. This makes 409 `CONCURRENT_UPDATE` and 503
`TRANSACTION_OUTCOME_UNKNOWN` safe to retry.

## 7. Offline outbox and reconciliation (M4)

| Server `result` | Device state | Action |
|-----------------|--------------|--------|
| `accepted`, `duplicate` | `synced` | done |
| `already_checked_in` (ticket checked in by another device/scan) | `conflict` | show "already used at `checkedInAt`" |
| `rejected` + `reason` (`INVALID_QR`, `TICKET_NOT_CONFIRMED`, `WRONG_EVENT`, `FORBIDDEN`) | `rejected` | show the reason |
| network error, 5xx, 409 `CONCURRENT_UPDATE`, 503 `TRANSACTION_OUTCOME_UNKNOWN` | stays `pending_sync` | retry later with the **same** key, bounded backoff |

- The server decides by **arrival order**, never by `scannedAt` (device clocks
  are not trusted); `scannedAt` is stored for audit.
- Authorisation is checked **at sync time** with current memberships: a staff
  member removed since the scan gets `rejected / FORBIDDEN`.
- The offline bundle is a **pre-check only** (stale by definition): a ticket
  cancelled after download is still rejected at sync.
- Bundle privacy: ticket ids and statuses only, no names or e-mails
  **[TEAM]** (if names are needed at the door, first name only).

## 8. Decisions for the team

| # | Decision | Recommendation |
|---|----------|----------------|
| TD1 | M2 creates the ticket at registration; waiting list = tickets with `status: waitlisted` (no separate collection) | yes (Team Plan §4) |
| TD2 | One ticket document per (event, attendee), reused after cancellation | yes (unique index, no partial index needed) |
| TD3 [TEAM-QR] | QR = Ed25519-signed JWT, private key in a platform secret, public key for offline pre-check | yes |
| TD4 | QR served by M4 at `/tickets/:ticketId/qr` (M2's ticket DTO has no QR) | yes (no M2 → M4 code dependency) |
| TD5 | `checkedInAt` written only via M2's `claimTicketForCheckIn`, called by M4 | yes (one writer per collection, like memberships) |
| TD6 | Cancellation rules: deadline before `startsAt`? organizer may cancel any ticket? | M2 decides |
| TD7 | QR `exp` grace after `endsAt` | e.g. 12 h |
| TD8 | Who lists check-ins: organizer only, or staff too | organizer + staff |
| TD9 [TEAM-CODES] | New error codes: `EVENT_CLOSED`, `TICKET_ALREADY_USED`, `TICKET_NOT_CONFIRMED`, `ALREADY_CHECKED_IN`, `INVALID_QR`, `WRONG_EVENT`, `IDEMPOTENCY_KEY_REUSED` | add to api-conventions.md when implemented |
| D3 / D4 | Admin has no event/check-in bypass; door staff = club `staff` membership | assumed by this contract (authorization.md §7) |
