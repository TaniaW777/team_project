import { z } from 'zod';

// Lab reference: section 1.6 (auth.schemas.ts).
//
// EVENTPASS MODIFICATION OF THE LAB (ADR-014): in Zod 4, `z.email().trim()`
// checks the e-mail format BEFORE trimming, so " Ada@Mail.COM " was rejected
// instead of becoming "ada@mail.com" as the lab intends. Normalise first,
// then validate.
const email = z.string().trim().toLowerCase().pipe(z.email());

// Unknown keys (for example "role") are dropped: nobody can make themselves admin.
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email,
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// The TypeScript types are DERIVED from the schemas: one source of truth.
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
