import mongoose from 'mongoose';
import { env } from './env.ts';
import { logger } from '../shared/logger.ts';

// Lab reference: section 1.2 (src/config/db.ts).
export async function connectDatabase(): Promise<void> {
  // Reject queries that use fields not declared in the schema.
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGO_URI);
  // EventPass (ADR-029): membership changes use transactions, which need a
  // replica set with a writable primary. Refuse to start otherwise.
  await verifyReplicaSet();
  logger.info('MongoDB connected');
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/** Database name of a mongodb:// or mongodb+srv:// URI, or undefined. */
// Moved unchanged from test/helpers.ts (ADR-009) so that production code
// (scripts/promote-admin.ts) never imports test code.
export function databaseNameOf(uri: string): string | undefined {
  // scheme://[user:pass@]host[,host...]/<dbname>[?options]
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(uri);
  const name = match?.[1] ? decodeURIComponent(match[1]) : '';
  return name.length > 0 ? name : undefined;
}

// ---------------------------------------------------------------------------
// Replica-set check (ADR-029)
// ---------------------------------------------------------------------------

export type HelloResult = { setName?: string; isWritablePrimary?: boolean };

/** Pure decision: what is wrong with this server for EventPass, if anything. */
export function describeReplicaSetProblem(hello: HelloResult): string | null {
  if (!hello.setName) {
    return (
      'MongoDB is reachable but is not a replica set. EventPass needs a ' +
      'replica set for transactions. Start the development database with ' +
      '`npm run db:up` (see docs/development-database.md).'
    );
  }
  if (!hello.isWritablePrimary) {
    return (
      `MongoDB replica set '${hello.setName}' has no writable primary yet. ` +
      'Wait until `npm run db:status` shows the database as healthy, then ' +
      'start again.'
    );
  }
  return null;
}

export class ReplicaSetRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplicaSetRequiredError';
  }
}

/** Throws ReplicaSetRequiredError unless connected to a writable primary. */
export async function verifyReplicaSet(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new ReplicaSetRequiredError('MongoDB is not connected.');
  const hello = (await db.admin().command({ hello: 1 })) as HelloResult;
  const problem = describeReplicaSetProblem(hello);
  // The message names the problem and the fix, never the connection string.
  if (problem) throw new ReplicaSetRequiredError(problem);
}
