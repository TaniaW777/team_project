import { Router } from 'express';
import { authenticate } from '../../shared/authenticate.ts';
import { loadActor } from '../../shared/authorize.ts';
import * as controller from './dashboard.controller.ts';

// Mounted at /api/v1/events/:eventId/dashboard (app.ts). mergeParams: the
// router sees :eventId from the mount path.
export const dashboardRoutes = Router({ mergeParams: true });

dashboardRoutes.use(authenticate, loadActor);

dashboardRoutes.get('/', controller.getOne);
