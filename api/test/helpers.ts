import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { databaseNameOf, verifyReplicaSet } from '../src/config/db.ts';
import { env } from '../src/config/env.ts';
import { User } from '../src/modules/users/user.model.ts';

// Lab reference: section 2.4 (test/helpers.ts).

export const api = request(createApp());

export type Session = {
  user: { id: string; name: string; email: string; role: string };
  accessToken: string;
  refreshToken: string;
};

// Registers a user and returns its session (user + both tokens).
export async function registerUser(
  email = 'ada@example.com',
  password = 'correct-horse-9',
): Promise<Session> {
  const res = await api
    .post('/api/v1/auth/register')
    .send({ name: 'Ada Lovelace', email, password });
  if (res.status !== 201) {
    throw new Error(`registerUser failed with ${res.status}`);
  }
  return res.body.data as Session;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// Test-database safety guard.
// EVENTPASS MODIFICATION OF THE LAB (ADR-009): the lab only checked
// `MONGO_URI.endsWith('_test')`. That check can be fooled by a query string
// (".../eventpass_dev?appName=x_test" ends with "_test") and ignores
// NODE_ENV. We extract the real database name and also require NODE_ENV=test.
// Error messages never include the URI, which may contain credentials.
// ---------------------------------------------------------------------------

// databaseNameOf moved unchanged to src/config/db.ts (Phase 3, R6);
// re-exported here so existing tests keep their import.
export { databaseNameOf };

/** Throws unless the URI is a test database used in the test environment. */
export function assertSafeTestDatabase(uri: string, nodeEnv: string): string {
  if (nodeEnv !== 'test') {
    throw new Error(
      `Refusing to use a database in tests: NODE_ENV is "${nodeEnv}", expected "test"`,
    );
  }
  const name = databaseNameOf(uri);
  if (!name || !name.endsWith('_test')) {
    throw new Error(
      'Refusing to run tests on a non-test database: the database name in MONGO_URI must end with "_test"',
    );
  }
  return name;
}

export async function connectTestDatabase(): Promise<void> {
  assertSafeTestDatabase(env.MONGO_URI, env.NODE_ENV);
  await mongoose.connect(env.MONGO_URI);
  // Phase 3: transactions need a replica set (the `mongo-test` container,
  // docs/development-database.md). Fail fast with the fix, not later.
  await verifyReplicaSet();
}

// ---------------------------------------------------------------------------
// Phase 3 helpers
// ---------------------------------------------------------------------------

/** Makes an existing user a global admin, directly in the test database. */
export async function promoteToAdmin(userId: string): Promise<void> {
  await User.updateOne({ _id: userId }, { $set: { role: 'admin' } });
}

/** A promise that the test resolves by hand: deterministic synchronisation. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Second line of defence: never drop a database whose name is not *_test,
// even if a test connected some other way.
async function dropTestDatabase(): Promise<void> {
  const name = mongoose.connection.name;
  if (!name.endsWith('_test')) {
    throw new Error('Refusing to drop a database whose name does not end with "_test"');
  }
  await mongoose.connection.dropDatabase();
}

export async function resetDatabase(): Promise<void> {
  await dropTestDatabase();
  // dropDatabase also drops the indexes: rebuild them (unique email...).
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
}

export async function closeTestDatabase(): Promise<void> {
  await dropTestDatabase();
  await mongoose.disconnect();
}
