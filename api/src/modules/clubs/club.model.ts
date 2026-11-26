import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';
import type { ClubRole } from './membership.model.ts';

// A club is an official campus association, created by a platform admin.
// Its organizers and staff are ClubMembership documents (referenced, not
// embedded: the relation is many-to-many and is queried from both sides).

// `as const` arrays instead of TypeScript enums (not erasable syntax).
export const CLUB_STATUSES = ['active', 'archived'] as const;
export type ClubStatus = (typeof CLUB_STATUSES)[number];

// Case-insensitive comparison: "Chess Club" and "chess club" are the same name.
export const CLUB_NAME_COLLATION = { locale: 'en', strength: 2 } as const;

const clubSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    // The club's public contact address (not a member's e-mail).
    contactEmail: { type: String, trim: true, lowercase: true, default: null },
    status: { type: String, enum: CLUB_STATUSES, default: 'active', required: true },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Shared-write field for membership transactions (ADR-027). Every
    // membership change increments it FIRST, inside its transaction, so two
    // changes to the same club always conflict and run one after the other.
    // Internal: hidden from queries, never in a DTO, never accepted as input.
    membershipVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true },
);

// Unique name, whatever the case (ADR-030).
clubSchema.index({ name: 1 }, { unique: true, collation: CLUB_NAME_COLLATION });
// The list query: filter by status, sort by name (A10).
clubSchema.index({ status: 1, name: 1 }, { collation: CLUB_NAME_COLLATION });

export type ClubDocument = HydratedDocument<InferSchemaType<typeof clubSchema>>;

export const Club = model('Club', clubSchema);

type ClubLike = Pick<
  ClubDocument,
  '_id' | 'name' | 'description' | 'contactEmail' | 'status' | 'createdAt'
>;

// DTO: the only shape of a club that leaves the API. `myRole` is the
// caller's role in this club (null when they have none).
export function toClubDto(club: ClubLike, myRole: ClubRole | null) {
  return {
    id: club._id.toString(),
    name: club.name,
    description: club.description ?? '',
    contactEmail: club.contactEmail ?? null,
    status: club.status,
    createdAt: club.createdAt,
    myRole,
  };
}
