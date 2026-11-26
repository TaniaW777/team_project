import type { Request, RequestHandler } from 'express';
import { User, type UserRole } from '../modules/users/user.model.ts';
import { currentUserId } from './authenticate.ts';
import { AppError } from './errors.ts';
import { isObjectId } from './validation.ts';

// EventPass (ADR-026): the caller as the rest of the API sees it.
// `id` comes from the verified access token; `role` is read from the
// database by loadActor. Neither ever comes from the request body, the
// query string or a header.
export type Actor = { id: string; role: UserRole };

// Runs AFTER the lab's `authenticate`. One indexed lookup by _id.
// A user deleted after login is refused (401) instead of keeping access
// until the access token expires.
//
// Documented limitation (ADR-026): the global role is read here, at the
// start of the request. If an admin is demoted while one of their requests
// is in flight, that single request still runs with admin rights. Club
// roles have no such gap: they are checked inside the membership
// transaction.
export const loadActor: RequestHandler = async (req, _res, next) => {
  const userId = currentUserId(req);
  if (!isObjectId(userId)) throw AppError.unauthorized();

  const user = await User.findById(userId).select('role').lean();
  if (!user) throw AppError.unauthorized();

  req.actor = { id: userId, role: user.role };
  next();
};

// Route-level guard on the GLOBAL role (e.g. only admins create clubs).
// Club-level roles are checked in the services, never here.
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    const actor = currentActor(req);
    if (!roles.includes(actor.role)) throw AppError.forbidden();
    next();
  };
}

// Used by controllers behind `authenticate` + `loadActor`.
export function currentActor(req: Request): Actor {
  if (!req.actor) throw AppError.unauthorized();
  return req.actor;
}
