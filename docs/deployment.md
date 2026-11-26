# Deployment (A14) and release (F14)

Status: **prepared, not deployed.** Nothing below has been run against Atlas or
a hosting platform; each step needs the team lead's go-ahead.

## 1. API on a hosting platform (Render, Railway, Fly.io, ...)

| Setting | Value |
|---------|-------|
| Root directory | `api` |
| Node version | 24 or newer (`engines` in `package.json`) |
| Build command | `npm ci` |
| Start command | `npm start` (reads `.env` only if present; on the platform the variables come from its settings) |
| Health check | `GET /health` → 200 `{ "status": "ok" }` |

Environment variables (platform secret settings, never in a file):

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | usually injected by the platform |
| `MONGO_URI` | Atlas `mongodb+srv://<user>:<password>@<cluster>/eventpass?retryWrites=true&w=majority` |
| `JWT_ACCESS_SECRET` | a NEW random secret (≥ 32 chars): `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL_DAYS` | `15m` / `30` |
| `TRUST_PROXY` | `1` (one load balancer in front of the API; check the platform docs) |
| `CORS_ORIGIN` | the web origin if a web build is deployed; otherwise leave a specific value, not `*` (the mobile app is not affected by CORS) |

The API refuses to start if a variable is invalid or if MongoDB is not a
replica set with a writable primary (ADR-029); the platform logs show one
clear line in that case.

**HTTPS:** platforms terminate TLS; the app's release build only talks HTTPS
(cleartext is allowed in debug Android builds only).

## 2. MongoDB Atlas

1. Create a cluster (the free tier is a 3-node replica set: transactions OK;
   confirm on the chosen tier with the first membership change).
2. Database user with `readWrite` on `eventpass` only; strong generated password.
3. Network access: the platform's outbound IPs if it publishes fixed ones;
   otherwise `0.0.0.0/0` with the strong password (documented trade-off).
4. Copy the `mongodb+srv://` string into the platform's `MONGO_URI`.
5. Indexes are created by Mongoose on startup (`autoIndex`).

## 3. After the first deployment (smoke test)

1. `GET https://<host>/health` → 200.
2. `api/requests.http` with `@host = https://<host>`: register, login, `/auth/me`,
   refresh, logout.
3. Create the admin: register the account, then from a trusted machine with
   the production `MONGO_URI` in the shell:
   `NODE_ENV=production npm run promote-admin -- admin@example.com --confirm`.
4. Create a club, appoint an organizer (requests in `requests.http`).
5. Watch memory: Argon2id uses up to ~256 MB at peak (ADR-016); on a 512 MB
   instance consider the documented OWASP parameters before raising limits.

## 4. Flutter release build (F14)

```powershell
cd app
flutter build apk --release --dart-define=API_BASE_URL=https://<host>/api/v1
```

Prerequisites still open on the build machine: **Android SDK licenses**
(`flutter doctor --android-licenses`, needs approval) and a **release signing
key** (the template signs release builds with the debug key: acceptable for a
course demo, not for a store). Install the APK on a real phone and repeat the
smoke test from the app.

## 5. What can be done now vs. what needs approval

| Now (no external change) | Needs approval / an account |
|--------------------------|-----------------------------|
| Code and docs are ready; `npm start` works without `.env` (tested) | Creating the Atlas cluster and user |
| `TRUST_PROXY`, `CORS_ORIGIN`, secrets are configuration only | Creating the hosting service and its secrets |
| | Accepting Android SDK licenses; building and installing the APK |
| | Adding the CI workflow (Member 4) |
