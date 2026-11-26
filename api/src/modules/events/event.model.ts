import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';

// An event belongs to one club (ADR-037). Seats are tracked on the event
// itself: `confirmedCount` (I1: never above `capacity`) and `waitlistCounter`
// (source of the strictly increasing `waitlistSeq` of tickets, I4).

export const EVENT_STATUSES = ['published', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

const eventSchema = new Schema(
  {
    club: { type: Schema.Types.ObjectId, ref: 'Club', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    location: { type: String, required: true, trim: true, maxlength: 200 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    // null = unlimited places.
    capacity: { type: Number, min: 1, default: null },
    status: { type: String, enum: EVENT_STATUSES, default: 'published', required: true },
    cancelledAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Seat bookkeeping: written only inside event transactions (tickets module).
    confirmedCount: { type: Number, min: 0, default: 0 },
    waitlistCounter: { type: Number, min: 0, default: 0 },
    // Shared-write field (ADR-027 pattern, ADR-038): every seat-changing
    // transaction increments it FIRST, so concurrent ones on the same event
    // run one after the other. Internal, never in a DTO.
    seatVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true },
);

// Main list: published events by date (A10); events of one club by date.
eventSchema.index({ status: 1, startsAt: 1 });
eventSchema.index({ club: 1, startsAt: 1 });

export type EventDocument = HydratedDocument<InferSchemaType<typeof eventSchema>>;

export const Event = model('Event', eventSchema);

type EventLike = Pick<
  EventDocument,
  | '_id'
  | 'club'
  | 'title'
  | 'description'
  | 'location'
  | 'startsAt'
  | 'endsAt'
  | 'capacity'
  | 'confirmedCount'
  | 'status'
  | 'createdAt'
>;

export function toEventDto(event: EventLike) {
  const capacity = event.capacity ?? null;
  return {
    id: event._id.toString(),
    clubId: event.club.toString(),
    title: event.title,
    description: event.description ?? '',
    location: event.location,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    capacity,
    confirmedCount: event.confirmedCount,
    seatsLeft: capacity === null ? null : Math.max(0, capacity - event.confirmedCount),
    status: event.status,
    createdAt: event.createdAt,
  };
}

/** Registration is open while the event is published and not over. */
export function isRegistrationOpen(event: Pick<EventLike, 'status' | 'endsAt'>, now = new Date()) {
  return event.status === 'published' && event.endsAt.getTime() > now.getTime();
}
