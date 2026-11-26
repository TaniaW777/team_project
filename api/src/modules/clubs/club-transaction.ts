import mongoose from 'mongoose';
import { env } from '../../config/env.ts';
import { AppError } from '../../shared/errors.ts';
import { Club, type ClubDocument } from './club.model.ts';

// ===========================================================================
// Membership transactions (ADR-027, ADR-028)
//
// Every membership change runs inside ONE MongoDB transaction whose FIRST
// operation increments `membershipVersion` on the club document (the shared
// write). Two transactions that change the same club therefore write the same
// document; MongoDB never lets both commit (the second gets WriteConflict,
// labelled TransientTransactionError), so changes to one club run one after
// the other, and every retry starts from a snapshot that includes the other
// change. The organizer count, the rule checks and the single membership
// write all happen inside that same transaction.
// ===========================================================================

export const TRANSACTION_POLICY = {
  /** Whole-transaction attempts (body + commit). */
  maxAttempts: 4,
  /** Exponential backoff with full jitter: random(0, min(max, base * 2^(n-1))). */
  baseBackoffMs: 10,
  maxBackoffMs: 100,
  /** Commit-only attempts when the outcome is unknown. */
  maxCommitAttempts: 3,
  maxCommitBackoffMs: 200,
  /** Server-side limit for each read / findAndModify in the transaction. */
  operationTimeLimitMs: 2000,
  /** Overall budget of the helper, measured from its start. */
  deadlineMs: 5000,
} as const;

export type TransactionPolicy = { [K in keyof typeof TRANSACTION_POLICY]: number };

// ---------------------------------------------------------------------------
// Errors the helper produces
// ---------------------------------------------------------------------------

/** 409: nothing was applied; safe to retry. */
export function concurrentUpdateError() {
  return new AppError(
    409,
    'CONCURRENT_UPDATE',
    "Another change to this club's members is in progress. Try again.",
  );
}

/** 503: the commit may or may not have been applied. */
export function outcomeUnknownError() {
  return new AppError(
    503,
    'TRANSACTION_OUTCOME_UNKNOWN',
    'The change may or may not have been applied. Reload the club members before trying again.',
  );
}

export function hasErrorLabel(error: unknown, label: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    hasErrorLabel?: (label: string) => boolean;
    errorLabels?: unknown;
  };
  if (typeof candidate.hasErrorLabel === 'function') {
    return candidate.hasErrorLabel(label);
  }
  return Array.isArray(candidate.errorLabels) && candidate.errorLabels.includes(label);
}

function hasErrorCode(error: unknown, code: number): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === code
  );
}

const MAX_TIME_MS_EXPIRED = 50;

class DeadlineExceeded extends Error {}

// ---------------------------------------------------------------------------
// Test-only hooks (ADR-031). Refused outside NODE_ENV=test, so they can never
// be active in production. Used for deterministic synchronisation in tests.
// ---------------------------------------------------------------------------

export type TransactionHooks = {
  /**
   * After a transient failure of attempt `attempt`, before the backoff.
   * Awaited: a test can release the conflicting transaction here, so the
   * retry deterministically starts after the release.
   */
  onAttemptFailed?: (attempt: number, error: unknown) => Promise<void> | void;
  /** Awaited after the work, just before the first commit of an attempt. */
  beforeCommit?: (attempt: number) => Promise<void> | void;
  /** After a commit attempt ended with UnknownTransactionCommitResult. */
  onCommitUnknown?: (commitAttempt: number) => void;
};

let testHooks: TransactionHooks | null = null;

export function setTransactionTestHooks(hooks: TransactionHooks | null): void {
  if (env.NODE_ENV !== 'test') {
    throw new Error('Transaction test hooks are only available when NODE_ENV=test');
  }
  testHooks = hooks;
}

// ---------------------------------------------------------------------------
// Generic bounded transaction runner (no Mongoose dependency: unit-testable)
// ---------------------------------------------------------------------------

/** The part of a driver ClientSession that the runner uses. */
export type SessionLike = {
  startTransaction(options?: Record<string, unknown>): void;
  commitTransaction(): Promise<unknown>;
  abortTransaction(): Promise<unknown>;
  endSession(): Promise<void>;
};

export type TransactionContext<S extends SessionLike> = {
  session: S;
  attempt: number;
  /** Options for every operation in the transaction: session + time limit. */
  options(): { session: S; maxTimeMS: number };
};

export type RunnerDeps<S extends SessionLike> = {
  startSession: () => Promise<S>;
  policy?: TransactionPolicy;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  hooks?: TransactionHooks | null;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runTransaction<S extends SessionLike, T>(
  deps: RunnerDeps<S>,
  work: (ctx: TransactionContext<S>) => Promise<T>,
): Promise<T> {
  const policy = deps.policy ?? TRANSACTION_POLICY;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const hooks = deps.hooks ?? null;

  const deadline = now() + policy.deadlineMs;
  const remaining = () => deadline - now();

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    if (remaining() <= 0) break;

    const session = await deps.startSession();
    let commitStarted = false;
    try {
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        maxCommitTimeMS: Math.max(1, Math.min(policy.operationTimeLimitMs, remaining())),
      });

      const ctx: TransactionContext<S> = {
        session,
        attempt,
        options: () => {
          const left = remaining();
          if (left <= 0) throw new DeadlineExceeded();
          return { session, maxTimeMS: Math.min(policy.operationTimeLimitMs, left) };
        },
      };

      const value = await work(ctx);
      await hooks?.beforeCommit?.(attempt);

      commitStarted = true;
      await commitWithRetry(session, policy, remaining, sleep, random, hooks);
      return value;
    } catch (error) {
      // Never abort after a commit was attempted (the driver forbids it, and
      // the commit may have succeeded). endSession() below cleans up.
      if (!commitStarted) {
        await session.abortTransaction().catch(() => undefined);
      }

      if (error instanceof AppError && error.code === 'TRANSACTION_OUTCOME_UNKNOWN') {
        throw error;
      }
      // Time budget or server time limit reached before commit: nothing was
      // applied, so the client may retry.
      if (
        !commitStarted &&
        (error instanceof DeadlineExceeded || hasErrorCode(error, MAX_TIME_MS_EXPIRED))
      ) {
        throw concurrentUpdateError();
      }
      if (hasErrorLabel(error, 'TransientTransactionError')) {
        await hooks?.onAttemptFailed?.(attempt, error);
        if (attempt < policy.maxAttempts) {
          const cap = Math.min(
            policy.maxBackoffMs,
            policy.baseBackoffMs * 2 ** (attempt - 1),
          );
          const wait = Math.min(Math.floor(random() * cap), Math.max(0, remaining()));
          if (wait > 0) await sleep(wait);
        }
        continue;
      }
      // Business errors (AppError), duplicate keys and bugs: no retry.
      throw error;
    } finally {
      await session.endSession().catch(() => undefined);
    }
  }

  // Attempts or time budget used up by transient conflicts.
  throw concurrentUpdateError();
}

async function commitWithRetry(
  session: SessionLike,
  policy: TransactionPolicy,
  remaining: () => number,
  sleep: (ms: number) => Promise<void>,
  random: () => number,
  hooks: TransactionHooks | null,
): Promise<void> {
  for (let commitAttempt = 1; ; commitAttempt++) {
    try {
      await session.commitTransaction();
      return;
    } catch (error) {
      if (!hasErrorLabel(error, 'UnknownTransactionCommitResult')) {
        // e.g. TransientTransactionError: the transaction was aborted, the
        // caller retries the whole body.
        throw error;
      }
      hooks?.onCommitUnknown?.(commitAttempt);
      if (commitAttempt >= policy.maxCommitAttempts || remaining() <= 0) {
        throw outcomeUnknownError();
      }
      // Retry ONLY the commit; the body is never re-run here.
      const wait = Math.min(
        Math.floor(random() * policy.maxCommitBackoffMs),
        Math.max(0, remaining()),
      );
      if (wait > 0) await sleep(wait);
    }
  }
}

// ---------------------------------------------------------------------------
// Club membership transaction
// ---------------------------------------------------------------------------

export type ClubTransaction = TransactionContext<mongoose.ClientSession> & {
  /** The club, read by the shared write itself (current status included). */
  club: ClubDocument;
};

/**
 * Runs `work` in a transaction that first performs the shared write on the
 * club. `work` must only run database operations with `tx.options()` and
 * return a value: it may be re-run on a transient conflict, so it must not
 * send responses, log success, or write outside the transaction.
 */
export function runClubMembershipTransaction<T>(
  clubId: string,
  work: (tx: ClubTransaction) => Promise<T>,
): Promise<T> {
  return runTransaction(
    { startSession: () => mongoose.startSession(), hooks: testHooks },
    async (ctx) => {
      const club = await Club.findOneAndUpdate(
        { _id: clubId },
        { $inc: { membershipVersion: 1 } },
        { ...ctx.options(), returnDocument: 'after' },
      );
      if (!club) throw AppError.notFound('Club not found');
      return work({ ...ctx, club });
    },
  );
}
