import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Request } from 'express';
import {
  ReplicaSetRequiredError,
  databaseNameOf,
  describeReplicaSetProblem,
} from '../src/config/db.ts';
import { requireRole } from '../src/shared/authorize.ts';
import { AppError } from '../src/shared/errors.ts';

// Phase 3 checks that need NO database.

const apiRoot = fileURLToPath(new URL('..', import.meta.url));

function run(
  args: string[],
  overrides: Record<string, string | undefined>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: apiRoot, env: childEnv });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    // If a guard failed and the child tried to reach the (unreachable)
    // database, it would hang: kill it and fail the test.
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// Port 9 on localhost: nothing listens there. The guards must refuse BEFORE
// any connection attempt, so these tests never reach a database.
const UNREACHABLE_DEV = 'mongodb://127.0.0.1:9/eventpass_dev';
const UNREACHABLE_TEST = 'mongodb://127.0.0.1:9/eventpass_test';

describe('replica-set startup check (ADR-029)', () => {
  it('refuses a standalone server, naming the fix', () => {
    const problem = describeReplicaSetProblem({ isWritablePrimary: true });
    assert.match(problem ?? '', /not a replica set/);
    assert.match(problem ?? '', /npm run db:up/);
  });

  it('refuses a replica set without a writable primary yet', () => {
    const problem = describeReplicaSetProblem({ setName: 'rs0', isWritablePrimary: false });
    assert.match(problem ?? '', /no writable primary/);
    assert.match(problem ?? '', /db:status/);
  });

  it('accepts a writable primary (local Docker or Atlas)', () => {
    assert.equal(describeReplicaSetProblem({ setName: 'rs0', isWritablePrimary: true }), null);
    assert.equal(
      describeReplicaSetProblem({ setName: 'atlas-abc-shard-0', isWritablePrimary: true }),
      null,
    );
  });

  it('uses a named error and never mentions a connection string', () => {
    const error = new ReplicaSetRequiredError(
      describeReplicaSetProblem({}) ?? 'unexpected',
    );
    assert.equal(error.name, 'ReplicaSetRequiredError');
    assert.doesNotMatch(error.message, /mongodb(\+srv)?:\/\//);
  });

  it('databaseNameOf still works after its move to src/config/db.ts', () => {
    assert.equal(
      databaseNameOf('mongodb://127.0.0.1:27028/eventpass_test?directConnection=true'),
      'eventpass_test',
    );
  });
});

describe('requireRole (global role guard)', () => {
  const call = (actor: Request['actor']) => {
    let nextCalled = false;
    const req = { actor } as Request;
    requireRole('admin')(req, {} as never, () => {
      nextCalled = true;
    });
    return nextCalled;
  };

  it('lets an admin through', () => {
    assert.equal(call({ id: 'a'.repeat(24), role: 'admin' }), true);
  });

  it('answers 403 to a normal user', () => {
    assert.throws(
      () => call({ id: 'a'.repeat(24), role: 'user' }),
      (error: unknown) => error instanceof AppError && error.status === 403,
    );
  });

  it('answers 401 when no actor was loaded', () => {
    assert.throws(
      () => call(undefined),
      (error: unknown) => error instanceof AppError && error.status === 401,
    );
  });
});

describe('transaction test hooks are refused outside NODE_ENV=test (ADR-031)', () => {
  it('throws in production', async () => {
    const script =
      "import('./src/modules/clubs/club-transaction.ts').then((m) => {" +
      '  try { m.setTransactionTestHooks({}); process.exit(3); }' +
      '  catch (e) { console.error(e.message); process.exit(0); } })';
    const result = await run(['--input-type=module', '-e', script], {
      NODE_ENV: 'production',
      MONGO_URI: UNREACHABLE_DEV,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /only available when NODE_ENV=test/);
  });
});

describe('promote-admin safeguards (ADR-032)', () => {
  const script = 'scripts/promote-admin.ts';

  it('prints the usage and exits 2 without an e-mail', async () => {
    const result = await run([script], { NODE_ENV: 'development', MONGO_URI: UNREACHABLE_DEV });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Usage: npm run promote-admin/);
  });

  it('refuses an invalid e-mail', async () => {
    const result = await run([script, 'not-an-email'], {
      NODE_ENV: 'development',
      MONGO_URI: UNREACHABLE_DEV,
    });
    assert.equal(result.code, 2);
  });

  it('refuses NODE_ENV=test', async () => {
    const result = await run([script, 'ada@example.com'], {
      NODE_ENV: 'test',
      MONGO_URI: UNREACHABLE_DEV,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /never touches a test database/);
  });

  it('refuses a database whose name ends with _test', async () => {
    const result = await run([script, 'ada@example.com'], {
      NODE_ENV: 'development',
      MONGO_URI: UNREACHABLE_TEST,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /never touches a test database/);
  });

  it('refuses production without --confirm and never prints the URI', async () => {
    const result = await run([script, 'ada@example.com'], {
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://admin:S3cretPw@127.0.0.1:9/eventpass',
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /without --confirm/);
    assert.doesNotMatch(result.stderr + result.stdout, /S3cretPw|mongodb:\/\//);
  });
});
