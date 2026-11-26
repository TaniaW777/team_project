# Authentication and sessions

How EventPass identifies users, keeps them signed in, and ends sessions.
Design source: the professor's lab (Lab 1 §1.5–1.9, Lab 2 §2.1, §2.5); EventPass
changes are listed in [decisions.md](decisions.md) (ADR-011 to ADR-021).

## Two tokens

| | Access token | Refresh token |
|--|--------------|---------------|
| What | Signed JWT (HS256) containing the user id (`sub`) | 32 random bytes (base64url), meaningless |
| Lifetime | `ACCESS_TOKEN_TTL` (15 min) | `REFRESH_TOKEN_TTL_DAYS` (30 days) |
| Sent | On every protected request: `Authorization: Bearer <token>` | Only to `/auth/refresh` and `/auth/logout` |
| Checked by | Signature, algorithm, issuer, audience, expiry: **no database** | Lookup of its SHA-256 hash in `refreshtokens` |
| Stored by the API | Never | Only its **SHA-256 hash** |
| If stolen | Useful until it expires (≤ 15 min) | Detected by rotation (reuse revokes the session) |

JWT claims: `sub` (user id), `iss = eventpass-api`, `aud = eventpass-app`, `iat`, `exp`.
Nothing secret or role-related is put in the payload: anyone can read it.

## Lifecycle

```
register / login ─► { user, accessToken, refreshToken RT1 }        new family F
protected call   ─► Authorization: Bearer AT  → 200, or 401 when AT expired
refresh RT1      ─► RT1 marked used, { accessToken, RT2 }          same family F
refresh RT1 again─► RT1 already used = reuse → delete family F → 401 (RT2 dead too)
logout RT2       ─► delete family F → 204; refresh RT2 → 401
```

A **session** is a token family: every refresh token rotated from one login.
Logging in on a second device creates a second, independent family.

## Rules enforced by the server

1. **Passwords** are hashed with Argon2id (m = 64 MiB, t = 3, p = 4; measurements in ADR-016),
   never stored, logged or returned (`select: false` + DTO).
2. **Login** answers the same 401 "Invalid email or password" for an unknown e-mail
   and a wrong password. (Registration answers 409 for a taken e-mail: a deliberate
   usability trade-off of the lab, so account existence is not fully hidden.)
3. **Rotation**: a refresh token works once. The claim is a single atomic
   `findOneAndUpdate({ tokenHash, usedAt: null, expiresAt > now })`.
4. **Reuse detection**: presenting an already used token deletes the whole family;
   the server cannot tell the user from a thief, so both must sign in again.
5. **Concurrent refresh** of one token: at most one succeeds and the family ends
   fully revoked (ADR-019). Clients must therefore serialise refreshes.
6. **Expiry**: an expired refresh token is refused; MongoDB's TTL index deletes it.
7. **Logout** deletes the family of the given refresh token (204, idempotent).
   Other sessions of the same user are untouched.
8. **Roles**: `user` (default) or `admin`; never accepted from a request.
9. **Rate limiting**: register and login are limited per IP (10 per 15 min in
   production, 100 in development); 429 in the standard error envelope.

## Known limitations

- An access token issued before logout stays valid until it expires (≤ 15 min) — ADR-020.
- No e-mail verification, password reset or "sign out everywhere" yet (lab's
  production list; `logout-all` deliberately skipped in Phase 2).
- `trust proxy` must be configured when the hosting platform is known (ADR-021).

## OWASP API Security Top 10 (authentication scope)

| Risk | Defence in EventPass |
|------|----------------------|
| API1 Broken object level authorization | Identity always taken from the verified token (`currentUserId`), never from body/URL. Per-resource rules from Phase 3. |
| API2 Broken authentication | Argon2id; identical login error; rate limit on register/login; 15-min access token with pinned algorithm/issuer/audience; rotating refresh tokens stored hashed with reuse detection; logout revokes the session. |
| API3 Broken object property level authorization | Zod drops unknown fields (`role` cannot be set); DTOs decide what leaves (no `passwordHash`). |
| API4 Unrestricted resource consumption | 100 kB body limit (413); password ≤ 128 chars; rate limit; argon2 concurrency bounded by the thread pool. |
| API8 Security misconfiguration | helmet; no `X-Powered-By`; no stack traces in responses; secrets only in the environment, validated at startup (empty template secret refused). |

## Guarantees checked by the tests

`api/test/auth.test.ts`, `api/test/rate-limit.test.ts`, `api/test/server-startup.test.ts`:
registration, normalisation, duplicates (including the parallel race), hidden
hash, Argon2id format, role injection, identical login errors, token forgery
(expired, other issuer/audience, other secret, modified payload, `alg: none`),
rotation, hashed storage, reuse detection, expiry, concurrent refresh, logout,
session isolation, the access-token limitation, 429 format and configuration failures.

## For the Flutter app (Phase 4)

- Base URL `…/api/v1`; public paths `/auth/login`, `/auth/register`, `/auth/refresh`.
- Responses: `data.user` (`id, name, email, role, createdAt`), `data.accessToken`, `data.refreshToken`.
- On 401 from a protected call: refresh **once, serialised** (lab `QueuedInterceptor`),
  save both new tokens, replay the request; if refresh answers 401, the session is over.
- Logout: clear local tokens first, then call `/auth/logout` (best effort).
- 422 `details` gives each invalid field its messages, to show next to the field.
