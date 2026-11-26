import { pino } from 'pino';
import { env } from '../config/env.ts';

// Lab reference: section 1.2 (src/shared/logger.ts).
// Structured JSON logs in production, pretty logs while developing,
// and silence while the tests run.
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  transport:
    env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  // Never write credentials to the logs.
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});
