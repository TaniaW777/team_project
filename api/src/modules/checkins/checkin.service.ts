import mongoose, { type ClientSession } from 'mongoose';
import type { Actor } from '../../shared/authorize.ts';
import { AppError } from '../../shared/errors.ts';
import { isObjectId, pageMeta } from '../../shared/validation.ts';
import {
  hasErrorLabel,
  runTransaction,
  TRANSACTION_POLICY,
} from '../clubs/club-transaction.ts';
import { assertClubRole } from '../clubs/membership.service.ts';
import { getEvent } from '../events/event.service.ts';
import type { EventStatus } from '../events/event.model.ts';
import { Ticket, type TicketStatus } from '../tickets/ticket.model.ts';
import {
  claimTicketForCheckIn,
  getTicketForCheckIn,
} from '../tickets/ticket.service.ts';
import {
  CheckIn,
  toCheckInDto,
  type CheckInDto,
  type CheckInSource,
} from './checkin.model.ts';
import type {
  CreateCheckInInput,
  ListCheckInsQuery,
  SyncCheckInItem,
  SyncCheckInsInput,
} from './checkin.schemas.ts';
import {
  exportQrPublicKeyPem,
  signTicketQr,
  verifyTicketQr,
  type VerifiedTicketQr,
} from './qr.service.ts';

// Check-in (ADR-037 §4-§7): the QR is only a carrier, the server alone judges
// tickets, roles and ordering. `tickets.checkedInAt` is written ONLY by M2's
// claimTicketForCheckIn, called inside the same transaction as our insert.

type TicketForCheckIn = NonNullable<Awaited<ReturnType<typeof getTicketForCheckIn>>>;
type CheckInEvent = {
  id: string;
  clubId: string;
  status: EventStatus;
  endsAt: Date;
};

export type NewCheckIn = {
  ticketId: string;
  eventId: string;
  clubId: string;
  staffId: string;
  idempotencyKey: string;
  source: CheckInSource;
  scannedAt: Date;
  checkedInAt: Date;
};

export type CheckInResult = {
  result: 'accepted' | 'duplicate';
  ticketId: string;
  checkedInAt: Date;
  checkInId: string;
};

export type SyncResult = {
  idempotencyKey: string;
  result: 'accepted' | 'duplicate' | 'already_checked_in' | 'rejected' | 'retry';
  reason?: string;
  checkedInAt?: Date;
};

/** Injectable seams: unit tests exercise idempotency without MongoDB. */
export type CheckInDeps = {
  now: () => Date;
  verifyQr: (token: string) => Promise<VerifiedTicketQr>;
  signQr: typeof signTicketQr;
  getTicket: typeof getTicketForCheckIn;
  // M2's contract view intentionally omits `attendee`; the QR endpoint needs
  // it for BOLA, so M4 performs this read-only lookup itself.
  findTicketAttendee: (ticketId: string) => Promise<string | null>;
  claim: typeof claimTicketForCheckIn;
  getEvent: (eventId: string) => Promise<CheckInEvent>;
  assertRole: typeof assertClubRole;
  findByKey: (key: string, session?: ClientSession) => Promise<CheckInDto | null>;
  findByTicket: (ticketId: string, session?: ClientSession) => Promise<CheckInDto | null>;
  insert: (input: NewCheckIn, session: ClientSession) => Promise<CheckInDto>;
  listEventTickets: (eventId: string) => Promise<Array<{ id: string; status: TicketStatus }>>;
  publicKeyPem: () => string;
  runInTransaction: <T>(work: (session: ClientSession) => Promise<T>) => Promise<T>;
};

const defaultDeps: CheckInDeps = {
  now: () => new Date(),
  verifyQr: verifyTicketQr,
  signQr: signTicketQr,
  getTicket: getTicketForCheckIn,
  findTicketAttendee: async (ticketId) => {
    if (!isObjectId(ticketId)) return null;
    const ticket = await Ticket.findById(ticketId).select('attendee').lean();
    return ticket ? ticket.attendee.toString() : null;
  },
  claim: claimTicketForCheckIn,
  assertRole: assertClubRole,
  getEvent: async (eventId) => {
    const event = await getEvent(eventId);
    return {
      id: event.id,
      clubId: event.clubId,
      status: event.status,
      endsAt: event.endsAt,
    };
  },
  findByKey: async (key, session) => {
    const found = await CheckIn.findOne(
      { idempotencyKey: key },
      null,
      session ? { session } : {},
    ).lean();
    return found ? toCheckInDto(found) : null;
  },
  findByTicket: async (ticketId, session) => {
    const found = await CheckIn.findOne(
      { ticket: ticketId },
      null,
      session ? { session } : {},
    ).lean();
    return found ? toCheckInDto(found) : null;
  },
  insert: async (input, session) => {
    const [created] = await CheckIn.create(
      [
        {
          ticket: input.ticketId,
          event: input.eventId,
          club: input.clubId,
          staff: input.staffId,
          idempotencyKey: input.idempotencyKey,
          source: input.source,
          scannedAt: input.scannedAt,
          checkedInAt: input.checkedInAt,
        },
      ],
      { session },
    );
    if (!created) throw new Error('Check-in insert returned nothing');
    return toCheckInDto(created.toObject());
  },
  listEventTickets: async (eventId) => {
    const tickets = await Ticket.find({ event: eventId }, { status: 1 }).lean();
    return tickets.map((ticket) => ({
      id: ticket._id.toString(),
      status: ticket.status as TicketStatus,
    }));
  },
  publicKeyPem: exportQrPublicKeyPem,
  runInTransaction: (work) =>
    runTransaction(
      {
        startSession: () => mongoose.startSession(),
        policy: TRANSACTION_POLICY,
      },
      (ctx) => work(ctx.session),
    ),
};

function invalidQr(): AppError {
  return new AppError(422, 'INVALID_QR', 'Invalid or expired QR code');
}

function wrongEvent(): AppError {
  return new AppError(422, 'WRONG_EVENT', 'This ticket is for another event');
}

function ticketNotConfirmed(): AppError {
  return new AppError(409, 'TICKET_NOT_CONFIRMED', 'This ticket is not confirmed');
}

function alreadyCheckedIn(checkedInAt?: Date | null): AppError {
  return new AppError(409, 'ALREADY_CHECKED_IN', 'This ticket was already checked in', {
    checkedInAt: checkedInAt ?? null,
  });
}

function keyReused(): AppError {
  return new AppError(
    422,
    'IDEMPOTENCY_KEY_REUSED',
    'This scan key was already used for another ticket',
  );
}

function eventClosed(): AppError {
  return new AppError(409, 'EVENT_CLOSED', 'Check-in is closed for this event');
}

function replay(prior: CheckInDto, ticketId: string): CheckInResult {
  if (prior.ticketId !== ticketId) throw keyReused();
  return {
    result: 'duplicate',
    ticketId: prior.ticketId,
    checkedInAt: prior.checkedInAt,
    checkInId: prior.id,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

const NETWORK_CODES = new Set([6, 7, 89, 91, 11600, 11602, 13435, 13436, 9001]);

function isNetworkError(error: unknown): boolean {
  if (
    hasErrorLabel(error, 'TransientTransactionError') ||
    hasErrorLabel(error, 'UnknownTransactionCommitResult') ||
    hasErrorLabel(error, 'RetryableWriteError')
  ) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number' &&
    NETWORK_CODES.has(error.code)
  );
}

const RETRYABLE_CODES = new Set(['CONCURRENT_UPDATE', 'TRANSACTION_OUTCOME_UNKNOWN']);
const TERMINAL_CODES = new Set([
  'INVALID_QR',
  'WRONG_EVENT',
  'TICKET_NOT_CONFIRMED',
  'IDEMPOTENCY_KEY_REUSED',
  'FORBIDDEN',
  'NOT_FOUND',
  'EVENT_CLOSED',
  'CONFLICT',
  'VALIDATION_ERROR',
  'BAD_REQUEST',
]);

/** §7 mapping: one explicit result per outbox item, never a batch 500. */
export function syncFailure(idempotencyKey: string, error: unknown): SyncResult {
  if (error instanceof AppError) {
    if (error.code === 'ALREADY_CHECKED_IN') {
      const details = error.details as { checkedInAt?: Date | null } | undefined;
      return {
        idempotencyKey,
        result: 'already_checked_in',
        ...(details?.checkedInAt ? { checkedInAt: details.checkedInAt } : {}),
      };
    }
    if (RETRYABLE_CODES.has(error.code)) {
      return { idempotencyKey, result: 'retry', reason: error.code };
    }
    if (TERMINAL_CODES.has(error.code)) {
      return { idempotencyKey, result: 'rejected', reason: error.code };
    }
  }
  if (isNetworkError(error)) {
    return { idempotencyKey, result: 'retry', reason: 'NETWORK_ERROR' };
  }
  // Unexpected bugs still fail the online endpoint with 500; inside a batch
  // they must not keep the device waiting forever for a doomed scan.
  return { idempotencyKey, result: 'retry', reason: 'INTERNAL_ERROR' };
}

// ---------------------------------------------------------------------------
// One scan: the same code serves the online endpoint and every sync item.
// ---------------------------------------------------------------------------

async function performCheckIn(
  actor: Actor,
  eventId: string,
  input: {
    qrToken: string;
    idempotencyKey: string;
    source: CheckInSource;
    scannedAt: Date;
  },
  deps: CheckInDeps,
): Promise<CheckInResult> {
  const qr = await deps.verifyQr(input.qrToken);
  if (qr.eventId !== eventId) throw wrongEvent();

  const ticket = await deps.getTicket(qr.ticketId);
  if (!ticket) throw AppError.notFound('Ticket not found');
  if (ticket.event !== eventId) throw wrongEvent();

  const event = await deps.getEvent(eventId);
  if (event.clubId !== ticket.club) throw AppError.forbidden();
  if (event.status !== 'published') throw eventClosed();

  // Authorization is checked at ARRIVAL time with current memberships (§7):
  // a staff member removed since the scan is rejected now, not at scan time.
  await deps.assertRole(actor, ticket.club, ['organizer', 'staff'], {
    allowArchived: true,
  });
  if (ticket.status !== 'confirmed') throw ticketNotConfirmed();

  const earlier = await deps.findByKey(input.idempotencyKey);
  if (earlier) return replay(earlier, ticket.id);
  const previous = await deps.findByTicket(ticket.id);
  if (previous) throw alreadyCheckedIn(previous.checkedInAt);

  try {
    return await deps.runInTransaction(async (session) => {
      // Re-read inside the transaction: another device may have replayed the
      // same key while this scan was waiting for the session.
      const prior = await deps.findByKey(input.idempotencyKey, session);
      if (prior) return replay(prior, ticket.id);

      const checkedInAt = deps.now();
      const claimed = await deps.claim(ticket.id, eventId, checkedInAt, session);
      if (!claimed) {
        const current = await deps.getTicket(ticket.id);
        if (!current) throw AppError.notFound('Ticket not found');
        if (current.checkedInAt) throw alreadyCheckedIn(current.checkedInAt);
        throw ticketNotConfirmed();
      }

      const created = await deps.insert(
        {
          ticketId: ticket.id,
          eventId,
          clubId: ticket.club,
          staffId: actor.id,
          idempotencyKey: input.idempotencyKey,
          source: input.source,
          scannedAt: input.scannedAt,
          checkedInAt,
        },
        session,
      );
      return {
        result: 'accepted' as const,
        ticketId: ticket.id,
        checkedInAt: created.checkedInAt,
        checkInId: created.id,
      };
    });
  } catch (error) {
    // The unique indexes are the backstop when two requests race. The
    // transaction rolled back, so decide from what is committed now.
    if (isDuplicateKeyError(error)) {
      const prior = await deps.findByKey(input.idempotencyKey);
      if (prior) return replay(prior, ticket.id);
      const existing = await deps.findByTicket(ticket.id);
      if (existing) throw alreadyCheckedIn(existing.checkedInAt);
      throw keyReused();
    }
    throw error;
  }
}

export function checkInOnline(
  actor: Actor,
  eventId: string,
  input: CreateCheckInInput,
  deps: CheckInDeps = defaultDeps,
): Promise<CheckInResult> {
  return performCheckIn(
    actor,
    eventId,
    {
      qrToken: input.qrToken,
      idempotencyKey: input.idempotencyKey,
      source: 'online',
      scannedAt: deps.now(),
    },
    deps,
  );
}

export async function syncCheckIns(
  actor: Actor,
  input: SyncCheckInsInput,
  deps: CheckInDeps = defaultDeps,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  // Arrival order only: `scannedAt` is stored, never used to sort or decide.
  for (const item of input.items) {
    results.push(await syncOne(actor, item, deps));
  }
  return results;
}

async function syncOne(
  actor: Actor,
  item: SyncCheckInItem,
  deps: CheckInDeps,
): Promise<SyncResult> {
  try {
    const answer = await performCheckIn(
      actor,
      item.eventId,
      {
        qrToken: item.qrToken,
        idempotencyKey: item.idempotencyKey,
        source: 'offline',
        scannedAt: new Date(item.scannedAt),
      },
      deps,
    );
    return {
      idempotencyKey: item.idempotencyKey,
      result: answer.result,
      checkedInAt: answer.checkedInAt,
    };
  } catch (error) {
    return syncFailure(item.idempotencyKey, error);
  }
}

export async function listCheckIns(
  actor: Actor,
  eventId: string,
  query: ListCheckInsQuery,
  deps: CheckInDeps = defaultDeps,
) {
  const event = await deps.getEvent(eventId);
  await deps.assertRole(actor, event.clubId, ['organizer', 'staff'], {
    allowArchived: true,
  });

  const { page, limit } = query;
  const filter = { event: eventId };
  const [items, total] = await Promise.all([
    CheckIn.find(filter)
      .sort({ checkedInAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CheckIn.countDocuments(filter),
  ]);
  return {
    items: items.map(toCheckInDto),
    meta: pageMeta(total, page, limit),
  };
}

/** The attendee only (BOLA): ticket id and status, no names or e-mails. */
export async function ticketQr(
  actor: Actor,
  ticketId: string,
  deps: CheckInDeps = defaultDeps,
) {
  const [ticket, attendee] = await Promise.all([
    deps.getTicket(ticketId),
    deps.findTicketAttendee(ticketId),
  ]);
  if (!ticket || attendee !== actor.id) {
    throw AppError.notFound('Ticket not found');
  }
  if (ticket.status !== 'confirmed') throw ticketNotConfirmed();
  const event = await deps.getEvent(ticket.event);
  if (event.status !== 'published') throw eventClosed();
  return { qrToken: await deps.signQr(ticketForSigning(ticket, event)) };
}

function ticketForSigning(ticket: TicketForCheckIn, event: CheckInEvent) {
  return { id: ticket.id, event: ticket.event, endsAt: event.endsAt };
}

/** Offline pre-check bundle: public key + ticket ids/statuses, staff only. */
export async function checkInBundle(
  actor: Actor,
  eventId: string,
  deps: CheckInDeps = defaultDeps,
) {
  const event = await deps.getEvent(eventId);
  await deps.assertRole(actor, event.clubId, ['organizer', 'staff'], {
    allowArchived: true,
  });
  return {
    publicKey: deps.publicKeyPem(),
    generatedAt: deps.now().toISOString(),
    tickets: await deps.listEventTickets(eventId),
  };
}
