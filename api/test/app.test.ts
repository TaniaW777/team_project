import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api } from './helpers.ts';

// The real app (createApp) through real HTTP, in memory: no port, no database.
describe('app foundation', () => {
  it('GET /health answers 200 with status ok', async () => {
    const res = await api.get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(typeof res.body.uptime, 'number');
  });

  it('an unknown route answers 404 in the unified error format', async () => {
    const res = await api.get('/api/v1/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, {
      error: { code: 'NOT_FOUND', message: 'Route GET /api/v1/nope not found' },
    });
  });

  it('a malformed JSON body answers 400 BAD_REQUEST', async () => {
    const res = await api
      .post('/api/v1/nope')
      .set('Content-Type', 'application/json')
      .send('{"broken": ');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('a body over the 100 kB limit answers 413, not 500 (ADR-007)', async () => {
    const res = await api
      .post('/api/v1/nope')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(110 * 1024) }));
    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await api.get('/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['content-security-policy']);
    assert.equal(res.headers['x-powered-by'], undefined);
  });
});
