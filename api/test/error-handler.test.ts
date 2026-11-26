import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { errorHandler } from '../src/shared/error-handler.ts';
import { AppError } from '../src/shared/errors.ts';

// A tiny app with routes that throw, so every branch of the central error
// handler can be checked through HTTP. Express 5 forwards errors thrown in
// async handlers to the error handler by itself.
const app = express();
app.get('/validation', () => {
  z.object({ email: z.email() }).parse({ email: 'not-an-email' });
});
app.get('/conflict', async () => {
  throw AppError.conflict('This email is already registered');
});
app.get('/bug', async () => {
  throw new Error('db password=hunter2 at internal/path.ts:42');
});
app.use(errorHandler);

const client = request(app);

describe('central error handler', () => {
  it('turns a ZodError into 422 VALIDATION_ERROR with one entry per field', async () => {
    const res = await client.get('/validation');
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(res.body.error.details.email));
  });

  it('turns an AppError into its status and code', async () => {
    const res = await client.get('/conflict');
    assert.equal(res.status, 409);
    assert.deepEqual(res.body.error, {
      code: 'CONFLICT',
      message: 'This email is already registered',
    });
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await client.get('/bug');
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, {
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
    assert.ok(!res.text.includes('hunter2'));
    assert.ok(!res.text.includes('internal/path.ts'));
  });
});
