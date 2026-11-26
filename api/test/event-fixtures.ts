import { Event } from '../src/modules/events/event.model.ts';
import { Ticket } from '../src/modules/tickets/ticket.model.ts';
import { api, bearer, registerUser, type Session } from './helpers.ts';

// Fixtures for the events and tickets tests.

export const inDays = (days: number, hours = 0) =>
  new Date(Date.now() + days * 86_400_000 + hours * 3_600_000).toISOString();

export async function createEvent(
  organizer: Session,
  clubId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await api
    .post('/api/v1/events')
    .set(bearer(organizer.accessToken))
    .send({
      clubId,
      title: 'Chess night',
      location: 'Room B12',
      startsAt: inDays(1),
      endsAt: inDays(1, 3),
      capacity: 2,
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`createEvent failed with ${res.status}`);
  return res.body.data.id as string;
}

export const registerFor = (session: Session, eventId: string) =>
  api.post(`/api/v1/events/${eventId}/registrations`).set(bearer(session.accessToken));

export const cancel = (session: Session, ticketId: string) =>
  api.delete(`/api/v1/tickets/${ticketId}`).set(bearer(session.accessToken));

export async function attendees(prefix: string, count: number): Promise<Session[]> {
  const sessions: Session[] = [];
  for (let i = 0; i < count; i++) sessions.push(await registerUser(`${prefix}-${i}@example.com`));
  return sessions;
}

/** Invariant I1: counter equals confirmed tickets and never exceeds capacity. */
export async function seatState(eventId: string) {
  const event = await Event.findById(eventId).lean();
  if (!event) throw new Error('event not found');
  const confirmed = await Ticket.countDocuments({ event: eventId, status: 'confirmed' });
  const waitlisted = await Ticket.find({ event: eventId, status: 'waitlisted' })
    .sort({ waitlistSeq: 1 })
    .lean();
  return {
    capacity: event.capacity,
    confirmedCount: event.confirmedCount,
    confirmed,
    waitlistAttendees: waitlisted.map((t) => t.attendee.toString()),
    waitlistSeqs: waitlisted.map((t) => t.waitlistSeq),
  };
}
