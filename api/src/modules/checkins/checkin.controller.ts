import type { Request, Response } from 'express';
import { currentActor } from '../../shared/authorize.ts';
import { eventParamsSchema } from '../events/event.schemas.ts';
import { ticketParamsSchema } from '../tickets/ticket.schemas.ts';
import {
  createCheckInSchema,
  listCheckInsSchema,
  syncCheckInsSchema,
} from './checkin.schemas.ts';
import * as checkInService from './checkin.service.ts';

// All routes below are behind `authenticate + loadActor`; the actor always
// comes from the verified token.

export async function create(req: Request, res: Response) {
  const { eventId } = eventParamsSchema.parse(req.params);
  const input = createCheckInSchema.parse(req.body);
  const result = await checkInService.checkInOnline(currentActor(req), eventId, input);
  // 201 accepted; 200 replay of the same idempotency key.
  res.status(result.result === 'duplicate' ? 200 : 201).json({ data: result });
}

export async function list(req: Request, res: Response) {
  const { eventId } = eventParamsSchema.parse(req.params);
  const query = listCheckInsSchema.parse(req.query);
  const result = await checkInService.listCheckIns(currentActor(req), eventId, query);
  res.json({ data: result.items, meta: result.meta });
}

export async function sync(req: Request, res: Response) {
  const input = syncCheckInsSchema.parse(req.body);
  const results = await checkInService.syncCheckIns(currentActor(req), input);
  res.json({ data: results });
}

export async function bundle(req: Request, res: Response) {
  const { eventId } = eventParamsSchema.parse(req.params);
  const data = await checkInService.checkInBundle(currentActor(req), eventId);
  res.json({ data });
}

export async function ticketQr(req: Request, res: Response) {
  const { ticketId } = ticketParamsSchema.parse(req.params);
  const data = await checkInService.ticketQr(currentActor(req), ticketId);
  res.json({ data });
}
