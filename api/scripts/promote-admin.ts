// Promote an EXISTING user to the global `admin` role (ADR-032).
//
//   npm run promote-admin -- user@example.com              (development)
//   npm run promote-admin -- user@example.com --confirm    (NODE_ENV=production)
//
// Safeguards:
// - refuses NODE_ENV=test and any database whose name ends with "_test";
// - refuses NODE_ENV=production without --confirm;
// - all checks run BEFORE connecting; a missing user changes nothing;
// - prints the database NAME only: never MONGO_URI (it may hold
//   credentials), never a secret or a password hash;
// - only promotes: it cannot create users or set passwords.
// To demote an admin, set `role` back to "user" in the database by hand.
import mongoose from 'mongoose';
import { databaseNameOf } from '../src/config/db.ts';
import { env } from '../src/config/env.ts';
import { User } from '../src/modules/users/user.model.ts';
import { normalizedEmailSchema } from '../src/shared/validation.ts';

const USAGE = 'Usage: npm run promote-admin -- <email> [--confirm]';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const emailArg = args.find((arg) => !arg.startsWith('--'));
  const email = normalizedEmailSchema.safeParse(emailArg ?? '');
  if (!emailArg || !email.success) {
    console.error(USAGE);
    return 2;
  }

  const dbName = databaseNameOf(env.MONGO_URI);
  if (env.NODE_ENV === 'test' || !dbName || dbName.endsWith('_test')) {
    console.error(
      'Refusing to run: this script never touches a test database ' +
        '(NODE_ENV=test or a database name ending with "_test").',
    );
    return 1;
  }
  if (env.NODE_ENV === 'production' && !confirm) {
    console.error(
      `Refusing to run on a production database ("${dbName}") without --confirm.`,
    );
    return 1;
  }

  try {
    await mongoose.connect(env.MONGO_URI);
    const user = await User.findOne({ email: email.data }).select('role');
    if (!user) {
      console.error(
        `No user with this email in database "${dbName}". Register the account first.`,
      );
      return 1;
    }
    if (user.role === 'admin') {
      console.log(`${email.data} is already an admin in database "${dbName}". Nothing changed.`);
      return 0;
    }
    await User.updateOne({ _id: user._id, role: 'user' }, { $set: { role: 'admin' } });
    console.log(`Promoted ${email.data} to admin in database "${dbName}".`);
    return 0;
  } catch (error) {
    // Name and message only: never the connection string.
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
    console.error(`promote-admin failed: ${reason}`);
    return 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
}

process.exitCode = await main();
