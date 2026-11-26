import { Schema, model, type Types } from 'mongoose';

// A membership gives a user a management role in ONE club. There is no plain
// "member" role: attendees register to events, they do not join clubs.
export const CLUB_ROLES = ['organizer', 'staff'] as const;
export type ClubRole = (typeof CLUB_ROLES)[number];

const membershipSchema = new Schema(
  {
    club: { type: Schema.Types.ObjectId, ref: 'Club', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: CLUB_ROLES, required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// One membership per user per club; also serves every (club, user) lookup.
membershipSchema.index({ club: 1, user: 1 }, { unique: true });
// Counting organizers; members list filtered by role.
membershipSchema.index({ club: 1, role: 1 });
// "My clubs" (mine=true) and the batched myRole lookup of a club list.
membershipSchema.index({ user: 1, club: 1 });

// IMPORTANT (ADR-027): memberships are written ONLY by membership.service.ts,
// inside runClubMembershipTransaction. Any other write path would bypass the
// last-organizer protection.
export const ClubMembership = model(
  'ClubMembership',
  membershipSchema,
  'clubmemberships',
);

type PopulatedUser = { _id: Types.ObjectId; name: string; email: string };

export type MembershipWithUser = {
  user: PopulatedUser | Types.ObjectId | null;
  role: ClubRole;
  createdAt?: Date;
};

// DTO: only id, name and e-mail of the user leave the API (never the role
// or the password hash).
export function toMembershipDto(membership: MembershipWithUser) {
  const user = membership.user;
  const populated =
    user && typeof user === 'object' && 'email' in user ? user : null;
  return {
    user: populated
      ? { id: populated._id.toString(), name: populated.name, email: populated.email }
      : null,
    role: membership.role,
    createdAt: membership.createdAt,
  };
}
