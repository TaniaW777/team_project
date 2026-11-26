import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// Deployment readiness (ADR-036). Hosting platforms inject environment
// variables but provide no .env file: the start scripts must not require one.
const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const scripts = JSON.parse(readFileSync(`${apiRoot}package.json`, 'utf8')).scripts as Record<
  string,
  string
>;

describe('deployment readiness', () => {
  for (const name of ['start', 'dev', 'promote-admin']) {
    it(`"${name}" loads .env only if it exists`, () => {
      assert.match(scripts[name] ?? '', /--env-file-if-exists=\.env\b/);
      assert.doesNotMatch(scripts[name] ?? '', /--env-file=\.env\b/);
    });
  }

  it('the server starts from platform variables alone (no .env file)', async () => {
    // Same flags as `npm start`, pointing at a file that does not exist.
    // An unusable MONGO_URI stops it right after configuration was read,
    // which proves the variables came from the environment.
    const result = await new Promise<{ code: number | null; out: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--env-file-if-exists=.env.platform-has-none', 'src/server.ts'],
        {
          cwd: apiRoot,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: '3999',
            MONGO_URI: 'not-a-mongodb-uri',
          },
        },
      );
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (out += chunk));
      const timer = setTimeout(() => child.kill(), 20_000);
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, out });
      });
    });
    assert.equal(result.code, 1);
    assert.match(result.out, /Cannot connect to MongoDB/); // past env validation
    assert.doesNotMatch(result.out, /Invalid environment variables/);
  });
});
