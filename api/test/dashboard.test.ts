import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { claimTicketForCheckIn } from '../src/modules/tickets/ticket.service.ts';
import { createAdmin, standardClub } from './club-fixtures.ts';
import { attendees, cancel, createEvent, registerFor } from './event-fixtures.ts';
import {
  api,
  bearer,
  closeTestDatabase,
  connectTestDatabase,
  resetDatabase,
  type Session,
} from './helpers.ts';

// REQUIRES the `mongo-test` container (npm run db:up).
const MISSING_ID = '0123456789abcdef01234567';

const dashboard = (session: Session, eventId: string) =>
  api.get(`/api/v1/events/${eventId}/dashboard`).set(bearer(session.accessToken));

/** Check-in as Member 4 will do it: the tickets module's claim, in a transaction. */
async function checkIn(ticketId: string, eventId: string) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await claimTicketForCheckIn(ticketId, eventId, new Date(), session);
    });
  } finally {
    await session.endSession();
  }
}

describe('event dashboard', () => {
  before(connectTestDatabase);
  beforeEach(resetDatabase);
  after(closeTestDatabase);

  it('organizer: counts per status, attendance and registrations per day', async () => {
    const { x, clubId } = await standardClub();
    const eventId = await createEvent(x, clubId, { capacity: 2 });
    const [a, b, c, d] = await attendees('u', 4);

    const ticketA = (await registerFor(a!, eventId)).body.data.id as string; // confirmed
    await registerFor(b!, eventId); // confirmed
    await registerFor(c!, eventId); // waitlisted
    const ticketD = (await registerFor(d!, eventId)).body.data.id as string; // waitlisted
    assert.equal((await cancel(d!, ticketD)).status, 204); // cancelled
    await checkIn(ticketA, eventId);

    const res = await dashboard(x, eventId);

    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.eventId, eventId);
    assert.equal(data.capacity, 2);
    assert.equal(data.confirmed, 2);
    assert.equal(data.waitlisted, 1);
    assert.equal(data.cancelled, 1);
    assert.equal(data.checkedIn, 1);
    assert.equal(data.seatsLeft, 0);
    assert.equal(data.attendanceRate, 0.5);
    const today = new Date().toISOString().slice(0, 10);
    assert.deepEqual(data.registrationsPerDay, [{ date: today, count: 4 }]);
  });

  it('a new event: zeros, unlimited places, no attendance rate yet', async () => {
    const { x, clubId } = await standardClub();
    const eventId = await createEvent(x, clubId, { capacity: null });

    const res = await dashboard(x, eventId);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.confirmed, 0);
    assert.equal(res.body.data.capacity, null);
    assert.equal(res.body.data.seatsLeft, null);
    assert.equal(res.body.data.attendanceRate, null);
    assert.deepEqual(res.body.data.registrationsPerDay, []);
  });

  it('counts only the tickets of THIS event', async () => {
    const { x, clubId } = await standardClub();
    const first = await createEvent(x, clubId);
    const second = await createEvent(x, clubId, { title: 'Second night' });
    const [a] = await attendees('u', 1);
    await registerFor(a!, second);

    const res = await dashboard(x, first);

    assert.equal(res.body.data.confirmed, 0);
  });

  describe('authorization (A7, A12)', () => {
    it('401 without a token', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId);

      const res = await api.get(`/api/v1/events/${eventId}/dashboard`);

      assert.equal(res.status, 401);
    });

    it('403 for an attendee of the event and for a user outside the club', async () => {
      const { x, outsider, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId);
      const [a] = await attendees('u', 1);
      await registerFor(a!, eventId);

      assert.equal((await dashboard(a!, eventId)).status, 403);
      assert.equal((await dashboard(outsider, eventId)).status, 403);
    });

    it('403 for the door staff of the club (organizers only)', async () => {
      const { x, z, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId);

      assert.equal((await dashboard(z, eventId)).status, 403);
    });

    it("403 for an organizer of ANOTHER club (club A's role gives nothing on club B)", async () => {
      const clubA = await standardClub('a');
      const clubB = await standardClub('b');
      const eventOfA = await createEvent(clubA.x, clubA.clubId);

      const res = await dashboard(clubB.x, eventOfA);

      assert.equal(res.status, 403);
    });

    it('403 for a global admin without a membership (no admin bypass, D3)', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId);
      const otherAdmin = await createAdmin('other-admin@example.com');

      assert.equal((await dashboard(otherAdmin, eventId)).status, 403);
    });
  });

  describe('validation', () => {
    it('404 for an unknown event, 422 for an invalid id', async () => {
      const { x } = await standardClub();

      const missing = await dashboard(x, MISSING_ID);
      const invalid = await dashboard(x, 'not-an-id');

      assert.equal(missing.status, 404);
      assert.equal(invalid.status, 422);
    });
  });
});
