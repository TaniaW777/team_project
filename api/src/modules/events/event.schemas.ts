import { z } from 'zod';
import { objectIdSchema, paginationSchema } from '../../shared/validation.ts';
import { EVENT_STATUSES } from './event.model.ts';

const title = z.string().trim().min(3).max(120);
const description = z.string().trim().max(2000);
const location = z.string().trim().min(1).max(200);
const date = z.coerce.date();
// null = unlimited places.
const capacity = z.number().int().min(1).max(100_000).nullable();

export const eventParamsSchema = z.object({ eventId: objectIdSchema });

// Unknown keys (status, confirmedCount, waitlistCounter, createdBy...) are dropped.
export const createEventSchema = z
  .object({
    clubId: objectIdSchema,
    title,
    description: description.optional(),
    location,
    startsAt: date,
    endsAt: date,
    capacity: capacity.optional(),
  })
  .refine((value) => value.endsAt.getTime() > value.startsAt.getTime(), {
    path: ['endsAt'],
    message: 'The event must end after it starts',
  })
  .refine((value) => value.startsAt.getTime() > Date.now(), {
    path: ['startsAt'],
    message: 'The event must start in the future',
  });

// Date consistency with the stored values is checked in the service.
export const updateEventSchema = z
  .object({ title, description, location, startsAt: date, endsAt: date, capacity })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listEventsSchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(80).optional(),
  clubId: objectIdSchema.optional(),
  status: z.enum(EVENT_STATUSES).optional(),
  from: date.optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type ListEventsQuery = z.infer<typeof listEventsSchema>;
