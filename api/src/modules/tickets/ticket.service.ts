import type { ClientSession, Types } from 'mongoose';
import type { Actor } from '../../shared/authorize.ts';
import { AppError } from '../../shared/errors.ts';
import { isObjectId, pageMeta } from '../../shared/validation.ts';
import { roleInClub } from '../clubs/membership.service.ts';
import { Event, isRegistrationOpen, type EventDocument } from '../events/event.model.ts';
import { runEventTransaction, type EventTransaction } from '../events/event-transaction.ts';
import { Ticket, type TicketStatus } from './ticket.model.ts';
import type { ListTicketsQuery } from './ticket.schemas.ts';

// Ticket lifecycle (ADR-037, ADR-038). Invariants:
//  I1 event.confirmedCount = confirmed tickets <= capacity
//  I2 one ticket per (event, attendee)
//  I3 a ticket is checked in at most once
//  I4 promotion strictly by ascending waitlistSeq
//  I5 checked-in tickets cannot be cancelled; cancelled/waitlisted tickets
//     cannot be checked in
// Every seat change runs in runEventTransaction (shared write on the event).

type TicketLike = {
  _id: Types.ObjectId;
  event: Types.ObjectId;
  club: Types.ObjectId;
  status: TicketStatus;
  waitlistSeq?: number | null;
  createdAt?: Date;
  confirmedAt?: Date | null;
  cancelledAt?: Date | null;
  checkedInAt?: Date | null;
};

function eventClosed() {
  return new AppError(409, 'EVENT_CLOSED', 'Registration is closed for this event');
}

function ticketAlreadyUsed() {
  return new AppError(409, 'TICKET_ALREADY_USED', 'This ticket has already been used');
}

async function waitlistPosition(ticket: TicketLike, session?: ClientSession) {
  if (ticket.status !== 'waitlisted' || ticket.waitlistSeq == null) return null;
  const ahead = await Ticket.countDocuments(
    { event: ticket.event, status: 'waitlisted', waitlistSeq: { $lt: ticket.waitlistSeq } },
    session ? { session } : {},
  );
  return ahead + 1;
}

async function toTicketDto(ticket: TicketLike, session?: ClientSession) {
  return {
    id: ticket._id.toString(),
    eventId: ticket.event.toString(),
    clubId: ticket.club.toString(),
    status: ticket.status,
    waitlistPosition: await waitlistPosition(ticket, session),
    createdAt: ticket.createdAt,
    confirmedAt: ticket.confirmedAt ?? null,
    cancelledAt: ticket.cancelledAt ?? null,
    checkedInAt: ticket.checkedInAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Promotion (I4): fill free seats from the waiting list, inside a seat
// transaction. Used by cancellation and by capacity increases.
// ---------------------------------------------------------------------------
export async function fillFreeSeats(
  tx: EventTransaction,
  event: Pick<EventDocument, '_id' | 'capacity' | 'confirmedCount' | 'status' | 'endsAt'>,
): Promise<number> {
  if (!isRegistrationOpen(event)) return 0;
  let confirmed = event.confirmedCount;
  let promoted = 0;
  const now = new Date();
  while (event.capacity == null || confirmed < event.capacity) {
    const next = await Ticket.findOneAndUpdate(
      { event: event._id, status: 'waitlisted' },
      { $set: { status: 'confirmed', confirmedAt: now, promotedAt: now, waitlistSeq: null } },
      { ...tx.options(), sort: { waitlistSeq: 1 }, returnDocument: 'after' },
    );
    if (!next) break;
    confirmed++;
    promoted++;
  }
  if (promoted > 0) {
    await Event.findOneAndUpdate(
      { _id: event._id },
      { $inc: { confirmedCount: promoted } },
      tx.options(),
    );
  }
  return promoted;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the actor. `confirmed` if a seat is free and nobody is waiting,
 * else `waitlisted` with the next waitlistSeq. Already waitlisted/confirmed
 * -> the existing ticket (created: false, desired state). A cancelled ticket
 * is reused (re-registration).
 */
export async function register(actor: Actor, eventId: string) {
  try {
    return await runEventTransaction(eventId, async (tx) => {
      const event = tx.event;
      if (!isRegistrationOpen(event)) throw eventClosed();

      const existing = await Ticket.findOne(
        { event: event._id, attendee: actor.id },
        null,
        tx.options(),
      ).lean();
      if (existing && existing.status !== 'cancelled') {
        return { created: false, ticket: await toTicketDto(existing, tx.session) };
      }

      const waiting = await Ticket.countDocuments(
        { event: event._id, status: 'waitlisted' },
        tx.options(),
      );
      const seatFree = event.capacity == null || event.confirmedCount < event.capacity;
      const now = new Date();

      let set: Record<string, unknown>;
      if (seatFree && waiting === 0) {
        await Event.findOneAndUpdate(
          { _id: event._id },
          { $inc: { confirmedCount: 1 } },
          tx.options(),
        );
        set = { status: 'confirmed', confirmedAt: now, waitlistSeq: null };
      } else {
        const counter = await Event.findOneAndUpdate(
          { _id: event._id },
          { $inc: { waitlistCounter: 1 } },
          { ...tx.options(), returnDocument: 'after', projection: { waitlistCounter: 1 } },
        ).lean();
        if (!counter) throw AppError.notFound('Event not found');
        set = { status: 'waitlisted', waitlistSeq: counter.waitlistCounter, confirmedAt: null };
      }
      Object.assign(set, { promotedAt: null, cancelledAt: null });

      let ticket: TicketLike | null;
      if (existing) {
        ticket = await Ticket.findOneAndUpdate(
          { _id: existing._id, status: 'cancelled' },
          { $set: set },
          { ...tx.options(), returnDocument: 'after' },
        ).lean();
      } else {
        const [created] = await Ticket.create(
          [{ event: event._id, club: event.club, attendee: actor.id, ...set }],
          { session: tx.session },
        );
        ticket = created ? created.toObject() : null;
      }
      if (!ticket) throw new Error('Ticket write returned nothing');
      return { created: true, ticket: await toTicketDto(ticket, tx.session) };
    });
  } catch (error) {
    // Backstop for I2 (the shared write already serialises both requests).
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict('You are already registered for this event');
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Access (BOLA): the attendee, or organizer/staff of the ticket's club.
// Anyone else gets 404, as if the ticket did not exist.
// ---------------------------------------------------------------------------
type Access = 'owner' | 'organizer' | 'staff';

async function accessTo(actor: Actor, ticket: TicketLike & { attendee: Types.ObjectId }) {
  if (ticket.attendee.toString() === actor.id) return 'owner' as Access;
  const role = await roleInClub(actor, ticket.club);
  return (role ?? null) as Access | null;
}

async function loadVisibleTicket(actor: Actor, ticketId: string) {
  const ticket = await Ticket.findById(ticketId).lean();
  if (!ticket) throw AppError.notFound('Ticket not found');
  const access = await accessTo(actor, ticket);
  if (!access) throw AppError.notFound('Ticket not found');
  return { ticket, access };
}

export async function getTicket(actor: Actor, ticketId: string) {
  const { ticket } = await loadVisibleTicket(actor, ticketId);
  return toTicketDto(ticket);
}

export async function listMyTickets(actor: Actor, query: ListTicketsQuery) {
  const { page, limit, status } = query;
  const filter = { attendee: actor.id, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    Ticket.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Ticket.countDocuments(filter),
  ]);
  return {
    items: await Promise.all(items.map((ticket) => toTicketDto(ticket))),
    meta: pageMeta(total, page, limit),
  };
}

// ---------------------------------------------------------------------------
// Cancellation: the attendee or an organizer of the club (staff: 403).
// Idempotent; a checked-in ticket cannot be cancelled (I5); a freed seat is
// given to the first waitlisted ticket in the SAME transaction (I1, I4).
// ---------------------------------------------------------------------------
export async function cancelTicket(actor: Actor, ticketId: string): Promise<void> {
  const { ticket, access } = await loadVisibleTicket(actor, ticketId);
  if (access === 'staff') throw AppError.forbidden('Staff cannot cancel tickets');

  await runEventTransaction(ticket.event.toString(), async (tx) => {
    const current = await Ticket.findById(ticket._id, null, tx.options()).lean();
    if (!current) throw AppError.notFound('Ticket not found');
    if (current.status === 'cancelled') return; // desired state already reached
    if (current.checkedInAt) throw ticketAlreadyUsed();

    // Mirror of the check-in claim: both are conditional updates of the same
    // document, so exactly one of them can succeed.
    const cancelled = await Ticket.findOneAndUpdate(
      { _id: current._id, status: current.status, checkedInAt: null },
      { $set: { status: 'cancelled', cancelledAt: new Date(), waitlistSeq: null } },
      tx.options(),
    );
    if (!cancelled) throw ticketAlreadyUsed();

    if (current.status === 'confirmed') {
      const event = await Event.findOneAndUpdate(
        { _id: current.event },
        { $inc: { confirmedCount: -1 } },
        { ...tx.options(), returnDocument: 'after' },
      );
      if (event) await fillFreeSeats(tx, event);
    }
  });
}

// ===========================================================================
// PROVISIONAL CONTRACT FOR MEMBER 4 (docs/tickets-contract.md §5)
// ===========================================================================

export type TicketClaim = {
  id: string;
  event: string;
  club: string;
  attendee: string;
  status: 'confirmed';
  checkedInAt: Date;
};

/**
 * Inside Member 4's check-in transaction: marks a CONFIRMED, not yet
 * checked-in ticket of `eventId` as checked in. Returns null when the ticket
 * is missing, belongs to another event, is waitlisted/cancelled, or was
 * already checked in (I3, I5). The only code path that writes checkedInAt.
 */
export async function claimTicketForCheckIn(
  ticketId: string,
  eventId: string,
  at: Date,
  session: ClientSession,
): Promise<TicketClaim | null> {
  if (!isObjectId(ticketId) || !isObjectId(eventId)) return null;
  const claimed = await Ticket.findOneAndUpdate(
    { _id: ticketId, event: eventId, status: 'confirmed', checkedInAt: null },
    { $set: { checkedInAt: at } },
    { session, returnDocument: 'after' },
  ).lean();
  if (!claimed || !claimed.checkedInAt) return null;
  return {
    id: claimed._id.toString(),
    event: claimed.event.toString(),
    club: claimed.club.toString(),
    attendee: claimed.attendee.toString(),
    status: 'confirmed',
    checkedInAt: claimed.checkedInAt,
  };
}

/** Read-only view for Member 4 (QR verification, authorization). */
export async function getTicketForCheckIn(ticketId: string) {
  if (!isObjectId(ticketId)) return null;
  const ticket = await Ticket.findById(ticketId).lean();
  if (!ticket) return null;
  return {
    id: ticket._id.toString(),
    event: ticket.event.toString(),
    club: ticket.club.toString(),
    status: ticket.status as TicketStatus,
    checkedInAt: ticket.checkedInAt ?? null,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
  );
}
