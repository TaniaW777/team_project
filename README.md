# EventPass

Campus clubs publish events; students discover them, register and receive a
QR ticket that door staff scan at the entrance. The server guarantees that
places are never oversold, waiting lists are promoted in order, and each
signed ticket is checked in only once.

Advanced Mobile Development, project T8. Monorepo: Node.js API + Flutter app.

## Repository

| Folder | Content |
|--------|---------|
| [`api/`](api/) | REST API: Node.js 24, Express 5, MongoDB (Mongoose), TypeScript |
| [`app/`](app/) | Flutter app (BLoC, Clean Architecture): shared foundation + authentication |
| [`docs/`](docs/) | Decisions, API conventions, requirement traceability, design and report |
| [`.github/workflows/`](.github/workflows/ci.yml) | CI: API typecheck + tests, app format + analyze + tests, on every pull request |

## Team

| Member | Role |
|--------|------|
| Member 1 | Team Lead + Authentication / Foundations |
| Member 2 | API Lead + Events / Registration / Capacity |
| Member 3 | App Lead + Product / UX / Tickets / Dashboard |
| Member 4 | Quality Lead + QR / Check-in / Offline / CI |

## Run locally

API: see [api/README.md](api/README.md) (Node.js 24 + Docker for MongoDB, about five minutes).
App: see [app/README.md](app/README.md) (`flutter run --dart-define=API_BASE_URL=...`).

## Documentation

- [Technical decisions (ADR log)](docs/decisions.md)
- [API conventions](docs/api-conventions.md): `/api/v1`, envelopes, status codes, pagination
- [Authentication and sessions](docs/authentication.md): tokens, rotation, logout, security choices
- [Authorization, clubs and memberships](docs/authorization.md): permissions, last-organizer rule, `assertClubRole` contract
- [Development and test database](docs/development-database.md): Docker MongoDB setup for Windows and Linux
- [Integration status and handover](docs/integration.md): what exists, owners, contracts, CI
- [Ticket integration contract](docs/tickets-contract.md): tickets, waiting list, QR, check-in, offline sync (proposed)
- [Deployment and release](docs/deployment.md): hosting, Atlas, secrets, APK
- [Requirement traceability](docs/traceability.md)

## Links

Deployed API, release APK and demo video: added at the corresponding milestones.
