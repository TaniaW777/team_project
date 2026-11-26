import { Router } from 'express';
import { authenticate } from '../../shared/authenticate.ts';
import { loadActor } from '../../shared/authorize.ts';
import * as controller from './ticket.controller.ts';

export const ticketRoutes = Router();

ticketRoutes.use(authenticate, loadActor);

ticketRoutes.get('/me', controller.listMine); // before '/:ticketId'
ticketRoutes.get('/:ticketId', controller.getOne);
ticketRoutes.delete('/:ticketId', controller.cancel);
