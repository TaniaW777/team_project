import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Event } from '../src/modules/events/event.model.ts';
import { createClub, standardClub } from './club-fixtures.ts';
import { attendees, createEvent, inDays, registerFor, seatState } from './event-fixtures.ts';
import {
  api,
  bearer,
  closeTestDatabase,
  connectTestDatabase,
  registerUser,
  resetDatabase,
} from './helpers.ts';

// REQUIRES the `mongo-test` container (npm run db:up).
const EVENTS = '/api/v1/events';
const MISSING_ID = '0123456789abcdef01234567';

describe('events', () => {
  before(connectTestDatabase);
  beforeEach(resetDatabase);
  after(closeTestDatabase);

  describe('creation (organizer of the club)', () => {
    it('an organizer creates an event: 201 with the public DTO', async () => {
      const { x, clubId } = await standardClub();
      const res = await api.post(EVENTS).set(bearer(x.accessToken)).send({
        clubId, title: ' Chess night ', location: 'Room B12',
        startsAt: inDays(1), endsAt: inDays(1, 3), capacity: 30,
      });
      assert.equal(res.status, 201);
      const event = res.body.data;
      assert.deepEqual(Object.keys(event).sort(), [
        'capacity', 'clubId', 'confirmedCount', 'createdAt', 'description', 'endsAt',
        'id', 'location', 'seatsLeft', 'startsAt', 'status', 'title',
      ]);
      assert.equal(event.title, 'Chess night');
      assert.equal(event.status, 'published');
      assert.equal(event.seatsLeft, 30);
      assert.ok(!res.text.includes('seatVersion'));
    });

    it('staff, outsiders, admins without membership (D3) and other clubs: 403', async () => {
      const a = await standardClub('a');
      const b = await standardClub('b');
      const body = { clubId: a.clubId, title: 'Event', location: 'X', startsAt: inDays(1), endsAt: inDays(2) };
      for (const session of [a.z, a.outsider, a.admin, b.x]) {
        const res = await api.post(EVENTS).set(bearer(session.accessToken)).send(body);
        assert.equal(res.status, 403);
      }
    });

    it('unknown club 404, archived club 409', async () => {
      const { admin, x, clubId } = await standardClub();
      const missing = await api.post(EVENTS).set(bearer(x.accessToken)).send({
        clubId: MISSING_ID, title: 'Event', location: 'X', startsAt: inDays(1), endsAt: inDays(2),
      });
      assert.equal(missing.status, 404);
      await api.delete(`/api/v1/clubs/${clubId}`).set(bearer(admin.accessToken));
      const archived = await api.post(EVENTS).set(bearer(x.accessToken)).send({
        clubId, title: 'Event', location: 'X', startsAt: inDays(1), endsAt: inDays(2),
      });
      assert.equal(archived.status, 409);
    });

    it('validates input: dates, capacity, ids (422)', async () => {
      const { x, clubId } = await standardClub();
      const send = (body: object) => api.post(EVENTS).set(bearer(x.accessToken)).send(body);
      const base = { clubId, title: 'Event', location: 'X', startsAt: inDays(1), endsAt: inDays(2) };
      assert.equal((await send({ ...base, endsAt: inDays(0, 1) })).status, 422); // ends before start
      assert.equal((await send({ ...base, startsAt: inDays(-1), endsAt: inDays(1) })).status, 422); // past
      assert.equal((await send({ ...base, capacity: 0 })).status, 422);
      assert.equal((await send({ ...base, clubId: '123' })).status, 422);
      assert.equal((await send({ ...base, startsAt: 'not-a-date' })).status, 422);
    });

    it('ignores mass-assignment fields', async () => {
      const { x, clubId } = await standardClub();
      const res = await api.post(EVENTS).set(bearer(x.accessToken)).send({
        clubId, title: 'Event', location: 'X', startsAt: inDays(1), endsAt: inDays(2),
        status: 'cancelled', confirmedCount: 99, waitlistCounter: 5, seatVersion: 7, createdBy: MISSING_ID,
      });
      assert.equal(res.status, 201);
      const stored = await Event.findById(res.body.data.id).select('+seatVersion').lean();
      assert.equal(stored?.status, 'published');
      assert.equal(stored?.confirmedCount, 0);
      assert.equal(stored?.waitlistCounter, 0);
      assert.equal(stored?.seatVersion, 0);
      assert.equal(stored?.createdBy.toString(), x.user.id);
    });
  });

  describe('reading', () => {
    it('lists published events by date with pagination, filters and a capped limit', async () => {
      const { x, admin, clubId } = await standardClub();
      const other = await createClub(admin, 'Drama Club');
      await createEvent(x, clubId, { title: 'Late chess', startsAt: inDays(3), endsAt: inDays(3, 2) });
      await createEvent(x, clubId, { title: 'Early chess', startsAt: inDays(1), endsAt: inDays(1, 2) });
      const reader = await registerUser('reader@example.com');
      const page = await api.get(`${EVENTS}?limit=1`).set(bearer(reader.accessToken));
      assert.equal(page.status, 200);
      assert.deepEqual(page.body.meta, { page: 1, limit: 1, total: 2, totalPages: 2 });
      assert.equal(page.body.data[0].title, 'Early chess');
      const byClub = await api.get(`${EVENTS}?clubId=${other}`).set(bearer(reader.accessToken));
      assert.equal(byClub.body.data.length, 0);
      const search = await api.get(`${EVENTS}?q=LATE`).set(bearer(reader.accessToken));
      assert.equal(search.body.data.length, 1);
      const literal = await api.get(`${EVENTS}?q=${encodeURIComponent('.*')}`).set(bearer(reader.accessToken));
      assert.equal(literal.body.data.length, 0);
      assert.equal((await api.get(`${EVENTS}?limit=101`).set(bearer(reader.accessToken))).status, 422);
      assert.equal((await api.get(EVENTS)).status, 401);
    });

    it('detail: 200, unknown 404, malformed id 422', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId);
      assert.equal((await api.get(`${EVENTS}/${eventId}`).set(bearer(x.accessToken))).status, 200);
      assert.equal((await api.get(`${EVENTS}/${MISSING_ID}`).set(bearer(x.accessToken))).status, 404);
      assert.equal((await api.get(`${EVENTS}/123`).set(bearer(x.accessToken))).status, 422);
    });
  });

  describe('update and cancellation', () => {
    it('only organizers of THIS club update (staff and other clubs 403)', async () => {
      const a = await standardClub('a');
      const b = await standardClub('b');
      const eventId = await createEvent(a.x, a.clubId);
      const patch = (token: string) =>
        api.patch(`${EVENTS}/${eventId}`).set(bearer(token)).send({ title: 'Renamed' });
      assert.equal((await patch(a.z.accessToken)).status, 403);
      assert.equal((await patch(b.x.accessToken)).status, 403);
      const ok = await patch(a.y.accessToken);
      assert.equal(ok.status, 200);
      assert.equal(ok.body.data.title, 'Renamed');
    });

    it('capacity cannot drop below confirmed registrations (409)', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId, { capacity: 3 });
      for (const s of await attendees('u', 2)) await registerFor(s, eventId);
      const res = await api.patch(`${EVENTS}/${eventId}`).set(bearer(x.accessToken)).send({ capacity: 1 });
      assert.equal(res.status, 409);
    });

    it('raising capacity promotes waitlisted tickets in order', async () => {
      const { x, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId, { capacity: 1 });
      const [a, b, c, d] = await attendees('u', 4);
      for (const s of [a!, b!, c!, d!]) await registerFor(s, eventId);
      const res = await api.patch(`${EVENTS}/${eventId}`).set(bearer(x.accessToken)).send({ capacity: 3 });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.confirmedCount, 3);
      const state = await seatState(eventId);
      assert.equal(state.confirmed, 3);
      assert.equal(state.confirmedCount, 3);
      assert.deepEqual(state.waitlistAttendees, [d!.user.id]); // b and c promoted, d still waits
    });

    it('cancelling an event closes registration (409 EVENT_CLOSED)', async () => {
      const { x, outsider, clubId } = await standardClub();
      const eventId = await createEvent(x, clubId);
      assert.equal((await api.delete(`${EVENTS}/${eventId}`).set(bearer(x.accessToken))).status, 204);
      assert.equal((await api.delete(`${EVENTS}/${eventId}`).set(bearer(x.accessToken))).status, 204);
      const res = await registerFor(outsider, eventId);
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'EVENT_CLOSED');
      const edit = await api.patch(`${EVENTS}/${eventId}`).set(bearer(x.accessToken)).send({ title: 'X y z' });
      assert.equal(edit.status, 409);
    });
  });
});
