import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { clubRoutes } from './modules/clubs/club.routes.ts';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.ts';
import { eventRoutes } from './modules/events/event.routes.ts';
import { ticketRoutes } from './modules/tickets/ticket.routes.ts';
import { errorHandler, notFoundHandler } from './shared/error-handler.ts';
import { logger } from './shared/logger.ts';

// Lab reference: section 1.4 (src/app.ts).
// Building the app in a function (without calling listen) lets the
// tests create an instance and send requests to it in memory.
export function createApp() {
  const app = express();

  // --- Global middleware (order matters) ---
  app.disable('x-powered-by');
  // Behind a hosting proxy only (ADR-036): otherwise every client would share
  // the proxy's IP, and a forged X-Forwarded-For must not be trusted locally.
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet()); // secure HTTP headers (A11)
  app.use(cors({ origin: env.CORS_ORIGIN })); // needed for Flutter web
  app.use(express.json({ limit: '100kb' })); // parse + cap JSON bodies (A11)
  app.use(pinoHttp({ logger })); // one log line per request

  // --- Routes ---
  // /health stays outside /api/v1: it is for the hosting platform and
  // monitoring, not part of the versioned API contract.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Feature routers, all under the versioned prefix (ADR-003).
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/clubs', clubRoutes);
  // Before eventRoutes: otherwise the events router would authenticate the
  // request first and the dashboard router would do it a second time.
  app.use('/api/v1/events/:eventId/dashboard', dashboardRoutes);
  app.use('/api/v1/events', eventRoutes);
  app.use('/api/v1/tickets', ticketRoutes);

  // --- Must be registered last ---
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
