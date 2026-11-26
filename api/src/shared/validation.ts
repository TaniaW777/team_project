import { z } from 'zod';

// Shared validation building blocks (ADR-025). They are the lab's own
// patterns (todoIdSchema, listTodosSchema, the list `meta`), moved here so
// every module applies A4 and A9 the same way.

// A MongoDB ObjectId in a URL: 24 hexadecimal characters, otherwise 422.
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, 'Invalid id');

// E-mail normalised BEFORE validation (same rule as ADR-014).
export const normalizedEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email());

// Query strings are always text: coerce them. The page size is capped (A9).
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function pageMeta(total: number, page: number, limit: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

export function isObjectId(value: string): boolean {
  return objectIdSchema.safeParse(value).success;
}
