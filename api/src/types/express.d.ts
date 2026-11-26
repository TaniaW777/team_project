// Lab reference: section 1.8 (src/types/express.d.ts).
// Tell TypeScript what our middleware adds to the request.
declare global {
  namespace Express {
    interface Request {
      // Set by `authenticate` (lab): the user id from the verified token.
      userId?: string;
      // Set by `loadActor` (EventPass, ADR-026): id + role read from the DB.
      actor?: { id: string; role: 'user' | 'admin' };
    }
  }
}

export {};
