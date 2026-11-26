import type { Request, Response } from 'express';
import { currentActor } from '../../shared/authorize.ts';
import {
  addMemberSchema,
  changeRoleSchema,
  clubParamsSchema,
  listMembersSchema,
  memberParamsSchema,
} from './club.schemas.ts';
import * as membershipService from './membership.service.ts';

// The HTTP response is sent only AFTER the transaction has committed
// (the service returns once commitTransaction succeeded).

export async function list(req: Request, res: Response) {
  const { clubId } = clubParamsSchema.parse(req.params);
  const query = listMembersSchema.parse(req.query);
  const result = await membershipService.listMembers(currentActor(req), clubId, query);
  res.json({ data: result.items, meta: result.meta });
}

export async function add(req: Request, res: Response) {
  const { clubId } = clubParamsSchema.parse(req.params);
  const input = addMemberSchema.parse(req.body);
  const result = await membershipService.addMember(currentActor(req), clubId, input);
  // 201 when created; 200 when the same membership already existed
  // (desired state already reached, e.g. a retry after an unknown outcome).
  res.status(result.created ? 201 : 200).json({ data: result.membership });
}

export async function changeRole(req: Request, res: Response) {
  const { clubId, userId } = memberParamsSchema.parse(req.params);
  const { role } = changeRoleSchema.parse(req.body);
  const membership = await membershipService.changeRole(
    currentActor(req),
    clubId,
    userId,
    role,
  );
  res.json({ data: membership });
}

export async function remove(req: Request, res: Response) {
  const { clubId, userId } = memberParamsSchema.parse(req.params);
  await membershipService.removeMember(currentActor(req), clubId, userId);
  res.status(204).end();
}
