import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';

// One ticket per (event, attendee), ever (ADR-037 TD2): re-registering after
// a cancellation reuses the same document. Written ONLY by ticket.service.ts
// (including the check-in claim exposed to Member 4).

export const TICKET_STATUSES = ['waitlisted', 'confirmed', 'cancelled'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

const ticketSchema = new Schema(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    // Copied from the event at creation, never changed: lets check-in call
    // assertClubRole(actor, ticket.club, ...) without loading the event.
    club: { type: Schema.Types.ObjectId, ref: 'Club', required: true },
    attendee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: TICKET_STATUSES, required: true },
    // Strictly increasing per event while waitlisted; promotion order (I4).
    waitlistSeq: { type: Number, default: null },
    confirmedAt: { type: Date, default: null },
    promotedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    // Set once by the check-in claim; never cleared (I3, I5).
    checkedInAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// I2: one ticket per (event, attendee).
ticketSchema.index({ event: 1, attendee: 1 }, { unique: true });
// Promotion (first waitlisted by seq), counts per status.
ticketSchema.index({ event: 1, status: 1, waitlistSeq: 1 });
// "My tickets", newest first.
ticketSchema.index({ attendee: 1, createdAt: -1 });

export type TicketDocument = HydratedDocument<InferSchemaType<typeof ticketSchema>>;

export const Ticket = model('Ticket', ticketSchema);
