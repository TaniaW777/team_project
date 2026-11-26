import type { Request, Response } from 'express';
import { currentActor } from '../../shared/authorize.ts';
import { eventParamsSchema } from '../events/event.schemas.ts';
import { listTicketsSchema, ticketParamsSchema } from './ticket.schemas.ts';
import * as ticketService from './ticket.service.ts';

// POST /events/:eventId/registrations (mounted by the events router).
export async function register(req: Request, res: Response) {
  const { eventId } = eventParamsSchema.parse(req.params);
  const result = await ticketService.register(currentActor(req), eventId);
  // 201 new registration; 200 already registered (desired state).
  res.status(result.created ? 201 : 200).json({ data: result.ticket });
}

export async function listMine(req: Request, res: Response) {
  const query = listTicketsSchema.parse(req.query);
  const result = await ticketService.listMyTickets(currentActor(req), query);
  res.json({ data: result.items, meta: result.meta });
}

export async function getOne(req: Request, res: Response) {
  const { ticketId } = ticketParamsSchema.parse(req.params);
  const ticket = await ticketService.getTicket(currentActor(req), ticketId);
  res.json({ data: ticket });
}

export async function cancel(req: Request, res: Response) {
  const { ticketId } = ticketParamsSchema.parse(req.params);
  await ticketService.cancelTicket(currentActor(req), ticketId);
  res.status(204).end();
}
