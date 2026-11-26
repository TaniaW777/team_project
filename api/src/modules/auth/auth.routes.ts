import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.ts';
import { authenticate } from '../../shared/authenticate.ts';
import * as controller from './auth.controller.ts';

// Lab reference: section 1.8 (auth.routes.ts).

// Slow down password guessing: few attempts per IP per 15 minutes.
// EVENTPASS (ADR-017): the lab's limiter is built by this factory so a test
// can create one with a small limit and check the 429 response. The
// settings used by the app are the lab's, unchanged.
export function createCredentialsLimiter({
  limit = env.NODE_ENV === 'production' ? 10 : 100,
  skip = () => env.NODE_ENV === 'test',
}: { limit?: number; skip?: () => boolean } = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip,
    message: {
      error: { code: 'TOO_MANY_REQUESTS', message: 'Try again later' },
    },
  });
}

const credentialsLimiter = createCredentialsLimiter();

export const authRoutes = Router();

authRoutes.post('/register', credentialsLimiter, controller.register);
authRoutes.post('/login', credentialsLimiter, controller.login);
authRoutes.post('/refresh', controller.refresh);
authRoutes.post('/logout', controller.logout);
authRoutes.get('/me', authenticate, controller.me);
