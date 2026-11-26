import { z } from 'zod';
import {
  normalizedEmailSchema,
  objectIdSchema,
  paginationSchema,
} from '../../shared/validation.ts';
import { CLUB_STATUSES } from './club.model.ts';
import { CLUB_ROLES } from './membership.model.ts';

// Every body, query and path parameter of the clubs module (A4).
// Unknown keys (createdBy, _id, membershipVersion, club, user, addedBy,
// archivedAt...) are dropped by Zod: no mass assignment.

const name = z.string().trim().min(2).max(80);
const description = z.string().trim().max(1000);
const role = z.enum(CLUB_ROLES);

export const clubParamsSchema = z.object({ clubId: objectIdSchema });

export const memberParamsSchema = z.object({
  clubId: objectIdSchema,
  userId: objectIdSchema,
});

export const createClubSchema = z.object({
  name,
  description: description.optional(),
  contactEmail: normalizedEmailSchema.optional(),
});

// PATCH: every field optional, at least one required (lab pattern).
// `status` is accepted only from an admin (checked in the service).
export const updateClubSchema = z
  .object({
    name,
    description,
    contactEmail: normalizedEmailSchema.nullable(),
    status: z.enum(CLUB_STATUSES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listClubsSchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(80).optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  status: z.enum(CLUB_STATUSES).optional(),
});

export const addMemberSchema = z.object({ email: normalizedEmailSchema, role });

export const changeRoleSchema = z.object({ role });

export const listMembersSchema = paginationSchema.extend({
  role: role.optional(),
});

export type CreateClubInput = z.infer<typeof createClubSchema>;
export type UpdateClubInput = z.infer<typeof updateClubSchema>;
export type ListClubsQuery = z.infer<typeof listClubsSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type ListMembersQuery = z.infer<typeof listMembersSchema>;
