import type { Request, RequestHandler } from 'express';
import { AppError } from './errors.ts';
import { verifyAccessToken } from '../modules/auth/token.service.ts';

// Lab reference: section 1.8 (src/shared/authenticate.ts), unchanged.

// Guards a route: the request must carry `Authorization: Bearer <token>`.
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw AppError.unauthorized();
  }

  req.userId = await verifyAccessToken(token);
  next();
};

// Used by controllers behind `authenticate` to read the caller's id.
// The identity ALWAYS comes from the verified token, never from the body
// or the URL: the structural defence against BOLA (OWASP API1).
export function currentUserId(req: Request): string {
  if (!req.userId) throw AppError.unauthorized();
  return req.userId;
}
