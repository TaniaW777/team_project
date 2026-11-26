import { Router } from 'express';
import { authenticate } from '../../shared/authenticate.ts';
import { loadActor, requireRole } from '../../shared/authorize.ts';
import * as clubController from './club.controller.ts';
import * as membershipController from './membership.controller.ts';

export const clubRoutes = Router();

// Every club route: valid access token (lab) + actor loaded from the DB.
clubRoutes.use(authenticate, loadActor);

clubRoutes.get('/', clubController.list);
clubRoutes.post('/', requireRole('admin'), clubController.create);
clubRoutes.get('/:clubId', clubController.getOne);
clubRoutes.patch('/:clubId', clubController.update);
clubRoutes.delete('/:clubId', requireRole('admin'), clubController.archive);

// Memberships: a nested resource of the club.
clubRoutes.get('/:clubId/members', membershipController.list);
clubRoutes.post('/:clubId/members', membershipController.add);
clubRoutes.patch('/:clubId/members/:userId', membershipController.changeRole);
clubRoutes.delete('/:clubId/members/:userId', membershipController.remove);
