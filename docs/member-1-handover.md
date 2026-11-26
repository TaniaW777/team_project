# EventPass — Member 1 Foundation & Integration Handover

**Purpose:** Help Members 2, 3 and 4 build on the shared work without duplicating foundations or guessing interfaces.

**Status:** This document reflects implementation and test results reported by the coding agent; it is not an independent audit. The work is on the branch `feature/member1-foundation`; it has not yet been staged or committed, and it has not been merged into `main`.

## 1. Shared backend foundation

The backend foundation is in `api/` and uses Node.js 24+, Express 5, TypeScript, Mongoose 9 and the existing layered architecture.

Reported completed foundation:
- Environment validation and application startup conventions.
- Error handling, logging, security middleware and API conventions.
- Authentication and session lifecycle: register, login, refresh-token rotation, logout and authenticated identity.
- User roles and authorization middleware.
- Clubs, memberships, club roles and shared club authorization checks.
- Test database safety conventions and replica-set transaction test infrastructure.

Relevant documents include:
- `docs/integration.md`
- `docs/api-conventions.md`
- `docs/decisions.md`
- `docs/traceability.md`
- `api/README.md`

## 2. Events and tickets — Member 2 deliverable

The events and tickets modules have now been reported implemented and tested against the existing test database.

### Events
- Event creation, editing, cancellation and listing.
- Club-organizer authorization for event governance.
- Event filters and pagination.
- Capacity changes constrained by confirmed registrations.
- Cancelling an event closes registration while retaining ticket records.

### Registration and tickets
- One ticket per event/attendee, reusing the ticket after cancellation.
- Registration is confirmed if capacity is available and no queue precedence applies; otherwise it is waitlisted.
- Cancellation and promotion are coordinated transactionally.
- Promotion follows waitlist sequence.
- Ticket authorization is scoped to the attendee or permitted club roles.
- Member 2 exposes the provisional check-in integration functions `claimTicketForCheckIn` and `getTicketForCheckIn`.

### Reported endpoints
- `GET /api/v1/events`
- `GET /api/v1/events/:eventId`
- `POST /api/v1/events` — club organizer
- `PATCH /api/v1/events/:eventId` — club organizer
- `DELETE /api/v1/events/:eventId` — club organizer
- `POST /api/v1/events/:eventId/registrations`
- `GET /api/v1/tickets/me`
- `GET /api/v1/tickets/:ticketId`
- `DELETE /api/v1/tickets/:ticketId`

### Reported verification
- Full API test suite: 173/173 passed.
- Type checking passed.
- Concurrency tests included capacity, simultaneous duplicate registration, cancellation/promotion and check-in-versus-cancellation races.
- These are agent-reported results, not independently rerun in this handover.

The implementation is recorded as ADR-038. Refer to the actual module source and documentation for exact request/response schemas and details.

## 3. Flutter foundation — Member 3 should reuse

The Flutter app is under `app/`. The shared foundation and authentication feature were reported completed.

Existing shared infrastructure includes:
- Dio client and API/error mapping.
- Secure token storage and single-flight refresh handling.
- Dependency injection.
- `go_router` auth guard.
- BLoC/Cubit conventions.
- Auth domain/data/presentation layers and login/register UI.
- Configuration through `--dart-define=API_BASE_URL=...`.

A signed-in `/home` placeholder was previously used pending feature screens. Member 3 should extend the existing app structure and replace/extend placeholders rather than recreate app startup, auth, DI, routing, API client or storage.

## 4. Member 4 — QR, check-in and offline integration

Member 4's remaining scope:
- QR signing and verification.
- QR endpoint.
- Check-in endpoint and check-ins collection.
- Offline check-in queue/sync and reconciliation.
- Attendance list and offline bundle.
- CI/quality coordination where assigned.

The proposed interface in `docs/tickets-contract.md` (ADR-037 Proposed) and the Member 2 implementation provide the starting boundary. Member 4 should coordinate open decisions with Member 2 before implementing against them.

Key functions supplied by Member 2:
- `claimTicketForCheckIn`
- `getTicketForCheckIn`

Member 2 owns ticket lifecycle and ticket writes; Member 4 should not independently implement a second ticket lifecycle.

## 5. CI and testing

A CI workflow is prepared at `.github/workflows/ci.yml`, but its first GitHub Actions execution has not yet been confirmed.

Reported checks in the local project:
- API typecheck and test suite.
- Flutter format, analyze and unit tests.
- API-dependent Flutter integration tests require configured API access and are not run as part of the ordinary no-API test job.

Do not treat locally validated workflow structure as proof that GitHub Actions has run successfully.

## 6. Deployment and device verification still pending

- First actual GitHub Actions run and required-check configuration.
- Integration of Members 2, 3 and 4 deliverables.
- Backend hosting and MongoDB Atlas setup, with approval.
- Deployment secrets, HTTPS, CORS and proxy configuration.
- Android device/emulator verification; SDK licensing and device setup remain outstanding.
- End-to-end verification of registration, ticket display, QR scan, check-in, offline sync and authorization.
- Release artifact preparation.

## 7. Decisions and safeguards

- Follow `docs/integration.md` and `docs/api-conventions.md`.
- Reuse existing auth and club-role authorization; avoid duplicating or bypassing them.
- Respect D3: admins do not automatically gain event/check-in powers through admin role alone, subject to team confirmation.
- Respect D4: door-staff permissions should be scoped to appropriate club staff memberships, subject to team confirmation.
- ADR-037 remains a proposed ticket integration contract; ADR-038 records the events/tickets implementation and implementation choices.
- Do not assume deployment, Android testing or the first GitHub Actions run is complete.

## 8. Recommended immediate team actions

1. Share this handover with Members 2, 3 and 4.
2. Member 2 and Member 4 confirm the ticket/check-in interface and remaining contract decisions.
3. Member 3 extends the existing Flutter foundation to the events/tickets UI.
4. Member 4 implements QR/check-in/offline work against the agreed contract.
5. Integrate and run the actual CI and end-to-end checks.
6. Deploy only after the necessary approvals and prerequisites are available.
