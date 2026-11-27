import assert from 'node:assert/strict';
import type { ClientSession } from 'mongoose';
import { describe, it } from 'node:test';
import { AppError } from '../src/shared/errors.ts';
import type { Actor } from '../src/shared/authorize.ts';
import type { CheckInDto } from '../src/modules/checkins/checkin.model.ts';
import {
  checkInOnline,
  syncCheckIns,
  syncFailure,
  ticketQr,
  type CheckInDeps,
} from '../src/modules/checkins/checkin.service.ts';

// Unit tests with doubles: no MongoDB, no HTTP. They exercise the parts of
// §6/§7 that are easy to get wrong (idempotency, result mapping, ordering).

const actor: Actor = { id: '507f1f77bcf86cd799439099', role: 'user' };
const ticketId = '507f1f77bcf86cd799439011';
const otherTicketId = '507f1f77bcf86cd799439012';
const eventId = '507f1f77bcf86cd799439013';
const otherEventId = '507f1f77bcf86cd799439014';
const clubId = '507f1f77bcf86cd799439015';
const KEY_A = '11111111-1111-4111-8111-111111111111';
const KEY_B = '22222222-2222-4222-8222-222222222222';
const KEY_C = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-11-27T12:00:00.000Z');

type TicketView = NonNullable<Awaited<ReturnType<CheckInDeps['getTicket']>>>;

function makeDeps(overrides: Partial<CheckInDeps> = {}) {
  const store: CheckInDto[] = [];
  const tickets = new Map<string, TicketView>([
    [
      ticketId,
      {
        id: ticketId,
        event: eventId,
        club: clubId,
        status: 'confirmed',
        checkedInAt: null,
      },
    ],
    [
      otherTicketId,
      {
        id: otherTicketId,
        event: eventId,
        club: clubId,
        status: 'confirmed',
        checkedInAt: null,
      },
    ],
  ]);
  const attendeeById = new Map<string, string>([
    [ticketId, actor.id],
    [otherTicketId, '507f1f77bcf86cd799439017'],
  ]);
  const calls = { assert: 0, claim: 0, insert: 0, tx: 0, verify: 0 };

  const base: CheckInDeps = {
    now: () => now,
    verifyQr: async (token) => {
      calls.verify++;
      if (token === 'bad') throw new AppError(422, 'INVALID_QR', 'Invalid QR');
      if (token === 'other-event') return { ticketId, eventId: otherEventId };
      if (token === 'other-ticket') return { ticketId: otherTicketId, eventId };
      if (token === 'retry') {
        throw new AppError(409, 'CONCURRENT_UPDATE', 'Concurrent update');
      }
      return { ticketId, eventId };
    },
    signQr: async () => 'signed-token',
    getTicket: async (id) => tickets.get(id) ?? null,
    findTicketAttendee: async (id) => attendeeById.get(id) ?? null,
    claim: async (id, scannedEvent, at, session) => {
      calls.claim++;
      assert.ok(session, 'the claim must run inside the transaction');
      const current = tickets.get(id);
      if (!current || current.status !== 'confirmed' || current.checkedInAt) {
        return null;
      }
      tickets.set(id, { ...current, checkedInAt: at });
      return {
        id,
        event: scannedEvent,
        club: current.club,
        attendee: attendeeById.get(id) ?? '',
        status: 'confirmed' as const,
        checkedInAt: at,
      };
    },
    getEvent: async (id) => {
      if (id !== eventId) throw AppError.notFound('Event not found');
      return {
        id,
        clubId,
        status: 'published' as const,
        endsAt: new Date('2026-11-27T18:00:00.000Z'),
      };
    },
    assertRole: async () => {
      calls.assert++;
      return {
        club: { id: clubId, name: 'Club', status: 'active' as const },
        role: 'staff' as const,
        viaAdmin: false,
      };
    },
    findByKey: async (key) => store.find((item) => item.idempotencyKey === key) ?? null,
    findByTicket: async (id) => store.find((item) => item.ticketId === id) ?? null,
    insert: async (input, session) => {
      calls.insert++;
      assert.ok(session, 'the check-in insert must run inside the transaction');
      const created: CheckInDto = {
        id: `checkin-${store.length + 1}`,
        ticketId: input.ticketId,
        eventId: input.eventId,
        clubId: input.clubId,
        staffId: input.staffId,
        idempotencyKey: input.idempotencyKey,
        source: input.source,
        scannedAt: input.scannedAt,
        checkedInAt: input.checkedInAt,
      };
      store.push(created);
      return created;
    },
    listEventTickets: async () => [],
    publicKeyPem: () => 'PUBLIC-KEY',
    runInTransaction: async (work) => {
      calls.tx++;
      return work({} as ClientSession);
    },
  };

  return { deps: { ...base, ...overrides }, store, tickets, calls };
}

function hasCode(code: string) {
  return (error: unknown): boolean =>
    error instanceof AppError && error.code === code;
}

describe('check-in service (doubles, no Mongo)', () => {
  it('claims once in a transaction and stores the authoritative time', async () => {
    const { deps, store, calls, tickets } = makeDeps();
    const result = await checkInOnline(actor, eventId, {
      qrToken: 'ok',
      idempotencyKey: KEY_A,
    }, deps);

    assert.equal(result.result, 'accepted');
    assert.equal(result.ticketId, ticketId);
    assert.deepEqual(result.checkedInAt, now);
    assert.equal(calls.tx, 1);
    assert.equal(calls.claim, 1);
    assert.equal(calls.assert, 1);
    assert.equal(store.length, 1);
    assert.equal(store[0]?.source, 'online');
    assert.equal(store[0]?.staffId, actor.id);
    assert.deepEqual(tickets.get(ticketId)?.checkedInAt, now);
  });

  it('same key + same ticket -> duplicate, without a second claim', async () => {
    const { deps, calls, store } = makeDeps();
    const first = await checkInOnline(actor, eventId, {
      qrToken: 'ok',
      idempotencyKey: KEY_A,
    }, deps);
    const second = await checkInOnline(actor, eventId, {
      qrToken: 'ok',
      idempotencyKey: KEY_A,
    }, deps);

    assert.equal(first.result, 'accepted');
    assert.deepEqual(second, { ...first, result: 'duplicate' });
    assert.equal(calls.claim, 1);
    assert.equal(calls.insert, 1);
    assert.equal(store.length, 1);
  });

  it('same key + another ticket -> 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const { deps } = makeDeps();
    await checkInOnline(actor, eventId, { qrToken: 'ok', idempotencyKey: KEY_A }, deps);
    await assert.rejects(
      () => checkInOnline(actor, eventId, { qrToken: 'other-ticket', idempotencyKey: KEY_A }, deps),
      hasCode('IDEMPOTENCY_KEY_REUSED'),
    );
  });

  it('double scan with another key -> 409 ALREADY_CHECKED_IN with the stored time', async () => {
    const { deps, calls } = makeDeps();
    const first = await checkInOnline(actor, eventId, {
      qrToken: 'ok',
      idempotencyKey: KEY_A,
    }, deps);
    await assert.rejects(
      () => checkInOnline(actor, eventId, { qrToken: 'ok', idempotencyKey: KEY_B }, deps),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'ALREADY_CHECKED_IN' &&
        (error.details as { checkedInAt: Date }).checkedInAt === first.checkedInAt,
    );
    assert.equal(calls.claim, 1);
  });

  it('rejects an invalid QR, a wrong event, a non-confirmed ticket and a removed staff member', async () => {
    const invalid = makeDeps();
    await assert.rejects(
      () => checkInOnline(actor, eventId, { qrToken: 'bad', idempotencyKey: KEY_A }, invalid.deps),
      hasCode('INVALID_QR'),
    );
    await assert.rejects(
      () => checkInOnline(actor, eventId, { qrToken: 'other-event', idempotencyKey: KEY_B }, invalid.deps),
      hasCode('WRONG_EVENT'),
    );

    const waitlisted = makeDeps();
    const ticket = waitlisted.tickets.get(ticketId);
    if (!ticket) throw new Error('missing fixture');
    waitlisted.tickets.set(ticketId, { ...ticket, status: 'waitlisted' });
    await assert.rejects(
      () => checkInOnline(actor, eventId, { qrToken: 'ok', idempotencyKey: KEY_A }, waitlisted.deps),
      hasCode('TICKET_NOT_CONFIRMED'),
    );
    assert.equal(waitlisted.calls.claim, 0);

    const removed = makeDeps({
      assertRole: async () => {
        throw AppError.forbidden('No longer a staff member');
      },
    });
    await assert.rejects(
      () => checkInOnline(actor, eventId, { qrToken: 'ok', idempotencyKey: KEY_A }, removed.deps),
      hasCode('FORBIDDEN'),
    );
    assert.equal(removed.calls.claim, 0);
  });

  it('sync returns one result per item in ARRIVAL order, never by scannedAt', async () => {
    const { deps, store } = makeDeps();
    const results = await syncCheckIns(actor, {
      items: [
        {
          idempotencyKey: KEY_A,
          qrToken: 'retry',
          eventId,
          scannedAt: '2026-11-27T18:00:00.000Z',
        },
        {
          idempotencyKey: KEY_B,
          qrToken: 'bad',
          eventId,
          scannedAt: '2026-11-27T06:00:00.000Z',
        },
        {
          idempotencyKey: KEY_C,
          qrToken: 'ok',
          eventId,
          scannedAt: '2026-11-27T06:00:00.000Z',
        },
      ],
    }, deps);

    assert.deepEqual(results.map((item) => item.result), [
      'retry',
      'rejected',
      'accepted',
    ]);
    assert.equal(results[0]?.reason, 'CONCURRENT_UPDATE');
    assert.equal(results[1]?.reason, 'INVALID_QR');
    assert.equal(results[2]?.checkedInAt, now);
    assert.equal(store.length, 1);
    assert.equal(store[0]?.source, 'offline');
    // The accepted item was scanned first on the device but arrived last.
    assert.equal(store[0]?.scannedAt.toISOString(), '2026-11-27T06:00:00.000Z');
  });

  it('sync maps key reuse and double scans without failing the batch', async () => {
    const { deps } = makeDeps();
    const results = await syncCheckIns(actor, {
      items: [
        {
          idempotencyKey: KEY_A,
          qrToken: 'ok',
          eventId,
          scannedAt: '2026-11-27T06:00:00.000Z',
        },
        {
          idempotencyKey: KEY_A,
          qrToken: 'other-ticket',
          eventId,
          scannedAt: '2026-11-27T07:00:00.000Z',
        },
        {
          idempotencyKey: KEY_B,
          qrToken: 'ok',
          eventId,
          scannedAt: '2026-11-27T08:00:00.000Z',
        },
      ],
    }, deps);

    assert.equal(results[0]?.result, 'accepted');
    assert.deepEqual(
      { result: results[1]?.result, reason: results[1]?.reason },
      { result: 'rejected', reason: 'IDEMPOTENCY_KEY_REUSED' },
    );
    assert.equal(results[2]?.result, 'already_checked_in');
    assert.equal(results[2]?.checkedInAt, now);
  });

  it('maps uncertain transactions and network failures to retry', () => {
    assert.deepEqual(
      syncFailure(KEY_A, new AppError(503, 'TRANSACTION_OUTCOME_UNKNOWN', 'unknown')),
      { idempotencyKey: KEY_A, result: 'retry', reason: 'TRANSACTION_OUTCOME_UNKNOWN' },
    );
    assert.deepEqual(
      syncFailure(KEY_A, { errorLabels: ['TransientTransactionError'] }),
      { idempotencyKey: KEY_A, result: 'retry', reason: 'NETWORK_ERROR' },
    );
    assert.deepEqual(
      syncFailure(KEY_A, new AppError(409, 'ALREADY_CHECKED_IN', 'used', { checkedInAt: now })),
      { idempotencyKey: KEY_A, result: 'already_checked_in', checkedInAt: now },
    );
  });

  it('serves a QR only to the ticket owner, for a confirmed ticket', async () => {
    const { deps, calls } = makeDeps();
    assert.deepEqual(await ticketQr(actor, ticketId, deps), { qrToken: 'signed-token' });
    await assert.rejects(
      () => ticketQr({ id: otherTicketId, role: 'user' }, ticketId, deps),
      hasCode('NOT_FOUND'),
    );
    const { deps: otherDeps, tickets } = makeDeps();
    const ticket = tickets.get(ticketId);
    if (!ticket) throw new Error('missing fixture');
    tickets.set(ticketId, { ...ticket, status: 'cancelled' });
    await assert.rejects(
      () => ticketQr(actor, ticketId, otherDeps),
      hasCode('TICKET_NOT_CONFIRMED'),
    );
    assert.equal(calls.verify, 0); // QR service is not needed to issue a QR
  });
});
