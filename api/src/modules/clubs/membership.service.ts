import type { Types } from 'mongoose';
import type { Actor } from '../../shared/authorize.ts';
import { AppError } from '../../shared/errors.ts';
import { isObjectId, pageMeta } from '../../shared/validation.ts';
import { User } from '../users/user.model.ts';
import { Club, type ClubStatus } from './club.model.ts';
import {
  runClubMembershipTransaction,
  type ClubTransaction,
} from './club-transaction.ts';
import {
  ClubMembership,
  toMembershipDto,
  type ClubRole,
} from './membership.model.ts';
import type { AddMemberInput, ListMembersQuery } from './club.schemas.ts';

const LAST_ORGANIZER = 'A club must keep at least one organizer';

// ===========================================================================
// PUBLIC INTEGRATION CONTRACT (docs/authorization.md) - Members 2 and 4
// ===========================================================================

export type ClubAccess = {
  club: { id: string; name: string; status: ClubStatus };
  role: ClubRole | null;
  viaAdmin: boolean;
};

/**
 * Checks that `actor` may act on `clubId` with one of `allowed` roles.
 * Read-only (2 indexed queries), takes no lock, changes nothing.
 * Order of checks (first failure wins):
 *   1. club missing                                   -> 404
 *   2. club archived and actor neither member nor admin -> 404 (hidden)
 *   3. actor's club role in `allowed`                  -> allowed
 *      else allowAdmin && actor is admin                -> allowed (viaAdmin)
 *      else                                             -> 403
 *   4. club archived and !allowArchived                -> 409
 */
export async function assertClubRole(
  actor: Actor,
  clubId: string,
  allowed: readonly ClubRole[],
  options: { allowAdmin?: boolean; allowArchived?: boolean } = {},
): Promise<ClubAccess> {
  if (allowed.length === 0) {
    throw new Error('assertClubRole: `allowed` must list at least one role');
  }
  const { allowAdmin = false, allowArchived = false } = options;
  if (!isObjectId(clubId)) throw AppError.notFound('Club not found');

  const [club, membership] = await Promise.all([
    Club.findById(clubId).select('name status').lean(),
    ClubMembership.findOne({ club: clubId, user: actor.id }).select('role').lean(),
  ]);
  if (!club) throw AppError.notFound('Club not found');

  const role = (membership?.role ?? null) as ClubRole | null;
  const isAdmin = actor.role === 'admin';
  const archived = club.status === 'archived';

  if (archived && !role && !isAdmin) throw AppError.notFound('Club not found');

  let viaAdmin = false;
  if (!(role && allowed.includes(role))) {
    if (allowAdmin && isAdmin) viaAdmin = true;
    else {
      throw AppError.forbidden('You do not have the required role in this club');
    }
  }

  if (archived && !allowArchived) throw AppError.conflict('Club is archived');

  return {
    club: { id: club._id.toString(), name: club.name, status: club.status },
    role,
    viaAdmin,
  };
}

// ===========================================================================
// Membership reads (outside transactions: committed data only)
// ===========================================================================

export async function listMembers(
  actor: Actor,
  clubId: string,
  query: ListMembersQuery,
) {
  // Members (with e-mails) are visible to the club's organizers and admins.
  await assertClubRole(actor, clubId, ['organizer'], {
    allowAdmin: true,
    allowArchived: true,
  });

  const { page, limit, role } = query;
  const filter = { club: clubId, ...(role ? { role } : {}) };
  const [items, total] = await Promise.all([
    ClubMembership.find(filter)
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate<{ user: { _id: Types.ObjectId; name: string; email: string } }>(
        'user',
        'name email',
      )
      .lean(),
    ClubMembership.countDocuments(filter),
  ]);
  return { items: items.map(toMembershipDto), meta: pageMeta(total, page, limit) };
}

// ===========================================================================
// Membership changes: ALWAYS inside runClubMembershipTransaction
// ===========================================================================

type ActorContext = { actorRole: ClubRole | null; isAdmin: boolean };

/**
 * The actor's role in the transaction's club, read INSIDE the transaction
 * (after the shared write), so it cannot be stale with respect to a
 * concurrent membership change (ADR-026, ADR-034). Also used by
 * club.service.updateClub.
 */
export async function clubRoleInTransaction(
  tx: ClubTransaction,
  actor: Actor,
): Promise<ClubRole | null> {
  const own = await ClubMembership.findOne(
    { club: tx.club._id, user: actor.id },
    { role: 1 },
    tx.options(),
  ).lean();
  return (own?.role ?? null) as ClubRole | null;
}

async function actorContext(tx: ClubTransaction, actor: Actor): Promise<ActorContext> {
  return { actorRole: await clubRoleInTransaction(tx, actor), isAdmin: actor.role === 'admin' };
}

/** Archived club: hidden (404) from outsiders, read-only (409) for the others. */
function assertWritableClub(tx: ClubTransaction, ctx: ActorContext): void {
  if (tx.club.status !== 'archived') return;
  if (!ctx.actorRole && !ctx.isAdmin) throw AppError.notFound('Club not found');
  throw AppError.conflict('Club is archived');
}

function canManage(ctx: ActorContext): boolean {
  return ctx.actorRole === 'organizer' || ctx.isAdmin;
}

function countOrganizers(tx: ClubTransaction): Promise<number> {
  return ClubMembership.countDocuments(
    { club: tx.club._id, role: 'organizer' },
    tx.options(),
  );
}

async function membershipDto(membershipId: Types.ObjectId, tx: ClubTransaction) {
  const membership = await ClubMembership.findById(membershipId, null, tx.options())
    .populate<{ user: { _id: Types.ObjectId; name: string; email: string } }>(
      'user',
      'name email',
    )
    .lean();
  if (!membership) throw new Error('Membership vanished inside its transaction');
  return toMembershipDto(membership);
}

/**
 * Add a member. Desired-state semantics: if the user is already a member
 * with the SAME role, the desired state is reached (200, created: false);
 * with ANOTHER role it is a conflict (409) - never silently treated as done.
 */
export async function addMember(actor: Actor, clubId: string, input: AddMemberInput) {
  try {
    return await runClubMembershipTransaction(clubId, async (tx) => {
      const ctx = await actorContext(tx, actor);
      assertWritableClub(tx, ctx);
      if (!canManage(ctx)) throw AppError.forbidden();

      const target = await User.findOne({ email: input.email }, { _id: 1 }, tx.options()).lean();
      if (!target) throw AppError.notFound('No user with this email');

      const existing = await ClubMembership.findOne(
        { club: tx.club._id, user: target._id },
        { role: 1 },
        tx.options(),
      ).lean();
      if (existing) {
        if (existing.role === input.role) {
          return { created: false, membership: await membershipDto(existing._id, tx) };
        }
        throw new AppError(
          409,
          'CONFLICT',
          'This user is already a member of the club with another role',
          { role: existing.role },
        );
      }

      // Inserts do not take maxTimeMS; they are bounded by the transaction
      // (conflicts fail fast) - see docs/development-database.md.
      const [created] = await ClubMembership.create(
        [{ club: tx.club._id, user: target._id, role: input.role, addedBy: actor.id }],
        { session: tx.session },
      );
      if (!created) throw new Error('Membership insert returned nothing');
      return { created: true, membership: await membershipDto(created._id, tx) };
    });
  } catch (error) {
    // Backstop: the unique (club, user) index (ADR-015 pattern).
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict('This user is already a member of the club');
    }
    throw error;
  }
}

/**
 * Change a member's role. Already in the requested role -> 200 unchanged
 * (safe retry). Demoting the last organizer -> 409, for everyone (admins too).
 */
export async function changeRole(
  actor: Actor,
  clubId: string,
  userId: string,
  role: ClubRole,
) {
  return runClubMembershipTransaction(clubId, async (tx) => {
    const ctx = await actorContext(tx, actor);
    assertWritableClub(tx, ctx);
    if (!canManage(ctx)) throw AppError.forbidden();

    const target = await ClubMembership.findOne(
      { club: tx.club._id, user: userId },
      { role: 1 },
      tx.options(),
    ).lean();
    if (!target) throw AppError.notFound('Not a member of this club');

    if (target.role !== role) {
      if (target.role === 'organizer' && (await countOrganizers(tx)) <= 1) {
        throw AppError.conflict(LAST_ORGANIZER);
      }
      await ClubMembership.findOneAndUpdate(
        { _id: target._id },
        { $set: { role } },
        tx.options(),
      );
    }
    return membershipDto(target._id, tx);
  });
}

/**
 * Remove a member: organizers and admins remove anyone, a member may remove
 * themselves (leave). Already absent -> 404 (the client may treat it as the
 * desired state). Removing the last organizer -> 409, for everyone.
 */
export async function removeMember(actor: Actor, clubId: string, userId: string) {
  await runClubMembershipTransaction(clubId, async (tx) => {
    const ctx = await actorContext(tx, actor);
    assertWritableClub(tx, ctx);
    const isSelf = userId === actor.id;
    if (!isSelf && !canManage(ctx)) throw AppError.forbidden();

    const target = await ClubMembership.findOne(
      { club: tx.club._id, user: userId },
      { role: 1 },
      tx.options(),
    ).lean();
    if (!target) throw AppError.notFound('Not a member of this club');

    if (target.role === 'organizer' && (await countOrganizers(tx)) <= 1) {
      throw AppError.conflict(LAST_ORGANIZER);
    }
    await ClubMembership.findOneAndDelete({ _id: target._id }, tx.options());
  });
}

/** Batched role lookup for a page of clubs: ONE query, whatever the page size. */
export async function rolesForClubs(
  actor: Actor,
  clubIds: readonly Types.ObjectId[],
): Promise<Map<string, ClubRole>> {
  if (clubIds.length === 0) return new Map();
  const memberships = await ClubMembership.find(
    { user: actor.id, club: { $in: clubIds } },
    { club: 1, role: 1 },
  ).lean();
  return new Map(memberships.map((m) => [m.club.toString(), m.role as ClubRole]));
}

/** The actor's memberships (for mine=true): one query, small bounded list. */
export async function membershipsOf(actor: Actor) {
  return ClubMembership.find({ user: actor.id }, { club: 1, role: 1 }).lean();
}

/** The actor's role in one club (single indexed lookup), or null. */
export async function roleInClub(actor: Actor, clubId: Types.ObjectId | string) {
  const membership = await ClubMembership.findOne(
    { club: clubId, user: actor.id },
    { role: 1 },
  ).lean();
  return (membership?.role ?? null) as ClubRole | null;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
  );
}
