import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { SignJWT } from 'jose';
import { env } from '../src/config/env.ts';
import { RefreshToken } from '../src/modules/auth/refresh-token.model.ts';
import {
  AUDIENCE,
  ISSUER,
  hashToken,
} from '../src/modules/auth/token.service.ts';
import { User } from '../src/modules/users/user.model.ts';
import {
  api,
  bearer,
  closeTestDatabase,
  connectTestDatabase,
  registerUser,
  resetDatabase,
} from './helpers.ts';

const AUTH = '/api/v1/auth';
const PASSWORD = 'correct-horse-9';

const login = (email: string, password = PASSWORD) =>
  api.post(`${AUTH}/login`).send({ email, password });
const refresh = (refreshToken: string) =>
  api.post(`${AUTH}/refresh`).send({ refreshToken });
const logout = (refreshToken: string) =>
  api.post(`${AUTH}/logout`).send({ refreshToken });
const me = (accessToken: string) =>
  api.get(`${AUTH}/me`).set(bearer(accessToken));

// Builds access tokens with chosen claims, to attack the verifier.
const testSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
function craftToken(
  sub: string,
  { issuer = ISSUER, audience = AUDIENCE, expiresAt = '15m' as string | number,
    key = testSecret } = {},
) {
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key);
}
const b64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

describe('authentication', () => {
  before(connectTestDatabase);
  beforeEach(resetDatabase);
  after(closeTestDatabase);

  // ---------------------------------------------------------------- register
  describe('POST /auth/register', () => {
    it('answers 201 with the user and both tokens, never the password hash', async () => {
      const res = await api
        .post(`${AUTH}/register`)
        .send({ name: 'Ada Lovelace', email: 'ada@example.com', password: PASSWORD });

      assert.equal(res.status, 201);
      const { user, accessToken, refreshToken } = res.body.data;
      assert.deepEqual(Object.keys(user).sort(), ['createdAt', 'email', 'id', 'name', 'role']);
      assert.equal(user.role, 'user');
      assert.equal(typeof accessToken, 'string');
      assert.equal(typeof refreshToken, 'string');
      // Raw-text checks: nothing about the password anywhere in the body.
      assert.ok(!res.text.includes('passwordHash'));
      assert.ok(!res.text.includes('$argon2'));
      assert.ok(!res.text.includes(PASSWORD));
    });

    it('stores the password as an Argon2id hash with the agreed parameters', async () => {
      await registerUser('ada@example.com');
      const stored = await User.findOne({ email: 'ada@example.com' }).select('+passwordHash');
      assert.ok(stored);
      assert.match(stored.passwordHash, /^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
      assert.ok(!stored.passwordHash.includes(PASSWORD));
    });

    it('never returns the hash from a normal query (select: false)', async () => {
      await registerUser('ada@example.com');
      const plain = await User.findOne({ email: 'ada@example.com' }).lean();
      assert.ok(plain);
      assert.equal('passwordHash' in plain, false);
    });

    it('trims and lowercases the e-mail (ADR-014)', async () => {
      const res = await api
        .post(`${AUTH}/register`)
        .send({ name: 'Ada', email: '  Ada@Mail.COM ', password: PASSWORD });
      assert.equal(res.status, 201);
      assert.equal(res.body.data.user.email, 'ada@mail.com');
    });

    it('refuses a duplicate e-mail with 409, whatever its case', async () => {
      await registerUser('ada@example.com');
      const res = await api
        .post(`${AUTH}/register`)
        .send({ name: 'Ada', email: 'ADA@example.com', password: PASSWORD });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'CONFLICT');
    });

    it('two simultaneous registrations of one e-mail: one 201, one 409, never 500 (ADR-015)', async () => {
      const body = { name: 'Ada', email: 'race@example.com', password: PASSWORD };
      const results = await Promise.all([
        api.post(`${AUTH}/register`).send(body),
        api.post(`${AUTH}/register`).send(body),
      ]);
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [201, 409]);
      assert.equal(await User.countDocuments({ email: 'race@example.com' }), 1);
    });

    it('answers 422 with one message per invalid field', async () => {
      const res = await api
        .post(`${AUTH}/register`)
        .send({ name: 'A', email: 'not-an-email', password: 'short' });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      const fields = Object.keys(res.body.error.details).sort();
      assert.deepEqual(fields, ['email', 'name', 'password']);
    });

    it('drops a "role" sent by the client: nobody can make themselves admin', async () => {
      const res = await api.post(`${AUTH}/register`).send({
        name: 'Mallory', email: 'mallory@example.com', password: PASSWORD, role: 'admin',
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.data.user.role, 'user');
      const stored = await User.findOne({ email: 'mallory@example.com' });
      assert.equal(stored?.role, 'user');
    });
  });

  // ------------------------------------------------------------------- login
  describe('POST /auth/login', () => {
    it('answers 200 with the user and both tokens', async () => {
      await registerUser('ada@example.com');
      const res = await login('ada@example.com');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.email, 'ada@example.com');
      assert.ok(res.body.data.accessToken);
      assert.ok(res.body.data.refreshToken);
      assert.ok(!res.text.includes('passwordHash'));
    });

    it('wrong password and unknown e-mail give the SAME status and message', async () => {
      await registerUser('ada@example.com');
      const wrongPassword = await login('ada@example.com', 'wrong-password');
      const unknownEmail = await login('nobody@example.com');
      assert.equal(wrongPassword.status, 401);
      assert.equal(unknownEmail.status, 401);
      assert.deepEqual(wrongPassword.body, unknownEmail.body);
      assert.equal(wrongPassword.body.error.message, 'Invalid email or password');
    });

    it('answers 422 on invalid input', async () => {
      const res = await api.post(`${AUTH}/login`).send({ email: 'x' });
      assert.equal(res.status, 422);
    });
  });

  // ---------------------------------------------------- access token / me
  describe('GET /auth/me (access token verification)', () => {
    it('answers 200 with the current user for a valid token', async () => {
      const session = await registerUser('ada@example.com');
      const res = await me(session.accessToken);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.id, session.user.id);
    });

    it('answers 401 without the header or with another scheme', async () => {
      const session = await registerUser('ada@example.com');
      assert.equal((await api.get(`${AUTH}/me`)).status, 401);
      const basic = await api
        .get(`${AUTH}/me`)
        .set('Authorization', `Basic ${session.accessToken}`);
      assert.equal(basic.status, 401);
    });

    it('rejects an expired token', async () => {
      const session = await registerUser('ada@example.com');
      const expired = await craftToken(session.user.id, {
        expiresAt: Math.floor(Date.now() / 1000) - 60,
      });
      const res = await me(expired);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.message, 'Invalid or expired access token');
    });

    it('rejects a token for another issuer or audience', async () => {
      const session = await registerUser('ada@example.com');
      const otherIssuer = await craftToken(session.user.id, { issuer: 'someone-else' });
      const otherAudience = await craftToken(session.user.id, { audience: 'other-app' });
      assert.equal((await me(otherIssuer)).status, 401);
      assert.equal((await me(otherAudience)).status, 401);
    });

    it('rejects a token signed with another secret', async () => {
      const session = await registerUser('ada@example.com');
      const forged = await craftToken(session.user.id, {
        key: new TextEncoder().encode('an-attacker-secret-that-is-long-enough-123'),
      });
      assert.equal((await me(forged)).status, 401);
    });

    it('rejects a token whose payload was changed (signature no longer matches)', async () => {
      const ada = await registerUser('ada@example.com');
      const grace = await registerUser('grace@example.com');
      const [header, , signature] = ada.accessToken.split('.');
      const payload = b64url({
        sub: grace.user.id, iss: ISSUER, aud: AUDIENCE,
        iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600,
      });
      assert.equal((await me(`${header}.${payload}.${signature}`)).status, 401);
    });

    it('rejects an unsigned token (alg: none)', async () => {
      const session = await registerUser('ada@example.com');
      const unsigned = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
        sub: session.user.id, iss: ISSUER, aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 600,
      })}.`;
      assert.equal((await me(unsigned)).status, 401);
    });
  });

  // ----------------------------------------------------------------- refresh
  describe('POST /auth/refresh (rotation)', () => {
    it('returns a new pair of tokens, different from the old ones', async () => {
      const session = await registerUser('ada@example.com');
      const res = await refresh(session.refreshToken);
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.body.data).sort(), ['accessToken', 'refreshToken']);
      assert.notEqual(res.body.data.refreshToken, session.refreshToken);
      assert.equal((await me(res.body.data.accessToken)).status, 200);
    });

    it('stores refresh tokens only as SHA-256 hashes, never in plaintext', async () => {
      const session = await registerUser('ada@example.com');
      const docs = await RefreshToken.find().lean();
      assert.equal(docs.length, 1);
      assert.equal(docs[0]?.tokenHash, hashToken(session.refreshToken));
      assert.ok(!JSON.stringify(docs).includes(session.refreshToken));
    });

    it('reusing an old token answers 401 and revokes the whole family', async () => {
      const session = await registerUser('ada@example.com');
      const first = await refresh(session.refreshToken); // RT1 -> RT2
      const rt2 = first.body.data.refreshToken as string;

      const replay = await refresh(session.refreshToken); // RT1 again: theft?
      assert.equal(replay.status, 401);

      // RT2 was legitimate, but it belongs to the compromised family.
      assert.equal((await refresh(rt2)).status, 401);
      assert.equal(await RefreshToken.countDocuments(), 0);
    });

    it('rejects an expired refresh token', async () => {
      const session = await registerUser('ada@example.com');
      await RefreshToken.updateOne(
        { tokenHash: hashToken(session.refreshToken) },
        { expiresAt: new Date(Date.now() - 1000) },
      );
      assert.equal((await refresh(session.refreshToken)).status, 401);
    });

    it('rejects an unknown refresh token and validates the body', async () => {
      assert.equal((await refresh('made-up-token')).status, 401);
      const empty = await api.post(`${AUTH}/refresh`).send({});
      assert.equal(empty.status, 422);
    });

    it('concurrent use of ONE token: at most one success, and the family ends fully revoked (ADR-019)', async () => {
      // Two requests present the same refresh token at the same instant
      // (for example a client that does not serialise its refreshes).
      // The atomic claim lets exactly one of them rotate; the other sees an
      // already-used token, treats it as reuse and revokes the family.
      const session = await registerUser('ada@example.com');
      const results = await Promise.all(
        Array.from({ length: 5 }, () => refresh(session.refreshToken)),
      );

      const ok = results.filter((r) => r.status === 200);
      const refused = results.filter((r) => r.status === 401);
      assert.ok(ok.length <= 1, 'never more than one successful rotation');
      assert.equal(ok.length + refused.length, results.length);
      assert.ok(refused.length >= 4, 'every replay is refused');

      // Whatever the interleaving, the session is gone: no token of the
      // family is left, including the one the winner may have received.
      assert.equal(await RefreshToken.countDocuments(), 0);
      for (const winner of ok) {
        assert.equal((await refresh(winner.body.data.refreshToken)).status, 401);
      }
    });
  });

  // ------------------------------------------------------------------ logout
  describe('POST /auth/logout (session revocation)', () => {
    it('answers 204 and the refresh token can no longer be used', async () => {
      const session = await registerUser('ada@example.com');
      const res = await logout(session.refreshToken);
      assert.equal(res.status, 204);
      assert.equal(res.text, '');
      assert.equal((await refresh(session.refreshToken)).status, 401);
    });

    it('also revokes tokens rotated from the same login (the whole session)', async () => {
      const session = await registerUser('ada@example.com');
      const rotated = (await refresh(session.refreshToken)).body.data.refreshToken;
      assert.equal((await logout(rotated)).status, 204);
      assert.equal((await refresh(rotated)).status, 401);
    });

    it('only revokes its own session: another login of the same user keeps working', async () => {
      await registerUser('ada@example.com');
      const phone = (await login('ada@example.com')).body.data;
      const laptop = (await login('ada@example.com')).body.data;

      assert.equal((await logout(phone.refreshToken)).status, 204);
      assert.equal((await refresh(phone.refreshToken)).status, 401);
      assert.equal((await refresh(laptop.refreshToken)).status, 200);
    });

    it('is idempotent: an unknown or already revoked token still answers 204', async () => {
      const session = await registerUser('ada@example.com');
      assert.equal((await logout(session.refreshToken)).status, 204);
      assert.equal((await logout(session.refreshToken)).status, 204);
      assert.equal((await logout('made-up-token')).status, 204);
    });

    it('KNOWN LIMITATION (ADR-020): an already issued access token stays valid until it expires', async () => {
      // Access tokens are verified by signature only (no database access),
      // so logout cannot recall one that was already handed out. Its life is
      // capped by ACCESS_TOKEN_TTL (15 minutes). What logout DOES guarantee
      // is that no new access token can be obtained.
      const session = await registerUser('ada@example.com');
      assert.equal((await logout(session.refreshToken)).status, 204);
      assert.equal((await me(session.accessToken)).status, 200);
      assert.equal((await refresh(session.refreshToken)).status, 401);
    });
  });

  // -------------------------------------------------------------- isolation
  describe('user isolation', () => {
    it("each user's token identifies only that user", async () => {
      const ada = await registerUser('ada@example.com');
      const grace = await registerUser('grace@example.com');
      assert.equal((await me(ada.accessToken)).body.data.email, 'ada@example.com');
      assert.equal((await me(grace.accessToken)).body.data.email, 'grace@example.com');
      // Ada's refresh token never yields a token for Grace.
      const rotated = await refresh(ada.refreshToken);
      assert.equal((await me(rotated.body.data.accessToken)).body.data.id, ada.user.id);
    });
  });
});
