import { Router } from 'express';
import { authenticate } from '../../shared/authenticate.ts';
import { loadActor } from '../../shared/authorize.ts';
import * as controller from './checkin.controller.ts';

// Mounted at /api/v1/tickets BEFORE ticketRoutes: the QR path must not be
// swallowed by GET /tickets/:ticketId.
export const qrRoutes = Router();
// Guard the QR route only: a router-level `use` would authenticate the other
// /tickets routes twice before they reached ticketRoutes.
qrRoutes.get('/:ticketId/qr', authenticate, loadActor, controller.ticketQr);
