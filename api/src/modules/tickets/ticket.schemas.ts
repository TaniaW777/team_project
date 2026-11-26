import { z } from 'zod';
import { objectIdSchema, paginationSchema } from '../../shared/validation.ts';
import { TICKET_STATUSES } from './ticket.model.ts';

export const ticketParamsSchema = z.object({ ticketId: objectIdSchema });

export const listTicketsSchema = paginationSchema.extend({
  status: z.enum(TICKET_STATUSES).optional(),
});

export type ListTicketsQuery = z.infer<typeof listTicketsSchema>;
