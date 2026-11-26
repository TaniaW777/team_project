import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';

// Lab reference: section 1.6 (user.model.ts). EventPass: the file lives in
// modules/users (ADR-011, one module per resource) and adds a global role
// (ADR-012). Club roles (organiser, door staff) belong to club memberships
// (Phase 3), never to the user document.

// `as const` instead of a TypeScript enum: enums are not erasable syntax.
export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true, // creates a unique index
      lowercase: true,
      trim: true,
    },
    // `select: false`: the hash is NOT returned by queries unless we
    // explicitly ask for it with .select('+passwordHash').
    passwordHash: { type: String, required: true, select: false },
    // Never taken from a request body: the register schema has no `role`,
    // so Zod drops it. Admin accounts are created by a seed script.
    role: { type: String, enum: USER_ROLES, default: 'user', required: true },
  },
  { timestamps: true },
);

export type UserDocument = HydratedDocument<InferSchemaType<typeof userSchema>>;

export const User = model('User', userSchema);

// DTO (Data Transfer Object): the only shape of a user that leaves the API.
export function toUserDto(user: UserDocument) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}
