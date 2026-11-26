import type { Request, Response } from 'express';
import { currentActor } from '../../shared/authorize.ts';
import {
  createEventSchema,
  eventParamsSchema,
  listEventsSchema,
  updateEventSchema,
} from './event.schemas.ts';
import * as eventService from './event.service.ts';

export async function list(req: Request, res: Response) {
  const query = listEventsSchema.parse(req.query);
  const result = await eventService.listEvents(query);
  res.json({ data: result.items, meta: result.meta });
}

export async function getOne(req: Request, res: Response) {
  const { eventId } = eventParamsSchema.parse(req.params);
  res.json({ data: await eventService.getEvent(eventId) });
}

export async function create(req: Request, res: Response) {
  const input = createEventSchema.parse(req.body);
  const event = await eventService.createEvent(currentActor(req), input);
  res.status(201).json({ data: event });
}

export async function update(req: Request, res: Response) {
  const { eventId } = eventParamsSchema.parse(req.params);
  const input = updateEventSchema.parse(req.body);
  res.json({ data: await eventService.updateEvent(currentActor(req), eventId, input) });
}

export async function cancel(req: Request, res: Response) {
  const { eventId } = eventParamsSchema.parse(req.params);
  await eventService.cancelEvent(currentActor(req), eventId);
  res.status(204).end();
}
