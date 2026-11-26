import type { Actor } from '../../shared/authorize.ts';
import { AppError } from '../../shared/errors.ts';
import { pageMeta } from '../../shared/validation.ts';
import { assertClubRole } from '../clubs/membership.service.ts';
import { fillFreeSeats } from '../tickets/ticket.service.ts';
import { Event, toEventDto } from './event.model.ts';
import type {
  CreateEventInput,
  ListEventsQuery,
  UpdateEventInput,
} from './event.schemas.ts';
import { runEventTransaction } from './event-transaction.ts';

// Club permissions come from the shared contract (authorization.md §6):
// creating, editing and cancelling an event requires the ORGANIZER role in
// the event's club. No admin bypass (decision D3).

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function createEvent(actor: Actor, input: CreateEventInput) {
  // 404 missing club, 409 archived club, 403 not an organizer of THIS club.
  await assertClubRole(actor, input.clubId, ['organizer']);
  const event = await Event.create({
    club: input.clubId,
    title: input.title,
    description: input.description ?? '',
    location: input.location,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    capacity: input.capacity ?? null,
    createdBy: actor.id,
  });
  return toEventDto(event);
}

/** Public list (any signed-in user): published events by default, by date. */
export async function listEvents(query: ListEventsQuery) {
  const { page, limit, q, clubId, status, from } = query;
  const filter: Record<string, unknown> = { status: status ?? 'published' };
  if (clubId) filter.club = clubId;
  if (q) filter.title = { $regex: escapeRegex(q), $options: 'i' };
  if (from) filter.startsAt = { $gte: from };

  const [items, total] = await Promise.all([
    Event.find(filter)
      .sort({ startsAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Event.countDocuments(filter),
  ]);
  return { items: items.map(toEventDto), meta: pageMeta(total, page, limit) };
}

export async function getEvent(eventId: string) {
  const event = await Event.findById(eventId).lean();
  if (!event) throw AppError.notFound('Event not found');
  return toEventDto(event);
}

/**
 * Update an event (organizer of its club). A capacity below the confirmed
 * registrations is refused (no one loses a confirmed seat); a higher or
 * unlimited capacity promotes waitlisted tickets in order, in the same seat
 * transaction.
 */
export async function updateEvent(actor: Actor, eventId: string, input: UpdateEventInput) {
  const existing = await Event.findById(eventId).select('club').lean();
  if (!existing) throw AppError.notFound('Event not found');
  await assertClubRole(actor, existing.club.toString(), ['organizer']);

  return runEventTransaction(eventId, async (tx) => {
    const event = tx.event;
    if (event.status === 'cancelled') throw AppError.conflict('Event is cancelled');

    const startsAt = input.startsAt ?? event.startsAt;
    const endsAt = input.endsAt ?? event.endsAt;
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw AppError.conflict('The event must end after it starts');
    }
    const capacity = input.capacity === undefined ? event.capacity : input.capacity;
    if (capacity != null && capacity < event.confirmedCount) {
      throw AppError.conflict(
        `Capacity cannot be lower than the ${event.confirmedCount} confirmed registrations`,
      );
    }

    const set: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'location', 'startsAt', 'endsAt'] as const) {
      if (input[key] !== undefined) set[key] = input[key];
    }
    if (input.capacity !== undefined) set.capacity = input.capacity;

    const updated = await Event.findOneAndUpdate(
      { _id: event._id },
      { $set: set },
      { ...tx.options(), returnDocument: 'after', runValidators: true },
    );
    if (!updated) throw AppError.notFound('Event not found');

    const promoted = await fillFreeSeats(tx, updated);
    return toEventDto({ ...updated.toObject(), confirmedCount: updated.confirmedCount + promoted });
  });
}

/** Cancel an event (soft, organizer of its club, idempotent). Registration closes. */
export async function cancelEvent(actor: Actor, eventId: string): Promise<void> {
  const existing = await Event.findById(eventId).select('club').lean();
  if (!existing) throw AppError.notFound('Event not found');
  await assertClubRole(actor, existing.club.toString(), ['organizer']);

  await runEventTransaction(eventId, async (tx) => {
    if (tx.event.status === 'cancelled') return;
    await Event.findOneAndUpdate(
      { _id: tx.event._id },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
      tx.options(),
    );
  });
}
