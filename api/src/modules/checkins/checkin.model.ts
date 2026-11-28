import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Types,
} from 'mongoose';

// Check-ins (ADR-037 TD5/§2). Member 4 owns this collection; tickets are only
// written through M2's claimTicketForCheckIn.

export const CHECKIN_SOURCES = ['online', 'offline'] as const;
export type CheckInSource = (typeof CHECKIN_SOURCES)[number];

const checkInSchema = new Schema(
  {
    ticket: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    club: { type: Schema.Types.ObjectId, ref: 'Club', required: true },
    // Staff id from the verified access token, never from the request body.
    staff: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    idempotencyKey: { type: String, required: true },
    source: { type: String, enum: CHECKIN_SOURCES, required: true },
    // Device time: audit only, never used to order check-ins (§7).
    scannedAt: { type: Date, required: true },
    // Server time: authoritative.
    checkedInAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// I3 second guard: one check-in per ticket. Same key replayed -> duplicate;
// a key reused for another ticket is refused before the claim.
checkInSchema.index({ ticket: 1 }, { unique: true });
checkInSchema.index({ idempotencyKey: 1 }, { unique: true });
checkInSchema.index({ event: 1, checkedInAt: 1 });

export type CheckInDocument = HydratedDocument<InferSchemaType<typeof checkInSchema>>;

export const CheckIn = model('CheckIn', checkInSchema);

export type CheckInDto = {
  id: string;
  ticketId: string;
  eventId: string;
  clubId: string;
  staffId: string;
  idempotencyKey: string;
  source: CheckInSource;
  scannedAt: Date;
  checkedInAt: Date;
};

type StoredCheckIn = {
  _id: Types.ObjectId;
  ticket: Types.ObjectId;
  event: Types.ObjectId;
  club: Types.ObjectId;
  staff: Types.ObjectId;
  idempotencyKey: string;
  source: CheckInSource;
  scannedAt: Date;
  checkedInAt: Date;
};

export function toCheckInDto(checkIn: StoredCheckIn): CheckInDto {
  return {
    id: checkIn._id.toString(),
    ticketId: checkIn.ticket.toString(),
    eventId: checkIn.event.toString(),
    clubId: checkIn.club.toString(),
    staffId: checkIn.staff.toString(),
    idempotencyKey: checkIn.idempotencyKey,
    source: checkIn.source,
    scannedAt: checkIn.scannedAt,
    checkedInAt: checkIn.checkedInAt,
  };
}
