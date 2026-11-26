import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TRANSACTION_POLICY,
  runTransaction,
  type SessionLike,
  type TransactionHooks,
} from '../src/modules/clubs/club-transaction.ts';
import { AppError } from '../src/shared/errors.ts';

// Unit tests of the bounded retry policy (ADR-028) with FAKE sessions:
// no database, no timers, a fake clock. They check what the runner does
// with each kind of error; the MongoDB behaviour itself (write conflicts on
// the shared write) is checked by test/club-transaction.test.ts.

function labelled(labels: string[], code?: number): Error {
  const error = new Error(`fake error ${labels.join(',')}`) as Error & {
    errorLabels: string[];
    code?: number;
    hasErrorLabel: (label: string) => boolean;
  };
  error.errorLabels = labels;
  if (code !== undefined) error.code = code;
  error.hasErrorLabel = (label) => labels.includes(label);
  return error;
}
const transient = () => labelled(['TransientTransactionError'], 112);
const unknownCommit = () => labelled(['UnknownTransactionCommitResult'], 50);

class FakeSession implements SessionLike {
  started: Record<string, unknown>[] = [];
  commits = 0;
  aborts = 0;
  ended = 0;
  private commitResults: (Error | 'ok')[];
  constructor(commitResults: (Error | 'ok')[] = ['ok']) {
    this.commitResults = commitResults;
  }
  startTransaction(options?: Record<string, unknown>) {
    this.started.push(options ?? {});
  }
  async commitTransaction() {
    this.commits++;
    const next = this.commitResults.shift() ?? 'ok';
    if (next instanceof Error) throw next;
  }
  async abortTransaction() {
    this.aborts++;
  }
  async endSession() {
    this.ended++;
  }
}

function harness(sessions: FakeSession[], hooks: TransactionHooks | null = null) {
  let clock = 1_000;
  const waits: number[] = [];
  const created: FakeSession[] = [];
  return {
    waits,
    created,
    advance: (ms: number) => {
      clock += ms;
    },
    deps: {
      startSession: async () => {
        const session = sessions.shift() ?? new FakeSession();
        created.push(session);
        return session;
      },
      now: () => clock,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      random: () => 0.999, // always the largest wait: checks the caps
      hooks,
    },
  };
}

const isAppError = (status: number, code: string) => (error: unknown) =>
  error instanceof AppError && error.status === status && error.code === code;

describe('transaction runner (bounded retries, ADR-028)', () => {
  it('commits once on success, with snapshot / majority / maxCommitTimeMS', async () => {
    const h = harness([new FakeSession()]);
    let calls = 0;
    const value = await runTransaction(h.deps, async () => {
      calls++;
      return 'done';
    });
    assert.equal(value, 'done');
    assert.equal(calls, 1);
    const [session] = h.created;
    assert.ok(session);
    assert.equal(session.commits, 1);
    assert.equal(session.aborts, 0);
    assert.equal(session.ended, 1);
    assert.deepEqual(session.started[0], {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      maxCommitTimeMS: TRANSACTION_POLICY.operationTimeLimitMs,
    });
  });

  it('retries the whole body after a transient error, then succeeds', async () => {
    const failed: number[] = [];
    const h = harness([], { onAttemptFailed: (attempt) => void failed.push(attempt) });
    let calls = 0;
    const value = await runTransaction(h.deps, async () => {
      calls++;
      if (calls === 1) throw transient();
      return 'second time';
    });
    assert.equal(value, 'second time');
    assert.equal(calls, 2);
    assert.deepEqual(failed, [1]);
    assert.equal(h.created[0]?.aborts, 1); // first attempt aborted
    assert.equal(h.created[1]?.commits, 1);
    assert.deepEqual(h.waits, [9]); // random(0, 10) for the first retry
  });

  it('gives up after 4 attempts with 409 CONCURRENT_UPDATE; waits stay <= 100 ms', async () => {
    const h = harness([]);
    let calls = 0;
    await assert.rejects(
      runTransaction(h.deps, async () => {
        calls++;
        throw transient();
      }),
      isAppError(409, 'CONCURRENT_UPDATE'),
    );
    assert.equal(calls, TRANSACTION_POLICY.maxAttempts);
    assert.equal(h.waits.length, TRANSACTION_POLICY.maxAttempts - 1);
    for (const wait of h.waits) assert.ok(wait <= TRANSACTION_POLICY.maxBackoffMs);
    assert.ok(h.created.every((session) => session.ended === 1));
  });

  it('caps the exponential backoff at maxBackoffMs', async () => {
    const h = harness([]);
    await assert.rejects(
      runTransaction({ ...h.deps, policy: { ...TRANSACTION_POLICY, maxAttempts: 8 } }, async () => {
        throw transient();
      }),
    );
    // caps: 10, 20, 40, 80, 100, 100, 100 (random 0.999 -> cap - 1)
    assert.deepEqual(h.waits, [9, 19, 39, 79, 99, 99, 99]);
  });

  it('does not retry business errors (AppError) and aborts the transaction', async () => {
    const h = harness([]);
    let calls = 0;
    await assert.rejects(
      runTransaction(h.deps, async () => {
        calls++;
        throw AppError.conflict('A club must keep at least one organizer');
      }),
      isAppError(409, 'CONFLICT'),
    );
    assert.equal(calls, 1);
    assert.equal(h.created[0]?.aborts, 1);
    assert.equal(h.created[0]?.ended, 1);
    assert.deepEqual(h.waits, []);
  });

  it('does not retry an unlabelled error', async () => {
    const h = harness([]);
    let calls = 0;
    await assert.rejects(
      runTransaction(h.deps, async () => {
        calls++;
        throw new Error('bug');
      }),
      /bug/,
    );
    assert.equal(calls, 1);
  });

  it('unknown commit result: retries ONLY the commit, never the body', async () => {
    const unknown: number[] = [];
    const session = new FakeSession([unknownCommit(), 'ok']);
    const h = harness([session], { onCommitUnknown: (n) => void unknown.push(n) });
    let calls = 0;
    const value = await runTransaction(h.deps, async () => {
      calls++;
      return 'committed';
    });
    assert.equal(value, 'committed');
    assert.equal(calls, 1);
    assert.equal(session.commits, 2);
    assert.equal(session.aborts, 0); // never abort after a commit attempt
    assert.deepEqual(unknown, [1]);
    assert.deepEqual(h.waits, [199]); // <= 200 ms
  });

  it('unknown commit result 3 times: 503 TRANSACTION_OUTCOME_UNKNOWN, not 409', async () => {
    const session = new FakeSession([unknownCommit(), unknownCommit(), unknownCommit()]);
    const h = harness([session]);
    let calls = 0;
    await assert.rejects(
      runTransaction(h.deps, async () => {
        calls++;
        return 'maybe';
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.status === 503 &&
        error.code === 'TRANSACTION_OUTCOME_UNKNOWN' &&
        error.message.startsWith('The change may or may not have been applied'),
    );
    assert.equal(calls, 1);
    assert.equal(session.commits, TRANSACTION_POLICY.maxCommitAttempts);
    assert.equal(session.aborts, 0);
    assert.equal(session.ended, 1);
  });

  it('a transient error AT commit (transaction aborted) re-runs the body', async () => {
    const first = new FakeSession([transient()]);
    const second = new FakeSession(['ok']);
    const h = harness([first, second]);
    let calls = 0;
    await runTransaction(h.deps, async () => {
      calls++;
    });
    assert.equal(calls, 2);
    assert.equal(first.aborts, 0); // commit had started: no abort call
  });

  it('stops at the overall deadline: no new attempt, 409', async () => {
    const h = harness([]);
    let calls = 0;
    await assert.rejects(
      runTransaction(h.deps, async () => {
        calls++;
        h.advance(TRANSACTION_POLICY.deadlineMs + 1);
        throw transient();
      }),
      isAppError(409, 'CONCURRENT_UPDATE'),
    );
    assert.equal(calls, 1);
    assert.deepEqual(h.waits, []); // no wait beyond the deadline
  });

  it('operation time limits shrink with the remaining budget', async () => {
    const h = harness([]);
    let seen = 0;
    await runTransaction(h.deps, async (ctx) => {
      h.advance(4_000);
      seen = ctx.options().maxTimeMS;
    });
    assert.equal(seen, 1_000); // min(2000, 5000 - 4000)
  });

  it('a later attempt gets a smaller maxCommitTimeMS', async () => {
    const h = harness([]);
    let calls = 0;
    await runTransaction(h.deps, async () => {
      calls++;
      if (calls === 1) {
        h.advance(4_500);
        throw transient();
      }
    });
    // 5000 - 4500 = 500 left (the fake sleep does not move the fake clock).
    assert.equal(h.created[1]?.started[0]?.maxCommitTimeMS, 500);
  });

  it('budget exhausted inside the body: abort, 409, nothing committed', async () => {
    const h = harness([]);
    await assert.rejects(
      runTransaction(h.deps, async (ctx) => {
        h.advance(TRANSACTION_POLICY.deadlineMs);
        ctx.options(); // would start a database operation with no time left
      }),
      isAppError(409, 'CONCURRENT_UPDATE'),
    );
    assert.equal(h.created[0]?.aborts, 1);
    assert.equal(h.created[0]?.commits, 0);
  });

  it('server time limit (MaxTimeMSExpired) before commit: 409, no retry', async () => {
    const h = harness([]);
    let calls = 0;
    await assert.rejects(
      runTransaction(h.deps, async () => {
        calls++;
        throw labelled([], 50);
      }),
      isAppError(409, 'CONCURRENT_UPDATE'),
    );
    assert.equal(calls, 1);
  });

  it('unknown commit with no time left: 503 immediately, no further commit', async () => {
    const session = new FakeSession([unknownCommit(), 'ok']);
    const h = harness([session]);
    await assert.rejects(
      runTransaction(h.deps, async () => {
        h.advance(TRANSACTION_POLICY.deadlineMs + 1);
      }),
      isAppError(503, 'TRANSACTION_OUTCOME_UNKNOWN'),
    );
    assert.equal(session.commits, 1);
  });

  it('awaits beforeCommit before committing (test hook)', async () => {
    const order: string[] = [];
    const session = new FakeSession();
    const original = session.commitTransaction.bind(session);
    session.commitTransaction = async () => {
      order.push('commit');
      await original();
    };
    const h = harness([session], {
      beforeCommit: async () => {
        await Promise.resolve();
        order.push('beforeCommit');
      },
    });
    await runTransaction(h.deps, async () => {
      order.push('work');
    });
    assert.deepEqual(order, ['work', 'beforeCommit', 'commit']);
  });
});
