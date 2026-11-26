import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import {
  assertSafeTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
  databaseNameOf,
  resetDatabase,
} from './helpers.ts';

describe('test-database safety guard (ADR-009)', () => {
  it('extracts the database name, ignoring credentials and options', () => {
    assert.equal(
      databaseNameOf('mongodb://127.0.0.1:27017/eventpass_test'),
      'eventpass_test',
    );
    assert.equal(
      databaseNameOf(
        'mongodb+srv://user:pw@cluster0.example.net/eventpass_test?retryWrites=true',
      ),
      'eventpass_test',
    );
    assert.equal(
      databaseNameOf('mongodb://h1:27017,h2:27017/eventpass_test?replicaSet=rs0'),
      'eventpass_test',
    );
    assert.equal(databaseNameOf('mongodb://127.0.0.1:27017'), undefined);
    assert.equal(databaseNameOf('mongodb://127.0.0.1:27017/'), undefined);
  });

  it('accepts a *_test database when NODE_ENV is test', () => {
    assert.equal(
      assertSafeTestDatabase('mongodb://127.0.0.1:27017/eventpass_test', 'test'),
      'eventpass_test',
    );
  });

  it('refuses a development database', () => {
    assert.throws(
      () => assertSafeTestDatabase('mongodb://127.0.0.1:27017/eventpass_dev', 'test'),
      /non-test database/,
    );
  });

  it('is not fooled by "_test" at the end of the query string', () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          'mongodb://127.0.0.1:27017/eventpass_dev?appName=x_test',
          'test',
        ),
      /non-test database/,
    );
  });

  it('refuses a URI without a database name', () => {
    assert.throws(
      () => assertSafeTestDatabase('mongodb://127.0.0.1:27017/', 'test'),
      /non-test database/,
    );
  });

  it('refuses to run outside NODE_ENV=test', () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          'mongodb://127.0.0.1:27017/eventpass_test',
          'development',
        ),
      /NODE_ENV/,
    );
  });

  it('never puts the URI (and its credentials) in the error message', () => {
    assert.throws(
      () =>
        assertSafeTestDatabase(
          'mongodb+srv://admin:S3cretPw@cluster0.example.net/prod',
          'test',
        ),
      (error: Error) =>
        !error.message.includes('S3cretPw') && !error.message.includes('admin'),
    );
  });
});

describe('test database connection', () => {
  before(connectTestDatabase);
  after(closeTestDatabase);

  it('connects to the *_test database and can reset it', async () => {
    assert.ok(mongoose.connection.name.endsWith('_test'));

    const probe = mongoose.connection.collection('phase1_probe');
    await probe.insertOne({ createdBy: 'database.test.ts' });
    assert.equal(await probe.countDocuments(), 1);

    await resetDatabase();
    assert.equal(await probe.countDocuments(), 0);
  });
});
