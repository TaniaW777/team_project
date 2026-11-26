import { z } from 'zod';

// Lab reference: section 1.2 (src/config/env.ts).
// Every setting the API needs, validated once at startup.
// If something is missing we crash immediately with a clear message
// instead of failing later in the middle of a request (A3).
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  // EVENTPASS MODIFICATION OF THE LAB (ADR-013): the lab accepted any text,
  // so a typo ("15 minutes") only failed at the first login with a 500.
  // A number followed by s, m, h or d (the format jose understands).
  ACCESS_TOKEN_TTL: z
    .string()
    .regex(/^\d+[smhd]$/, 'Use a number followed by s, m, h or d (e.g. 15m)')
    .default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGIN: z.string().default('*'),
  // ADR-021 / ADR-036: number of reverse proxies in front of the API (the
  // hosting platform's load balancer = 1). 0 = trust none (local default).
  // Needed so req.ip, and therefore the login rate limit, is per client.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // prettifyError names the invalid variables and why; it never prints values.
  console.error('Invalid environment variables:');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
