import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { Club } from '../src/modules/clubs/club.model.ts';
import { setTransactionTestHooks } from '../src/modules/clubs/club-transaction.ts';
import { ClubMembership } from '../src/modules/clubs/membership.model.ts';
import * as clubService from '../src/modules/clubs/club.service.ts';
import * as membershipService from '../src/modules/clubs/membership.service.ts';
import { AppError } from '../src/shared/errors.ts';
import {
  asAdmin,
  asUser,
  membershipVersion,
  organizerCount,
  roleOf,
  standardClub,
} from './club-fixtures.ts';
import {
  closeTestDatabase,
  connectTestDatabase,
  deferred,
  registerUser,
  resetDatabase,
} from './helpers.ts';

// Deterministic concurrency tests of the membership transactions (ADR-027,
// ADR-028, ADR-031). No sleeps are used as evidence: synchronisation goes
// through promises the test resolves itself, test-controlled sessions and
// the test-only hooks of club-transaction.ts.
// REQUIRES the `mongo-test` container (npm run db:up).

const isAppError = (status: number, code?: string) => (error: unknown) =>
  error instanceof AppError && error.status === status && (!code || error.code === code);

/** A transaction opened by the TEST that writes the club and does not commit. */
async function holdClub(clubId: string, update: Record<string, unknown>) {
  const session = await mongoose.startSession();
  session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  await Club.updateOne({ _id: clubId }, update, { session });
  return {
    commit: () => session.commitTransaction(),
    abort: () => session.abortTransaction(),
    end: () => session.endSession(),
  };
}

describe('membership transactions', () => {
  before(connectTestDatabase);
  beforeEach(resetDatabase);
  afterEach(() => setTransactionTestHooks(null));
  after(closeTestDatabase);

  // -------------------------------------------------------------------------
  // Retry mechanism against a REAL conflict on the shared write
  // -------------------------------------------------------------------------
  describe('conflict on the shared write', () => {
    it('a conflict is retried, then succeeds (release happens inside the awaited hook)', async () => {
      const { x, z, clubId } = await standardClub();
      const before = await membershipVersion(clubId);
      const holder = await holdClub(clubId, { $inc: { membershipVersion: 1 } });
      const failures: number[] = [];
      setTransactionTestHooks({
        onAttemptFailed: async (attempt) => {
          failures.push(attempt);
          if (attempt === 1) await holder.abort(); // retry starts AFTER this
        },
      });
      try {
        const membership = await membershipService.changeRole(asUser(x), clubId, z.user.id, 'organizer');
        assert.equal(membership.role, 'organizer');
      } finally {
        await holder.end();
      }
      assert.deepEqual(failures, [1]); // proof that attempt 1 really conflicted
      assert.equal(await membershipVersion(clubId), before + 1); // applied exactly once
    });

    it('retries run out while the conflict persists: 409 CONCURRENT_UPDATE, nothing applied', async () => {
      const { x, z, clubId } = await standardClub();
      const before = await membershipVersion(clubId);
      const holder = await holdClub(clubId, { $inc: { membershipVersion: 1 } });
      const failures: number[] = [];
      setTransactionTestHooks({ onAttemptFailed: (attempt) => void failures.push(attempt) });
      try {
        // The holder keeps its write until the operation has settled, so
        // EVERY attempt conflicts: no timing is involved.
        await assert.rejects(
          membershipService.changeRole(asUser(x), clubId, z.user.id, 'organizer'),
          isAppError(409, 'CONCURRENT_UPDATE'),
        );
      } finally {
        await holder.abort();
        await holder.end();
      }
      assert.deepEqual(failures, [1, 2, 3, 4]);
      assert.equal(await roleOf(clubId, z.user.id), 'staff');
      assert.equal(await membershipVersion(clubId), before);
    });

    it('archive committed during the retry window: the retry sees it and refuses (409)', async () => {
      const { x, clubId } = await standardClub();
      const newcomer = await registerUser('new@example.com');
      const holder = await holdClub(clubId, { $set: { status: 'archived', archivedAt: new Date() } });
      setTransactionTestHooks({
        onAttemptFailed: async (attempt) => {
          if (attempt === 1) await holder.commit(); // archive becomes visible now
        },
      });
      try {
        await assert.rejects(
          membershipService.addMember(asUser(x), clubId, { email: newcomer.user.email, role: 'staff' }),
          (error: unknown) => isAppError(409, 'CONFLICT')(error) && (error as Error).message === 'Club is archived',
        );
      } finally {
        await holder.end();
      }
      assert.equal(await ClubMembership.countDocuments({ club: clubId, user: newcomer.user.id }), 0);
    });

    it('membership change first, archive second: the archive waits and both apply', async () => {
      const { admin, x, clubId } = await standardClub();
      const newcomer = await registerUser('new@example.com');
      const atGate = deferred();
      const gate = deferred();
      setTransactionTestHooks({
        beforeCommit: async () => {
          atGate.resolve();
          await gate.promise;
        },
      });
      const add = membershipService.addMember(asUser(x), clubId, { email: newcomer.user.email, role: 'staff' });
      await atGate.promise; // the transaction holds the shared write now
      const archive = clubService.archiveClub(asAdmin(admin), clubId); // not awaited
      gate.resolve();
      const [added] = await Promise.all([add, archive]);
      assert.equal(added.created, true);
      assert.equal(await roleOf(clubId, newcomer.user.id), 'staff');
      const club = await Club.findById(clubId).lean();
      assert.equal(club?.status, 'archived');
    });
  });

  // -------------------------------------------------------------------------
  // Last-organizer rule under controlled interleavings of two REAL operations
  // -------------------------------------------------------------------------
  // T1 is paused at beforeCommit (it has done the shared write, counted and
  // written). T2 then runs: its shared write conflicts with T1; its hook
  // releases T1 and waits for T1 to commit; T2's retry reads T1's result.
  async function interleave<A, B>(
    first: () => Promise<A>,
    second: () => Promise<B>,
  ): Promise<{ first: PromiseSettledResult<A>; second: PromiseSettledResult<B>; conflicts: number }> {
    const atGate = deferred();
    const gate = deferred();
    let firstDone: Promise<unknown> = Promise.resolve();
    let paused = false;
    let conflicts = 0;
    setTransactionTestHooks({
      beforeCommit: async () => {
        if (paused) return; // only the very first commit is held
        paused = true;
        atGate.resolve();
        await gate.promise;
      },
      onAttemptFailed: async () => {
        conflicts++;
        gate.resolve();
        await firstDone.catch(() => undefined);
      },
    });
    const p1 = first();
    firstDone = p1;
    await atGate.promise;
    // If T2 never conflicts (e.g. a deliberately broken implementation), it
    // finishes on its own: release T1 then too, so the test fails instead of
    // hanging. With the protection in place T2 always conflicts first.
    const p2 = second().finally(() => gate.resolve());
    const [r1, r2] = await Promise.allSettled([p1, p2]);
    return { first: r1, second: r2, conflicts };
  }

  const rejectedWith = (result: PromiseSettledResult<unknown>, status: number) =>
    result.status === 'rejected' && isAppError(status)(result.reason);

  describe('last organizer under concurrency (deterministic interleavings)', () => {
    for (const [label, by] of [['organizers', 'self'], ['admins', 'admin']] as const) {
      it(`remove X while removing Y (${label}): one succeeds, the other 409, 1 organizer left`, async () => {
        const { admin, x, y, clubId } = await standardClub();
        // Organizers: X and Y LEAVE at the same time (if each removed the
        // other, the second would be refused for losing its own rights - 403 -
        // which is correct but would not exercise the rule). Admins: one admin
        // removes both.
        const actorX = by === 'admin' ? asAdmin(admin) : asUser(x);
        const actorY = by === 'admin' ? asAdmin(admin) : asUser(y);
        const r = await interleave(
          () => membershipService.removeMember(actorX, clubId, x.user.id),
          () => membershipService.removeMember(actorY, clubId, y.user.id),
        );
        assert.equal(r.first.status, 'fulfilled');
        assert.ok(rejectedWith(r.second, 409));
        assert.ok(r.conflicts >= 1); // T2 really collided with T1
        assert.equal(await organizerCount(clubId), 1);
      });

      it(`demote X while demoting Y (${label}): exactly one success`, async () => {
        const { admin, x, y, clubId } = await standardClub();
        const actor = by === 'admin' ? asAdmin(admin) : asUser(x);
        const r = await interleave(
          () => membershipService.changeRole(actor, clubId, x.user.id, 'staff'),
          () => membershipService.changeRole(by === 'admin' ? actor : asUser(y), clubId, y.user.id, 'staff'),
        );
        assert.equal(r.first.status, 'fulfilled');
        assert.ok(rejectedWith(r.second, 409));
        assert.equal(await organizerCount(clubId), 1);
      });
    }

    it('remove X while demoting Y: exactly one success', async () => {
      const { x, y, clubId } = await standardClub();
      const r = await interleave(
        () => membershipService.removeMember(asUser(y), clubId, x.user.id),
        () => membershipService.changeRole(asUser(x), clubId, y.user.id, 'staff'),
      );
      // T2 retried after T1 committed; by then its actor (x) is no longer a
      // member, so it is refused by the permission check (403) - checked
      // INSIDE the transaction - or by the rule (409). Either way: refused.
      assert.equal(r.first.status, 'fulfilled');
      assert.equal(r.second.status, 'rejected');
      assert.equal(await organizerCount(clubId), 1);
    });

    it('Y leaves while X is being removed: the leave is refused (last organizer)', async () => {
      const { admin, x, y, clubId } = await standardClub();
      const r = await interleave(
        () => membershipService.removeMember(asAdmin(admin), clubId, x.user.id),
        () => membershipService.removeMember(asUser(y), clubId, y.user.id),
      );
      assert.equal(r.first.status, 'fulfilled');
      assert.ok(rejectedWith(r.second, 409));
      assert.equal(await organizerCount(clubId), 1);
    });

    it('promote Z while removing X: both succeed, count = 2 - 1 + 1', async () => {
      const { admin, x, z, clubId } = await standardClub();
      const r = await interleave(
        () => membershipService.removeMember(asAdmin(admin), clubId, x.user.id),
        () => membershipService.changeRole(asAdmin(admin), clubId, z.user.id, 'organizer'),
      );
      assert.equal(r.first.status, 'fulfilled');
      assert.equal(r.second.status, 'fulfilled');
      assert.equal(await organizerCount(clubId), 2);
    });
  });

  // -------------------------------------------------------------------------
  // updateClub authorization race (ADR-034)
  // -------------------------------------------------------------------------
  describe('club edit vs concurrent demotion (authorization race)', () => {
    it('demotion first: the demoted organizer\'s concurrent edit is refused (403)', async () => {
      const { x, y, clubId } = await standardClub();
      const r = await interleave(
        () => membershipService.changeRole(asUser(y), clubId, x.user.id, 'staff'),
        () => clubService.updateClub(asUser(x), clubId, { description: 'edited by x' }),
      );
      assert.equal(r.first.status, 'fulfilled');
      assert.ok(r.conflicts >= 1); // the edit really collided with the demotion
      assert.ok(rejectedWith(r.second, 403));
      const club = await Club.findById(clubId).lean();
      assert.equal(club?.description, ''); // the edit did not happen
      assert.equal(await roleOf(clubId, x.user.id), 'staff');
    });

    it('edit first: it is serialised before the demotion, both succeed', async () => {
      const { x, y, clubId } = await standardClub();
      const r = await interleave(
        () => clubService.updateClub(asUser(x), clubId, { description: 'edited by x' }),
        () => membershipService.changeRole(asUser(y), clubId, x.user.id, 'staff'),
      );
      assert.equal(r.first.status, 'fulfilled');
      assert.equal(r.second.status, 'fulfilled');
      assert.ok(r.conflicts >= 1);
      const club = await Club.findById(clubId).lean();
      assert.equal(club?.description, 'edited by x');
      assert.equal(await roleOf(clubId, x.user.id), 'staff');
    });

    it('removal first: the removed organizer\'s concurrent edit is refused (403)', async () => {
      const { admin, x, clubId } = await standardClub();
      const r = await interleave(
        () => membershipService.removeMember(asAdmin(admin), clubId, x.user.id),
        () => clubService.updateClub(asUser(x), clubId, { name: 'Renamed by x' }),
      );
      assert.equal(r.first.status, 'fulfilled');
      assert.ok(rejectedWith(r.second, 403));
      const club = await Club.findById(clubId).lean();
      assert.equal(club?.name, 'a Chess Club');
    });
  });

  // -------------------------------------------------------------------------
  // WHY the shared write and the in-transaction count are needed.
  // These tests model the UNSAFE patterns with raw sessions, step by step,
  // and assert that they DO break the rule. They document the exact
  // guarantee each part of the design provides.
  // -------------------------------------------------------------------------
  describe('models of the unsafe patterns (documented failures)', () => {
    async function twoOrganizers() {
      const { x, y, clubId } = await standardClub();
      return { clubId, x: x.user.id, y: y.user.id };
    }

    it('WITHOUT the shared write, snapshot isolation allows write skew: 0 organizers', async () => {
      const { clubId, x, y } = await twoOrganizers();
      const s1 = await mongoose.startSession();
      const s2 = await mongoose.startSession();
      try {
        s1.startTransaction({ readConcern: { level: 'snapshot' } });
        s2.startTransaction({ readConcern: { level: 'snapshot' } });
        const count = (s: mongoose.ClientSession) =>
          ClubMembership.countDocuments({ club: clubId, role: 'organizer' }, { session: s });
        // Both check the rule in their own snapshot: 2 organizers each.
        assert.equal(await count(s1), 2);
        assert.equal(await count(s2), 2);
        // They write DIFFERENT documents, so MongoDB sees no conflict.
        await ClubMembership.deleteOne({ club: clubId, user: x }, { session: s1 });
        await ClubMembership.deleteOne({ club: clubId, user: y }, { session: s2 });
        await s1.commitTransaction();
        await s2.commitTransaction();
      } finally {
        await s1.endSession();
        await s2.endSession();
      }
      // Violated guarantee: nothing forced the two checks to see each other.
      assert.equal(await organizerCount(clubId), 0);
    });

    it('WITH the shared write first, the second transaction cannot commit (WriteConflict)', async () => {
      const { clubId } = await twoOrganizers();
      const s1 = await mongoose.startSession();
      const s2 = await mongoose.startSession();
      try {
        s1.startTransaction({ readConcern: { level: 'snapshot' } });
        s2.startTransaction({ readConcern: { level: 'snapshot' } });
        await Club.updateOne({ _id: clubId }, { $inc: { membershipVersion: 1 } }, { session: s1 });
        await assert.rejects(
          Club.updateOne({ _id: clubId }, { $inc: { membershipVersion: 1 } }, { session: s2 }),
          (error: unknown) =>
            typeof error === 'object' && error !== null &&
            'hasErrorLabel' in error && typeof error.hasErrorLabel === 'function' &&
            error.hasErrorLabel('TransientTransactionError'),
        );
      } finally {
        await s1.abortTransaction().catch(() => undefined);
        await s2.abortTransaction().catch(() => undefined);
        await s1.endSession();
        await s2.endSession();
      }
    });

    it('a count taken BEFORE the shared write and never re-read is stale: 0 organizers', async () => {
      // Models "check outside the synchronised section": T2 counts 2 while
      // T1 is in flight, then (after T1 committed) performs its shared write
      // and deletes WITHOUT counting again. The shared write alone does not
      // help if the decision was made on data read before it.
      const { clubId, x, y } = await twoOrganizers();
      const staleCount = await organizerCount(clubId); // T2's early check: 2

      const s1 = await mongoose.startSession();
      try {
        s1.startTransaction({ readConcern: { level: 'snapshot' } });
        await Club.updateOne({ _id: clubId }, { $inc: { membershipVersion: 1 } }, { session: s1 });
        await ClubMembership.deleteOne({ club: clubId, user: x }, { session: s1 });
        await s1.commitTransaction();
      } finally {
        await s1.endSession();
      }

      assert.equal(staleCount, 2); // T2 "allows" the removal on stale data
      const s2 = await mongoose.startSession();
      try {
        s2.startTransaction({ readConcern: { level: 'snapshot' } });
        await Club.updateOne({ _id: clubId }, { $inc: { membershipVersion: 1 } }, { session: s2 });
        await ClubMembership.deleteOne({ club: clubId, user: y }, { session: s2 });
        await s2.commitTransaction();
      } finally {
        await s2.endSession();
      }
      // Violated guarantee: the count must be read AFTER the shared write,
      // in the same transaction (and therefore again on every retry).
      assert.equal(await organizerCount(clubId), 0);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown commit outcome, by fault injection (mongo-test ONLY)
  // -------------------------------------------------------------------------
  describe('unknown commit outcome (failCommand failpoint)', () => {
    /** True only on the isolated test server (enableTestCommands) + *_test DB. */
    async function failpointsAvailable(): Promise<string | null> {
      if (process.env.NODE_ENV !== 'test') return 'NODE_ENV is not test';
      if (!mongoose.connection.name.endsWith('_test')) return 'not a *_test database';
      const db = mongoose.connection.db;
      if (!db) return 'not connected';
      try {
        const result = await db.admin().command({ getParameter: 1, enableTestCommands: 1 });
        if (result.enableTestCommands !== true) return 'enableTestCommands is off on this server';
      } catch {
        return 'getParameter refused';
      }
      return null;
    }

    async function failCommit(mode: 'alwaysOn' | { times: number }) {
      await mongoose.connection.db!.admin().command({
        configureFailPoint: 'failCommand',
        mode,
        data: {
          failCommands: ['commitTransaction'],
          errorCode: 50, // MaxTimeMSExpired: not retried by the driver itself
          errorLabels: ['UnknownTransactionCommitResult'],
        },
      });
    }

    async function clearFailpoint() {
      const db = mongoose.connection.db;
      if (!db) return;
      await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' }).catch(() => undefined);
      // A transaction left open by the simulated failure would hold the club
      // document until it times out; kill it (test server only).
      await db.admin().command({ killAllSessions: [] }).catch(() => undefined);
    }

    it('commit fails once with an unknown result: commit-only retry, applied exactly once', async (t) => {
      const reason = await failpointsAvailable();
      if (reason) return t.skip(`failpoints unavailable: ${reason}`);
      const { x, z, clubId } = await standardClub();
      const before = await membershipVersion(clubId);
      const unknown: number[] = [];
      setTransactionTestHooks({ onCommitUnknown: (n) => void unknown.push(n) });
      try {
        await failCommit({ times: 1 });
        const membership = await membershipService.changeRole(asUser(x), clubId, z.user.id, 'organizer');
        assert.equal(membership.role, 'organizer');
      } finally {
        await clearFailpoint();
      }
      assert.deepEqual(unknown, [1]);
      assert.equal(await membershipVersion(clubId), before + 1);
    });

    it('commit result stays unknown: 503 TRANSACTION_OUTCOME_UNKNOWN (never 409)', async (t) => {
      const reason = await failpointsAvailable();
      if (reason) return t.skip(`failpoints unavailable: ${reason}`);
      const { x, z, clubId } = await standardClub();
      try {
        await failCommit('alwaysOn');
        await assert.rejects(
          membershipService.changeRole(asUser(x), clubId, z.user.id, 'organizer'),
          isAppError(503, 'TRANSACTION_OUTCOME_UNKNOWN'),
        );
      } finally {
        await clearFailpoint();
      }
      // In THIS simulation the server never ran the commit, so nothing was
      // applied. The API did not claim that: it reported "unknown".
      assert.equal(await roleOf(clubId, z.user.id), 'staff');
      // The documented client recovery: reload, then retry -> desired state.
      const retried = await membershipService.changeRole(asUser(x), clubId, z.user.id, 'organizer');
      assert.equal(retried.role, 'organizer');
    });
  });
});
