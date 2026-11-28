import { z } from 'zod';
import { objectIdSchema, paginationSchema } from '../../shared/validation.ts';

// Zod schemas are strict about types and bounds. As everywhere else (A4),
// unknown keys are dropped: a client cannot inject an actor or a ticket id.
const uuidV4 = z.uuid({ version: 'v4' });

export const createCheckInSchema = z.object({
  qrToken: z.string().min(1).max(4096),
  idempotencyKey: uuidV4,
});

export const syncItemSchema = z.object({
  idempotencyKey: uuidV4,
  qrToken: z.string().min(1).max(4096),
  eventId: objectIdSchema,
  // Device time, stored for audit; never used to decide the winner (§7).
  scannedAt: z.iso.datetime({ offset: true }),
});

export const syncCheckInsSchema = z.object({
  items: z.array(syncItemSchema).min(1).max(100),
});

export const listCheckInsSchema = paginationSchema;

export type CreateCheckInInput = z.infer<typeof createCheckInSchema>;
export type SyncCheckInItem = z.infer<typeof syncItemSchema>;
export type SyncCheckInsInput = z.infer<typeof syncCheckInsSchema>;
export type ListCheckInsQuery = z.infer<typeof listCheckInsSchema>;
