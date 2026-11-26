# Authorization, clubs and memberships

Owner: Member 1. Audience: every member, in particular Members 2 (events)
and 4 (check-in), whose modules build on this contract.

## 1. Who is calling (the actor)

| Step | Where | Rule |
|------|-------|------|
| Identity | `authenticate` (lab) | `req.userId` = `sub` of the verified access token |
| Global role | `loadActor` (`src/shared/authorize.ts`) | Reads `{ id, role }` from the **database** (one lookup by `_id`); a deleted user gets 401 |
| In controllers | `currentActor(req)` | The only source of the actor. Any `role`, `userId` or `actor` in a body, query or header is ignored (Zod drops it) |

Protect a router with `router.use(authenticate, loadActor)`.

**Global admin vs club roles are separate.** The global role (`user` /
`admin`) lives on the user and is checked with `requireRole('admin')` on routes
or `actor.role === 'admin'` in services. Club roles (`organizer` / `staff`)
live in `clubmemberships` and are checked with `assertClubRole` or, for
membership changes, inside the membership transaction. Neither is ever derived
from the other.

**Documented limitation (ADR-026).** The global role is read once, by
`loadActor`, at the start of the request. If an admin is demoted while one of
their requests is in flight, that single request still runs with admin rights.
Admins are promoted/demoted only by hand (`promote-admin`), so this is rare.
Club roles have no such gap for membership changes and club edits: they are
re-read inside the club transaction. `assertClubRole` (a read-only check used
by other modules) does not take part in that transaction: see §6.

## 2. Permission matrix

| Capability | Organizer of the club | Staff of the club | Other signed-in user | Platform admin |
|------------|----------------------|-------------------|----------------------|----------------|
| See an active club / list active clubs | yes | yes | yes | yes |
| See an archived club | yes | yes | no (404) | yes |
| Create a club | no | no | no | **yes (only)** |
| Edit name, description, contact | yes | no (403) | no (403) | yes |
| Archive (`DELETE`) / restore (`PATCH status`) | no | no | no | **yes (only)** |
| List members (with e-mails) | yes | no (403) | no (403) | yes |
| Add a member, change a role | yes | no (403) | no (403) | yes |
| Remove a member | yes | only themselves (leave) | no (403) | yes |
| **Events of the club** (Member 2) | create, edit, cancel, dashboard | no | browse, register | not by default (D3) |
| **Check-in for the club's events** (Member 4) | yes | yes | no | not by default (D3) |

Rights in one club never apply to another club.

**403 or 404 (ADR-024).** 404 when the caller may not know the object exists
(a missing club, an archived club for a non-member). 403 when the object is
visible but the action is not allowed.

## 3. The last-organizer rule

*No membership operation may take a club's organizer count from 1 or more to
0.* It applies to everyone, **admins included**. A new club starts with 0
organizers (the admin appoints the first one). To replace a last organizer:
promote or add the new one first, then remove the old one.

### How it is guaranteed (ADR-027)

Every membership change (add, change role, remove; any role) runs in **one
MongoDB transaction** (`runClubMembershipTransaction`):

1. **Shared write first:** `$inc: { membershipVersion: 1 }` on the club
   document. It also returns the club's current `status`.
2. The actor's own club role, read **inside** the transaction.
3. Archived check, permission check.
4. Target membership, organizer count, rule checks.
5. One membership write.
6. Commit. The HTTP response is sent only after the commit.

Two changes to the same club both write the same club document. MongoDB never
lets two transactions commit conflicting writes to one document: the second
gets `WriteConflict` (`TransientTransactionError`), is aborted and retried, and
its retry reads a snapshot that includes the first change. Every check
therefore sees all earlier committed changes. Without the shared write, two
transactions deleting *different* memberships would both count 2 and both
commit (write skew) - `test/club-transaction.test.ts` demonstrates exactly that.

Archiving / restoring and editing the club write the same document, so they are
coordinated with membership changes automatically: an archive committed before
a membership transaction makes it retry and see `archived` (409); an archive
arriving during a transaction waits for it.

**Club edits (`PATCH /clubs/:clubId`) run in the same transaction** (ADR-034):
the organizer check is read after the shared write, so an organizer demoted or
removed at the same moment cannot edit on stale rights (the edit gets 403 if
the demotion committed first).

**Memberships must only be written through `membership.service.ts`.** Any other
write path bypasses the rule (manual database edits are out of scope).

## 4. Errors of membership changes and what clients do

| Status | `code` | Meaning | Client action |
|--------|--------|---------|---------------|
| 403 | `FORBIDDEN` | Not allowed in this club | Show the message |
| 404 | `NOT_FOUND` | Club hidden/missing, user unknown, or not a member | Show / reload |
| 409 | `CONFLICT` | Business rule: last organizer, archived club, member with another role | Show the message |
| 409 | `CONCURRENT_UPDATE` | Too many simultaneous changes or time budget used up; **nothing was applied** | Retry |
| 503 | `TRANSACTION_OUTCOME_UNKNOWN` | The commit **may or may not** have been applied | **Reload the members, then retry only if the change is not visible** |

**Safe retry (desired state).** Each operation compares the request with the
current state, so a retry after an uncertain outcome never doubles an effect:

| Retried operation | If the first attempt did apply |
|-------------------|-------------------------------|
| Add (same role) | 200 with the existing membership (desired state reached) |
| Add (another role) | 409 `CONFLICT`, details `{ role }`: **not** treated as success |
| Promote / demote to the role it already has | 200 unchanged |
| Remove | 404 "Not a member of this club": the desired state is reached |

## 5. Retry policy and time limits (ADR-028)

| Setting | Value |
|---------|-------|
| Whole-transaction attempts | 4, only after `TransientTransactionError` |
| Wait between attempts | random(0, min(100 ms, 10 ms × 2^(n-1))) |
| Commit-only retries | Only after `UnknownTransactionCommitResult`; 3 commit attempts in total; waits ≤ 200 ms; the body is never re-run for an unknown result |
| Per-operation limit | `maxTimeMS = min(2000 ms, time left)` on every read and findAndModify in the transaction |
| Commit limit | `maxCommitTimeMS = min(2000 ms, time left when the attempt starts)` |
| Overall budget | 5 s from the start of the helper, checked before each attempt, each operation, each wait and each commit retry |
| Not retried | Business errors (403/404/409), duplicate keys (→ 409), other errors (→ 500) |

**What the deadline really guarantees (honest limits).** The helper never
starts an attempt, an operation, a wait or a commit retry after the 5 s budget.
Each read/findAndModify is cancelled **by the server** when its `maxTimeMS`
expires, and the commit by `maxCommitTimeMS`, so no database work is left
running in the background. Limits: (1) the membership **insert** (add member)
takes no `maxTimeMS`; a conflicting insert fails immediately, but a slow insert
is bounded only by the transaction's server lifetime (60 s by default);
(2) a **network** stall is not bounded by server-side limits (no socket timeout
is configured; server selection is bounded at 5 s by the connection string);
(3) one operation may start just before the deadline and run up to its own
limit. Worst case in practice: about 5 s plus one operation (≤ 2 s).
There is no `Promise.race` timeout that would leave work running.
**This is therefore not a hard 5 s limit**, and the documentation does not
claim one.

**What has been demonstrated.** The decision logic (which errors are retried,
attempt and commit counts, wait caps, budget checks, shrinking `maxTimeMS` /
`maxCommitTimeMS`) by unit tests with a fake clock
(`test/transaction-runner.test.ts`). Against the real test replica set:
a real `WriteConflict` retried to success; 4 real conflicting attempts ending
in 409 `CONCURRENT_UPDATE` with nothing applied (about 1 s including setup);
an injected unknown commit retried once (commit only) and an always-unknown
commit ending in 503. Not demonstrated: server-side cancellation by
`maxTimeMS` under a genuinely slow operation, and network stalls.

## 6. Contract for Members 2 and 4: `assertClubRole`

```ts
import { assertClubRole } from '../clubs/membership.service.ts';

type Actor = { id: string; role: 'user' | 'admin' };  // ONLY from currentActor(req)
type ClubRole = 'organizer' | 'staff';

assertClubRole(
  actor: Actor,
  clubId: string,
  allowed: readonly ClubRole[],          // non-empty
  options?: { allowAdmin?: boolean;      // default false
              allowArchived?: boolean }  // default false
): Promise<{
  club: { id: string; name: string; status: 'active' | 'archived' };
  role: ClubRole | null;                 // the actor's role in this club
  viaAdmin: boolean;                     // true if allowed only because admin
}>
```

Validate `clubId` with `objectIdSchema` first (422); an invalid id that still
reaches the function gives 404, never 500.

| # | Condition (first failure wins) | Result |
|---|--------------------------------|--------|
| 1 | Club does not exist | 404 `NOT_FOUND` |
| 2 | Archived, actor neither member nor admin | 404 `NOT_FOUND` (hidden) |
| 3 | Actor's club role in `allowed` | allowed (`viaAdmin: false`) |
| 3b | else `allowAdmin` and actor is admin | allowed (`viaAdmin: true`) |
| 3c | else | 403 `FORBIDDEN` |
| 4 | Archived and `!allowArchived` | 409 `CONFLICT` "Club is archived" |

It only reads (2 indexed queries), takes no lock, changes nothing. It is an
authorization check, not a lock: a role removed a moment later does not cancel
an operation already in progress. Contract tests: `test/authorize.test.ts`.

| Action | Call |
|--------|------|
| Create / edit / cancel an event; dashboard (Member 2) | `assertClubRole(actor, clubId, ['organizer'])` |
| Read an archived club's history | `..., ['organizer'], { allowArchived: true }` |
| Check in a ticket (Member 4) | `assertClubRole(actor, event.club, ['organizer', 'staff'])` |
| Admin on events | not allowed by default (team decision D3); `{ allowAdmin: true }` only if the team agrees and documents it |

**Also available.** `authenticate`, `loadActor`, `requireRole`, `currentActor`
(`src/shared/`); `objectIdSchema`, `paginationSchema` (page, limit ≤ 100),
`pageMeta()`, `normalizedEmailSchema` (`src/shared/validation.ts`); `CLUB_ROLES`
and the `Club` model for references (`club: { type: ObjectId, ref: 'Club' }`).
Transactions are available (replica set everywhere); reuse the pattern of
`club-transaction.ts` if your rules need one (shared write on the document that
must serialise the operations, bounded retries).

**Not provided here.** Event, ticket or check-in routes; per-event staff
assignment (Member 4 may add it on top of this contract if the team decides).

## 7. Agreements still to confirm with the team

- D3: admins do not act on events/check-ins without a membership (Members 2, 4).
- D4: door staff are assigned per club (Member 4).
- Members 2-4: local setup now requires the Docker database
  ([development-database.md](development-database.md)).
