import mongoose from 'mongoose';
import { AppError } from '../../shared/errors.ts';
import {
  TRANSACTION_POLICY,
  runTransaction,
  type TransactionContext,
  type TransactionPolicy,
} from '../clubs/club-transaction.ts';
import { Event, type EventDocument } from './event.model.ts';

// Seat transactions (ADR-038): registration, cancellation, promotion and
// capacity changes. Same mechanism as membership changes (ADR-027/028): the
// FIRST operation increments `seatVersion` on the event, so two transactions
// on the same event conflict and run one after the other; every retry reads
// the committed result of the other. The generic bounded runner is reused.

/** Registration bursts hit one event: more attempts, same 5 s budget. */
export const SEAT_POLICY: TransactionPolicy = { ...TRANSACTION_POLICY, maxAttempts: 10 };

export type EventTransaction = TransactionContext<mongoose.ClientSession> & {
  /** The event, read by the shared write itself (current counters). */
  event: EventDocument;
};

export async function runEventTransaction<T>(
  eventId: string,
  work: (tx: EventTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await runTransaction(
      { startSession: () => mongoose.startSession(), policy: SEAT_POLICY },
      async (ctx) => {
        const event = await Event.findOneAndUpdate(
          { _id: eventId },
          { $inc: { seatVersion: 1 } },
          { ...ctx.options(), returnDocument: 'after' },
        );
        if (!event) throw AppError.notFound('Event not found');
        return work({ ...ctx, event });
      },
    );
  } catch (error) {
    // Same codes as membership transactions, event-specific messages.
    if (error instanceof AppError && error.code === 'CONCURRENT_UPDATE') {
      throw new AppError(
        409,
        'CONCURRENT_UPDATE',
        'Too many simultaneous changes for this event. Try again.',
      );
    }
    if (error instanceof AppError && error.code === 'TRANSACTION_OUTCOME_UNKNOWN') {
      throw new AppError(
        503,
        'TRANSACTION_OUTCOME_UNKNOWN',
        'The change may or may not have been applied. Reload the ticket before trying again.',
      );
    }
    throw error;
  }
}
