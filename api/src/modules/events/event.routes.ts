import { Router } from 'express';
import { authenticate } from '../../shared/authenticate.ts';
import { loadActor } from '../../shared/authorize.ts';
import * as ticketController from '../tickets/ticket.controller.ts';
import * as controller from './event.controller.ts';

export const eventRoutes = Router();

eventRoutes.use(authenticate, loadActor);

eventRoutes.get('/', controller.list);
eventRoutes.post('/', controller.create);
eventRoutes.get('/:eventId', controller.getOne);
eventRoutes.patch('/:eventId', controller.update);
eventRoutes.delete('/:eventId', controller.cancel);
// Registration creates (or reuses) the attendee's ticket.
eventRoutes.post('/:eventId/registrations', ticketController.register);
