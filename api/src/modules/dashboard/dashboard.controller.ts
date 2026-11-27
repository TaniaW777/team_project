import type { Request, Response } from 'express';
import { currentActor } from '../../shared/authorize.ts';
import { eventParamsSchema } from '../events/event.schemas.ts';
import * as dashboardService from './dashboard.service.ts';

// GET /events/:eventId/dashboard
export async function getOne(req: Request, res: Response) {
  const { eventId } = eventParamsSchema.parse(req.params); // invalid id -> 422 (A4)
  res.json({ data: await dashboardService.getEventDashboard(currentActor(req), eventId) });
}
