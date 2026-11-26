import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { Event } from '../src/modules/events/event.model.ts';
import { Ticket } from '../src/modules/tickets/ticket.model.ts';
import {
  claimTicketForCheckIn,
  getTicketForCheckIn,
} from '../src/modules/tickets/ticket.service.ts';
import { standardClub } from './club-fixtures.ts';
import { attendees, cancel, createEvent, registerFor, seatState } from './event-fixtures.ts';
import {
  api,
  bearer,
  closeTestDatabase,
  connectTestDatabase,
  resetDatabase,
} from './helpers.ts';

// REQUIRES the `mongo-test` container (npm run db:up).
const MISSING_ID = '0123456789abcdef01234567';

/** Runs the check-in claim inside a real transaction, as Member 4 will. */
async function claimInTransaction(ticketId: string, eventId: string) {
  const session = await mongoose.startSession();
  try {
    let result: Awaited<ReturnType<typeof claimTicketForCheckIn>> = null;
    await session.withTransaction(async () => {
      result = await claimTicketForCheckIn(ticketId, eventId, new Date(), session);
    });
    return result as Awaited<ReturnType<typeof claimTicketForCheckIn>>;
  } finally {
    await session.endSession();
  }
}

describe('registration and tickets', () => {
  before(connectTestDatabase);
  beforeEach(resetDatabase);
  after(closeTestDatabase);

  describe('registration', () => {
    it('confirmed while seats are free, then waitlisted in order; again -> 200 same ticket', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId, { capacity: 1 });
      const [a, b, c] = await attendees('u', 3);

      const first = await registerFor(a!, eventId);
      assert.equal(first.status, 201);
      assert.equal(first.body.data.status, 'confirmed');
      assert.equal(first.body.data.waitlistPosition, null);

      const second = await registerFor(b!, eventId);
      const third = await registerFor(c!, eventId);
      assert.equal(second.body.data.status, 'waitlisted');
      assert.equal(second.body.data.waitlistPosition, 1);
      assert.equal(third.body.data.waitlistPosition, 2);

      const again = await registerFor(a!, eventId);
      assert.equal(again.status, 200);
      assert.equal(again.body.data.id, first.body.data.id);
      assert.equal(await Ticket.countDocuments({ event: eventId }), 3);
    });

    it('unlimited capacity: everybody is confirmed', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId, { capacity: null });
      for (const s of await attendees('u', 3)) {
        assert.equal((await registerFor(s, eventId)).body.data.status, 'confirmed');
      }
      assert.equal((await seatState(eventId)).confirmedCount, 3);
    });

    it('CONCURRENCY: 12 simultaneous registrations for 5 seats never oversell', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId, { capacity: 5 });
      const people = await attendees('u', 12);
      const results = await Promise.all(people.map((s) => registerFor(s, eventId)));

      // Every request either registered (201) or was told to retry (409
      // CONCURRENT_UPDATE, nothing applied) - never a 500, never an oversell.
      for (const r of results) {
        assert.ok(r.status === 201 || (r.status === 409 && r.body.error.code === 'CONCURRENT_UPDATE'), `status ${r.status}`);
      }
      const registered = results.filter((r) => r.status === 201).length;
      const state = await seatState(eventId);
      assert.ok(state.confirmed <= 5);
      assert.equal(state.confirmed, Math.min(5, registered)); // seats filled first
      assert.equal(state.confirmedCount, state.confirmed); // I1 counter consistent
      // I4: waitlist sequence numbers are unique and increasing.
      assert.equal(new Set(state.waitlistSeqs).size, state.waitlistSeqs.length);
      assert.deepEqual([...state.waitlistSeqs].sort((p, q) => p! - q!), state.waitlistSeqs);
      assert.equal(await Ticket.countDocuments({ event: eventId }), registered);
    });

    it('CONCURRENCY: the same user registering twice at once gets ONE ticket', async () => {
      const { x, outsider, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId);
      const results = await Promise.all([registerFor(outsider, eventId), registerFor(outsider, eventId)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
      assert.equal(await Ticket.countDocuments({ event: eventId, attendee: outsider.user.id }), 1);
      assert.equal((await seatState(eventId)).confirmedCount, 1);
    });

    it('ended event or unknown event', async () => {
      const { x, outsider, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId);
      await Event.updateOne({ _id: eventId }, { $set: { startsAt: new Date(Date.now() - 7_200_000), endsAt: new Date(Date.now() - 3_600_000) } });
      const ended = await registerFor(outsider, eventId);
      assert.equal(ended.status, 409);
      assert.equal(ended.body.error.code, 'EVENT_CLOSED');
      assert.equal((await registerFor(outsider, MISSING_ID)).status, 404);
    });
  });

  describe('cancellation and promotion', () => {
    it('cancelling a confirmed ticket promotes the FIRST waitlisted (FIFO), repeatedly', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId, { capacity: 2 });
      const [p1, p2, w1, w2, w3] = await attendees('u', 5);
      const tickets: Record<string, string> = {};
      for (const s of [p1!, p2!, w1!, w2!, w3!]) {
        tickets[s.user.id] = (await registerFor(s, eventId)).body.data.id;
      }

      assert.equal((await cancel(p1!, tickets[p1!.user.id]!)).status, 204);
      let state = await seatState(eventId);
      assert.deepEqual(state.waitlistAttendees, [w2!.user.id, w3!.user.id]); // w1 promoted
      assert.equal(state.confirmed, 2);
      assert.equal(state.confirmedCount, 2);

      assert.equal((await cancel(p2!, tickets[p2!.user.id]!)).status, 204);
      state = await seatState(eventId);
      assert.deepEqual(state.waitlistAttendees, [w3!.user.id]); // then w2
      const promoted = await api.get(`/api/v1/tickets/${tickets[w2!.user.id]}`).set(bearer(w2!.accessToken));
      assert.equal(promoted.body.data.status, 'confirmed');
      const waiting = await api.get(`/api/v1/tickets/${tickets[w3!.user.id]}`).set(bearer(w3!.accessToken));
      assert.equal(waiting.body.data.waitlistPosition, 1);
    });

    it('cancelling a waitlisted ticket frees no seat and keeps the order of the others', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId, { capacity: 1 });
      const [p, w1, w2] = await attendees('u', 3);
      await registerFor(p!, eventId);
      const t1 = (await registerFor(w1!, eventId)).body.data.id;
      await registerFor(w2!, eventId);
      assert.equal((await cancel(w1!, t1)).status, 204);
      const state = await seatState(eventId);
      assert.equal(state.confirmed, 1);
      assert.deepEqual(state.waitlistAttendees, [w2!.user.id]);
    });

    it('CONCURRENCY: two confirmed tickets cancelled at once promote exactly the first two', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId, { capacity: 2 });
      const [p1, p2, w1, w2, w3] = await attendees('u', 5);
      const t1 = (await registerFor(p1!, eventId)).body.data.id;
      const t2 = (await registerFor(p2!, eventId)).body.data.id;
      for (const s of [w1!, w2!, w3!]) await registerFor(s, eventId);

      const results = await Promise.all([cancel(p1!, t1), cancel(p2!, t2)]);
      assert.deepEqual(results.map((r) => r.status), [204, 204]);
      const state = await seatState(eventId);
      assert.equal(state.confirmed, 2);
      assert.equal(state.confirmedCount, 2);
      assert.deepEqual(state.waitlistAttendees, [w3!.user.id]); // w1 and w2 promoted
    });

    it('idempotent; re-registering reuses the same ticket and joins the END of the queue', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId, { capacity: 1 });
      const [p, w] = await attendees('u', 2);
      const ticketId = (await registerFor(p!, eventId)).body.data.id;
      assert.equal((await cancel(p!, ticketId)).status, 204);
      assert.equal((await cancel(p!, ticketId)).status, 204); // already cancelled
      await registerFor(w!, eventId); // takes the free seat
      const again = await registerFor(p!, eventId);
      assert.equal(again.status, 201);
      assert.equal(again.body.data.id, ticketId); // same document (I2)
      assert.equal(again.body.data.status, 'waitlisted');
    });
  });

  describe('authorization (BOLA)', () => {
    it('another attendee sees and cancels nothing (404); staff reads but cannot cancel (403)', async () => {
      const a = await standardClub('a');
      const b = await standardClub('b');
      const eventId = await createEvent(a.x, a.clubId);
      const [owner, stranger] = await attendees('u', 2);
      const ticketId = (await registerFor(owner!, eventId)).body.data.id;

      const get = (token: string) => api.get(`/api/v1/tickets/${ticketId}`).set(bearer(token));
      const del = (token: string) => api.delete(`/api/v1/tickets/${ticketId}`).set(bearer(token));

      assert.equal((await get(stranger!.accessToken)).status, 404);
      assert.equal((await del(stranger!.accessToken)).status, 404);
      assert.equal((await get(b.x.accessToken)).status, 404); // organizer of ANOTHER club
      assert.equal((await get(a.admin.accessToken)).status, 404); // admin without membership (D3)
      assert.equal((await get(a.z.accessToken)).status, 200); // staff of the club
      assert.equal((await del(a.z.accessToken)).status, 403);
      assert.equal((await get(owner!.accessToken)).status, 200);
      assert.equal((await del(a.x.accessToken)).status, 204); // organizer of the club
      assert.equal((await api.get(`/api/v1/tickets/123`).set(bearer(owner!.accessToken))).status, 422);
    });

    it('/tickets/me lists only my tickets, paginated, with a status filter', async () => {
      const { x, clubId } = await standardClub();
      const e1 = await createEvent(x, clubId, { title: 'First one' });
      const e2 = await createEvent(x, clubId, { title: 'Second one' });
      const [me, other] = await attendees('u', 2);
      await registerFor(me!, e1);
      await registerFor(me!, e2);
      await registerFor(other!, e1);
      const res = await api.get('/api/v1/tickets/me?limit=1').set(bearer(me!.accessToken));
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.meta, { page: 1, limit: 1, total: 2, totalPages: 2 });
      const waitlisted = await api.get('/api/v1/tickets/me?status=waitlisted').set(bearer(me!.accessToken));
      assert.equal(waitlisted.body.data.length, 0);
    });
  });

  describe('provisional check-in contract (for Member 4)', () => {
    it('claims a confirmed ticket ONCE; refuses waitlisted, wrong event and repeats', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId, { capacity: 1 });
      const otherEvent = await createEvent(x, clubId, { title: 'Other event' });
      const [p, w] = await attendees('u', 2);
      const confirmed = (await registerFor(p!, eventId)).body.data.id;
      const waitlisted = (await registerFor(w!, eventId)).body.data.id;

      assert.equal(await claimInTransaction(confirmed, otherEvent), null); // wrong event
      assert.equal(await claimInTransaction(waitlisted, eventId), null); // not confirmed
      const claim = await claimInTransaction(confirmed, eventId);
      assert.equal(claim?.id, confirmed);
      assert.ok(claim?.checkedInAt instanceof Date);
      assert.equal(await claimInTransaction(confirmed, eventId), null); // I3: only once
      assert.equal(await claimInTransaction('not-an-id', eventId), null);

      const view = await getTicketForCheckIn(confirmed);
      assert.deepEqual(Object.keys(view ?? {}).sort(), ['checkedInAt', 'club', 'event', 'id', 'status']);
      assert.equal(view?.club, clubId);
      assert.equal(await getTicketForCheckIn(MISSING_ID), null);

      // I5: a checked-in ticket cannot be cancelled.
      const res = await cancel(p!, confirmed);
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'TICKET_ALREADY_USED');
    });

    it('CONCURRENCY: check-in claim racing a cancellation - exactly one wins', async () => {
      for (let round = 0; round < 5; round++) {
        await resetDatabase();
        const { x, clubId } = await standardClub(`r${round}`);
        const eventId = await createEvent(x, clubId);
        const [p] = await attendees(`r${round}-u`, 1);
        const ticketId = (await registerFor(p!, eventId)).body.data.id;

        const [cancelResult, claim] = await Promise.all([
          cancel(p!, ticketId),
          claimInTransaction(ticketId, eventId),
        ]);
        const stored = await Ticket.findById(ticketId).lean();
        if (claim) {
          assert.equal(cancelResult.status, 409); // claimed first: cancel refused
          assert.equal(stored?.status, 'confirmed');
          assert.ok(stored?.checkedInAt);
        } else {
          assert.equal(cancelResult.status, 204); // cancelled first: claim refused
          assert.equal(stored?.status, 'cancelled');
          assert.equal(stored?.checkedInAt, null);
        }
      }
    });

    it('a cancelled ticket can never be claimed', async () => {
      const { x, outsider, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId);
      const ticketId = (await registerFor(outsider, eventId)).body.data.id;
      await cancel(outsider, ticketId);
      assert.equal(await claimInTransaction(ticketId, eventId), null);
    });
  });
});
