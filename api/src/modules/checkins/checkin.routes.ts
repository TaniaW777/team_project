import { Router } from 'express';
import { authenticate } from '../../shared/authenticate.ts';
import { loadActor } from '../../shared/authorize.ts';
import * as controller from './checkin.controller.ts';

// Mounted before the events router (app.ts): one auth pass per request and
// no conflict with GET /events/:eventId. mergeParams exposes :eventId.
export const checkinRoutes = Router({ mergeParams: true });
checkinRoutes.use(authenticate, loadActor);
checkinRoutes.post('/', controller.create);
checkinRoutes.get('/', controller.list);

export const syncRoutes = Router();
syncRoutes.use(authenticate, loadActor);
syncRoutes.post('/', controller.sync);

export const bundleRoutes = Router({ mergeParams: true });
bundleRoutes.use(authenticate, loadActor);
bundleRoutes.get('/', controller.bundle);
