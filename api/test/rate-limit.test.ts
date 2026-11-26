import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createCredentialsLimiter } from '../src/modules/auth/auth.routes.ts';
import { errorHandler } from '../src/shared/error-handler.ts';

// The app's limiter is skipped while NODE_ENV=test (lab behaviour), so the
// many registrations of the auth tests are not blocked. Here we build one
// with the same settings but a limit of 2 and no skip (ADR-017).
describe('credentials rate limiter', () => {
  it('answers 429 in the unified error format once the limit is reached', async () => {
    const app = express();
    app.post(
      '/login',
      createCredentialsLimiter({ limit: 2, skip: () => false }),
      (_req, res) => {
        res.json({ data: 'ok' });
      },
    );
    app.use(errorHandler);
    const client = request(app);

    assert.equal((await client.post('/login')).status, 200);
    assert.equal((await client.post('/login')).status, 200);

    const blocked = await client.post('/login');
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, {
      error: { code: 'TOO_MANY_REQUESTS', message: 'Try again later' },
    });
    // IETF draft-8 headers tell the client its quota and when to retry.
    assert.ok(blocked.headers['ratelimit-policy']);
    assert.ok(blocked.headers['ratelimit']);
  });
});
