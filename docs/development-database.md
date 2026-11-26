# Development and test database (Windows and Linux)

EventPass needs **MongoDB 8 running as a replica set**: membership changes use
transactions ([ADR-027](decisions.md#adr-027-membership-changes-use-transactions-with-a-shared-club-write)),
and MongoDB only supports transactions on a replica set. The team runs MongoDB
**in Docker**, with one Compose file (`api/docker-compose.yml`) that works the
same on Windows and Linux. Nobody needs to install or configure MongoDB, or
install `mongosh`, on their own machine.

> A MongoDB you may already have installed natively (for example on port
> 27017) is **not used and not touched**: the Docker databases listen on
> ports 27027 and 27028.

## What runs

| Container | Purpose | Address (your machine only) | Data |
|-----------|---------|-----------------------------|------|
| `mongo` | Development (`npm run dev`) | `127.0.0.1:27027`, database `eventpass_dev` | Named volume `eventpass_eventpass-mongo-data`: **kept** when containers stop |
| `mongo-test` | Automated tests (`npm test`) | `127.0.0.1:27028`, database `eventpass_test` | In memory (`tmpfs`): **wiped** whenever the container stops |

Both: image `mongo:8.0`, single-node replica set `rs0`, WiredTiger cache
limited to 0.25 GB each (about 600 MB of RAM for both). `mongo-test` also has
`enableTestCommands=1`, which lets the tests inject failures; the development
container never has it.

Ports are bound to `127.0.0.1`: nobody else on your network can reach your
databases. Each developer runs their own containers, so every local database
is independent; nothing is shared between teammates. (Atlas is used only for
the deployed API.)

**Verified** (Phase 3 verification round, Windows 11 + Docker Desktop
29.1.3 / Compose 2.40.3): both containers healthy with MongoDB 8.0.38,
replica set `rs0` with a writable primary, ports bound to `127.0.0.1` only,
test commands on `mongo-test` only, development data kept across a restart,
test data wiped across a restart (replica set re-initiated automatically).
The Linux path follows the same file and commands but has not been run yet.

## Prerequisites

| | Windows | Linux |
|-|---------|-------|
| Docker | [Docker Desktop](https://docs.docker.com/desktop/) with the WSL 2 backend | Docker Engine + the Compose plugin (`docker compose version` must work) |
| Running | Start Docker Desktop (whale icon "Engine running") | `sudo systemctl start docker`; add yourself to the `docker` group or use `sudo` |
| Node.js | 24 or newer | 24 or newer |

The first start downloads the `mongo:8.0` image (several hundred MB).

## Daily commands (run in `api/`)

| Command | What it does |
|---------|--------------|
| `npm run db:up` | `docker compose up -d --wait`: starts both containers and **returns only when both are healthy** (replica set ready, writable primary) |
| `npm run db:status` | `docker compose ps`: both should show `healthy` |
| `npm run db:down` | `docker compose down`: stops the containers. **Development data is kept** in the volume |

Then, as before: `npm run dev` (development) or `npm test` (tests).

## First-time setup

```powershell
cd api
npm install
copy .env.example .env              # Linux: cp .env.example .env
copy .env.test.example .env.test    # Linux: cp .env.test.example .env.test
# set JWT_ACCESS_SECRET in .env (command in the file)
npm run db:up
npm run dev                         # http://localhost:3000/health
```

## How the replica set is created and declared ready

Both containers share one **healthcheck** that runs inside the container with
the image's own `mongosh`, every 5 s:

1. `rs.status()`: if the replica set does not exist yet (`NotYetInitialized`),
   `rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] })`.
2. Healthy only when `db.hello().isWritablePrimary` is true.

It is **idempotent**: the first run creates the replica set, every later run
(container restart, existing volume) only checks it. `npm run db:up` waits for
`healthy` (up to about 20 s grace + 30 checks); if a container never becomes
healthy, the command fails and names it.

## Connection strings

| Use | `MONGO_URI` |
|-----|-------------|
| Development (`.env`) | `mongodb://127.0.0.1:27027/eventpass_dev?directConnection=true&serverSelectionTimeoutMS=5000` |
| Tests (`.env.test`) | `mongodb://127.0.0.1:27028/eventpass_test?directConnection=true&serverSelectionTimeoutMS=5000` |
| Atlas (deployment) | `mongodb+srv://<user>:<password>@<cluster-host>/eventpass?retryWrites=true&w=majority` - set only in the hosting platform's secret settings, never in a file |

- `directConnection=true`: the driver talks to the container directly and never
  tries to resolve the replica-set member name (`localhost:27017` inside the
  container), the classic Docker pitfall. Transactions work on this connection.
- `serverSelectionTimeoutMS=5000`: if the database is not running, the API fails
  within 5 s instead of 30 s.
- Atlas needs no `directConnection`: it is a multi-node replica set the driver
  discovers itself. The same code works unchanged.

## Development and test separation

- Different containers, ports and databases (`eventpass_dev` on 27027,
  `eventpass_test` on 27028).
- The test helpers refuse to run unless `NODE_ENV=test` **and** the database name
  ends with `_test` ([ADR-009](decisions.md#adr-009-lab-modification-stricter-test-database-guard)).
- Failure-injection tests additionally check that the server has
  `enableTestCommands` (only `mongo-test` has it) and skip otherwise.
- `npm run promote-admin` refuses `_test` databases and `NODE_ENV=test`.

## Resetting data (destructive)

> **WARNING:** `docker compose down -v` **permanently deletes your local
> development database** (the `eventpass_eventpass-mongo-data` volume). It does
> not affect teammates, Atlas, or any native MongoDB. There is deliberately no
> npm script for it.

```powershell
cd api
docker compose down -v     # deletes YOUR local development data
npm run db:up              # fresh, empty replica set
```

The test database needs no reset: it lives in memory and the tests drop it.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `docker: command not found` / not recognized | Docker is not installed: see Prerequisites |
| `Cannot connect to the Docker daemon` / `error during connect` | The engine is stopped: start Docker Desktop, or `sudo systemctl start docker` |
| `npm run db:up` fails, a container is `unhealthy` | `docker compose logs mongo` (or `mongo-test`) shows why |
| Port 27027 / 27028 already in use | Set `EVENTPASS_MONGO_PORT` / `EVENTPASS_MONGO_TEST_PORT` in your shell before `db:up`, and use the same port in `.env` / `.env.test` |
| API: `Cannot connect to MongoDB: the API will not start` with `MongoServerSelectionError` | Database not running: `npm run db:up`, then `npm run db:status` |
| API: `... is not a replica set` | `MONGO_URI` points at a plain (standalone) MongoDB, e.g. a native one on 27017: use the Docker address above |
| API: `... has no writable primary yet` | The container is still starting: wait for `healthy` (`npm run db:status`) |
| Tests stop before running with one of the messages above | Same causes: the tests need `mongo-test` (`npm run db:up`) |

## Without Docker (secondary options)

The Docker setup is the team standard. If you cannot run Docker:

1. **Your own free MongoDB Atlas cluster** (it is a replica set): use your own
   cluster and database names (`eventpass_dev`, `eventpass_test`); never the
   team's deployment cluster. Failure-injection tests are skipped there.
2. **A native replica set** configured by yourself on your machine
   (`replication.replSetName` + `rs.initiate`). Not supported by the team.

## CI (for Member 4)

The CI job reuses the same Compose file, so CI and laptops run the same database:

```yaml
- run: docker compose -f api/docker-compose.yml up -d --wait mongo-test
- run: cp api/.env.test.example api/.env.test
- run: npm ci && npm run typecheck && npm test
  working-directory: api
```

GitHub's Ubuntu runners ship Docker Compose v2. No service container or
third-party action is needed.

## Atlas (deployment) notes

- Every Atlas cluster is a replica set: transactions, the shared write and the
  startup check work without code changes. Verify transaction support on the
  chosen tier during deployment (A14) with one test call.
- `w: majority` adds a little latency per membership change on a 3-node cluster.
- Test commands are never enabled on Atlas; failure-injection tests only run on
  `mongo-test`.
- The Atlas IP access list must include the hosting platform.
