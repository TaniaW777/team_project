import type { Actor } from '../../shared/authorize.ts';
import { AppError } from '../../shared/errors.ts';
import { pageMeta } from '../../shared/validation.ts';
import {
  CLUB_NAME_COLLATION,
  Club,
  toClubDto,
} from './club.model.ts';
import type {
  CreateClubInput,
  ListClubsQuery,
  UpdateClubInput,
} from './club.schemas.ts';
import { runClubMembershipTransaction } from './club-transaction.ts';
import type { ClubRole } from './membership.model.ts';
import {
  clubRoleInTransaction,
  membershipsOf,
  roleInClub,
  rolesForClubs,
} from './membership.service.ts';

// RULE: the caller always comes from currentActor(req) (verified token +
// role from the database). Club rights are checked here, in the service.

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * List clubs. Non-admins see active clubs only and may not use `status`.
 * Queries per page: clubs + count (in parallel) + ONE batched membership
 * lookup for `myRole` (with mine=true the memberships are read first and
 * reused, so no extra lookup).
 */
export async function listClubs(actor: Actor, query: ListClubsQuery) {
  const isAdmin = actor.role === 'admin';
  if (query.status && !isAdmin) {
    throw AppError.forbidden('Only an admin can filter clubs by status');
  }
  const { page, limit, q, mine } = query;

  const filter: Record<string, unknown> = {};
  if (isAdmin) {
    if (query.status) filter.status = query.status;
  } else {
    filter.status = 'active';
  }
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };

  let knownRoles: Map<string, ClubRole> | null = null;
  if (mine) {
    const own = await membershipsOf(actor);
    knownRoles = new Map(own.map((m) => [m.club.toString(), m.role as ClubRole]));
    filter._id = { $in: own.map((m) => m.club) };
  }

  const [clubs, total] = await Promise.all([
    Club.find(filter)
      .collation(CLUB_NAME_COLLATION)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Club.countDocuments(filter),
  ]);

  const roles =
    knownRoles ?? (await rolesForClubs(actor, clubs.map((club) => club._id)));

  return {
    items: clubs.map((club) => toClubDto(club, roles.get(club._id.toString()) ?? null)),
    meta: pageMeta(total, page, limit),
  };
}

export async function getClub(actor: Actor, clubId: string) {
  const [club, role] = await Promise.all([
    Club.findById(clubId).lean(),
    roleInClub(actor, clubId),
  ]);
  if (!club) throw AppError.notFound('Club not found');
  // Archived clubs: visible to their members and to admins only.
  if (club.status === 'archived' && !role && actor.role !== 'admin') {
    throw AppError.notFound('Club not found');
  }
  return toClubDto(club, role);
}

/** Admin only (route guard + this check: defence in depth). */
export async function createClub(actor: Actor, input: CreateClubInput) {
  if (actor.role !== 'admin') throw AppError.forbidden();
  try {
    const club = await Club.create({
      name: input.name,
      description: input.description ?? '',
      contactEmail: input.contactEmail ?? null,
      createdBy: actor.id,
    });
    return toClubDto(club, null);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict('A club with this name already exists');
    }
    throw error;
  }
}

/**
 * Update a club: organizers of THIS club or admins. `status` (archive or
 * restore) is admin-only. An archived club is read-only except for an
 * admin restoring it.
 *
 * Phase 3 hardening (ADR-034): the permission check and the edit run in the
 * same club transaction as membership changes (shared write first). An
 * organizer demoted or removed concurrently is therefore re-checked on the
 * committed membership: the edit is either serialised before the demotion
 * (allowed - the actor was an organizer at that point) or after it (403).
 */
export async function updateClub(
  actor: Actor,
  clubId: string,
  input: UpdateClubInput,
) {
  const isAdmin = actor.role === 'admin';
  try {
    return await runClubMembershipTransaction(clubId, async (tx) => {
      const club = tx.club; // read by the shared write: current status
      const role = await clubRoleInTransaction(tx, actor);
      if (club.status === 'archived' && !role && !isAdmin) {
        throw AppError.notFound('Club not found');
      }
      if (input.status !== undefined && !isAdmin) {
        throw AppError.forbidden('Only an admin can archive or restore a club');
      }
      if (role !== 'organizer' && !isAdmin) throw AppError.forbidden();
      if (club.status === 'archived' && input.status !== 'active') {
        throw AppError.conflict('Club is archived');
      }

      const set: Record<string, unknown> = {};
      if (input.name !== undefined) set.name = input.name;
      if (input.description !== undefined) set.description = input.description;
      if (input.contactEmail !== undefined) set.contactEmail = input.contactEmail;
      if (input.status !== undefined && input.status !== club.status) {
        set.status = input.status;
        set.archivedAt = input.status === 'archived' ? new Date() : null;
      }

      const updated = await Club.findOneAndUpdate(
        { _id: club._id },
        { $set: set },
        { ...tx.options(), returnDocument: 'after', runValidators: true },
      ).lean();
      if (!updated) throw AppError.notFound('Club not found');
      return toClubDto(updated, role);
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict('A club with this name already exists');
    }
    throw error;
  }
}

/** DELETE = soft archive, admin only, idempotent (204 if already archived). */
export async function archiveClub(actor: Actor, clubId: string): Promise<void> {
  if (actor.role !== 'admin') throw AppError.forbidden();
  const archived = await Club.findOneAndUpdate(
    { _id: clubId, status: 'active' },
    { $set: { status: 'archived', archivedAt: new Date() } },
  );
  if (archived) return;
  if (!(await Club.exists({ _id: clubId }))) throw AppError.notFound('Club not found');
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
  );
}
