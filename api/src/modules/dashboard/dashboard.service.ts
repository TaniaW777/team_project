import { Types } from 'mongoose';
import type { Actor } from '../../shared/authorize.ts';
import { AppError } from '../../shared/errors.ts';
import { assertClubRole } from '../clubs/membership.service.ts';
import { Event } from '../events/event.model.ts';
import { Ticket, type TicketStatus } from '../tickets/ticket.model.ts';

// Organizer dashboard of ONE event (T8: "organiser dashboard (registrations,
// attendance)"). Read-only: this module never writes events or tickets
// (tickets are written only by the tickets module, ADR-037 TD5).

type DashboardFacets = {
  byStatus: { _id: TicketStatus; count: number }[];
  checkedIn: { count: number }[];
  registrationsPerDay: { _id: string; count: number }[];
};

/**
 * Figures for the organizer of the event's club.
 *
 * Authorization (A7): organizer of THIS event's club only. Door staff and
 * attendees get 403, an unknown event 404. No admin bypass (decision D3).
 *
 * All the figures come from ONE aggregation on `tickets` (`$facet`), served
 * by the `{ event, status, waitlistSeq }` index for the `$match` stage.
 */
export async function getEventDashboard(actor: Actor, eventId: string) {
  const event = await Event.findById(eventId).lean();
  if (!event) throw AppError.notFound('Event not found');
  await assertClubRole(actor, event.club.toString(), ['organizer']);

  const [facets] = await Ticket.aggregate<DashboardFacets>([
    { $match: { event: new Types.ObjectId(eventId) } },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        // checkedInAt is set once by the check-in claim (Member 4); a
        // checked-in ticket can never be cancelled (I5).
        checkedIn: [{ $match: { checkedInAt: { $ne: null } } }, { $count: 'count' }],
        // One ticket per (event, attendee): createdAt = first registration.
        registrationsPerDay: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]);

  const count = (status: TicketStatus) =>
    facets?.byStatus.find((row) => row._id === status)?.count ?? 0;
  const confirmed = count('confirmed');
  const checkedIn = facets?.checkedIn[0]?.count ?? 0;
  const capacity = event.capacity ?? null;

  return {
    eventId: event._id.toString(),
    title: event.title,
    status: event.status,
    startsAt: event.startsAt,
    capacity,
    confirmed,
    waitlisted: count('waitlisted'),
    cancelled: count('cancelled'),
    checkedIn,
    seatsLeft: capacity === null ? null : Math.max(0, capacity - confirmed),
    // Share of confirmed attendees who came; null before anyone is confirmed.
    attendanceRate: confirmed === 0 ? null : checkedIn / confirmed,
    registrationsPerDay: (facets?.registrationsPerDay ?? []).map((row) => ({
      date: row._id,
      count: row.count,
    })),
  };
}
