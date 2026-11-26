import type { Request, Response } from 'express';
import { currentActor } from '../../shared/authorize.ts';
import {
  clubParamsSchema,
  createClubSchema,
  listClubsSchema,
  updateClubSchema,
} from './club.schemas.ts';
import * as clubService from './club.service.ts';

// Lab pattern: validate the input, call the service, send the response.

export async function list(req: Request, res: Response) {
  const query = listClubsSchema.parse(req.query);
  const result = await clubService.listClubs(currentActor(req), query);
  res.json({ data: result.items, meta: result.meta });
}

export async function getOne(req: Request, res: Response) {
  const { clubId } = clubParamsSchema.parse(req.params);
  const club = await clubService.getClub(currentActor(req), clubId);
  res.json({ data: club });
}

export async function create(req: Request, res: Response) {
  const input = createClubSchema.parse(req.body);
  const club = await clubService.createClub(currentActor(req), input);
  res.status(201).json({ data: club });
}

export async function update(req: Request, res: Response) {
  const { clubId } = clubParamsSchema.parse(req.params);
  const input = updateClubSchema.parse(req.body);
  const club = await clubService.updateClub(currentActor(req), clubId, input);
  res.json({ data: club });
}

export async function archive(req: Request, res: Response) {
  const { clubId } = clubParamsSchema.parse(req.params);
  await clubService.archiveClub(currentActor(req), clubId);
  res.status(204).end();
}
