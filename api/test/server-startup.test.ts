import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// Starts the real src/server.ts in a child process with a controlled
// environment and checks how it behaves when the configuration is wrong.
const apiRoot = fileURLToPath(new URL('..', import.meta.url));

type RunResult = { code: number | null; stdout: string; stderr: string };

function runServer(overrides: Record<string, string | undefined>): Promise<RunResult> {
  // Start from the current environment (PATH, SystemRoot... are needed on
  // Windows), then apply the overrides; `undefined` removes a variable.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/server.ts'], {
      cwd: apiRoot,
      env: childEnv,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    // Safety net: if the server wrongly starts, it would never exit.
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('server startup', () => {
  it('refuses to start when MONGO_URI is missing, and names the variable', async () => {
    const result = await runServer({
      NODE_ENV: 'production',
      PORT: '3999',
      MONGO_URI: undefined,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Invalid environment variables/);
    assert.match(result.stderr, /MONGO_URI/);
    assert.doesNotMatch(result.stdout, /API listening/);
  });

  it('refuses a JWT secret shorter than 32 characters, without printing it', async () => {
    const result = await runServer({
      NODE_ENV: 'production',
      PORT: '3999',
      JWT_ACCESS_SECRET: 'too-short-secret',
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /JWT_ACCESS_SECRET/);
    assert.doesNotMatch(result.stderr, /too-short-secret/);
    assert.doesNotMatch(result.stdout, /API listening/);
  });

  it('refuses an empty JWT secret (the .env.example default, ADR-018)', async () => {
    const result = await runServer({
      NODE_ENV: 'production',
      PORT: '3999',
      JWT_ACCESS_SECRET: '',
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /JWT_ACCESS_SECRET/);
  });

  it('refuses a malformed ACCESS_TOKEN_TTL at startup (ADR-013)', async () => {
    const result = await runServer({
      NODE_ENV: 'production',
      PORT: '3999',
      ACCESS_TOKEN_TTL: '15 minutes',
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /ACCESS_TOKEN_TTL/);
    assert.doesNotMatch(result.stdout, /API listening/);
  });

  it('refuses an invalid TRUST_PROXY (ADR-036)', async () => {
    const result = await runServer({
      NODE_ENV: 'production',
      PORT: '3999',
      TRUST_PROXY: 'yes',
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /TRUST_PROXY/);
  });

  it('refuses a QR signing key that is not PKCS8 Ed25519 (TD3)', async () => {
    const result = await runServer({
      NODE_ENV: 'production',
      PORT: '3999',
      QR_SIGNING_PRIVATE_KEY: 'not-a-pem-key',
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /QR_SIGNING_PRIVATE_KEY/);
    assert.doesNotMatch(result.stderr, /not-a-pem-key/);
  });

  it('exits with code 1 and never listens when MongoDB cannot be reached (ADR-008)', async () => {
    const result = await runServer({
      NODE_ENV: 'production', // JSON logs, no pretty transport
      PORT: '3999',
      MONGO_URI: 'not-a-mongodb-uri',
    });
    assert.equal(result.code, 1);
    assert.match(result.stdout, /Cannot connect to MongoDB/);
    assert.doesNotMatch(result.stdout, /API listening/);
  });
});
