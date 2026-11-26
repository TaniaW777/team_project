import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { assertClubRole } from '../src/modules/clubs/membership.service.ts';
import { AppError } from '../src/shared/errors.ts';
import { asAdmin, asUser, standardClub } from './club-fixtures.ts';
import {
  api,
  bearer,
  closeTestDatabase,
  connectTestDatabase,
  resetDatabase,
} from './helpers.ts';

// Contract tests of assertClubRole (docs/authorization.md), the function
// Members 2 and 4 call before event and check-in operations.
// REQUIRES the `mongo-test` container (npm run db:up).

const MISSING_ID = '0123456789abcdef01234567';
const fails = (status: number) => (error: unknown) =>
  error instanceof AppError && error.status === status;

describe('assertClubRole contract', () => {
  before(connectTestDatabase);
  beforeEach(resetDatabase);
  after(closeTestDatabase);

  it('1. missing or malformed club id: 404', async () => {
    const { x } = await standardClub();
    await assert.rejects(assertClubRole(asUser(x), MISSING_ID, ['organizer']), fails(404));
    await assert.rejects(assertClubRole(asUser(x), 'not-an-id', ['organizer']), fails(404));
  });

  it('3. role in `allowed`: returns club summary, role, viaAdmin=false', async () => {
    const { x, clubId } = await standardClub();
    const access = await assertClubRole(asUser(x), clubId, ['organizer']);
    assert.deepEqual(access, {
      club: { id: clubId, name: 'a Chess Club', status: 'active' },
      role: 'organizer',
      viaAdmin: false,
    });
  });

  it('3c. wrong role or no membership: 403', async () => {
    const { z, outsider, clubId } = await standardClub();
    await assert.rejects(assertClubRole(asUser(z), clubId, ['organizer']), fails(403));
    await assert.rejects(assertClubRole(asUser(outsider), clubId, ['organizer', 'staff']), fails(403));
    const staffOk = await assertClubRole(asUser(z), clubId, ['organizer', 'staff']);
    assert.equal(staffOk.role, 'staff');
  });

  it('rights in one club never count in another', async () => {
    const a = await standardClub('a');
    const b = await standardClub('b');
    await assert.rejects(assertClubRole(asUser(a.x), b.clubId, ['organizer']), fails(403));
  });

  it('3b. admin: 403 by default, allowed with allowAdmin (viaAdmin=true, role=null)', async () => {
    const { admin, clubId } = await standardClub();
    await assert.rejects(assertClubRole(asAdmin(admin), clubId, ['organizer']), fails(403));
    const access = await assertClubRole(asAdmin(admin), clubId, ['organizer'], { allowAdmin: true });
    assert.equal(access.viaAdmin, true);
    assert.equal(access.role, null);
  });

  it('archived: outsider 404, wrong role 403, allowed role 409 unless allowArchived', async () => {
    const { admin, x, z, outsider, clubId } = await standardClub();
    await api.delete(`/api/v1/clubs/${clubId}`).set(bearer(admin.accessToken));

    await assert.rejects(assertClubRole(asUser(outsider), clubId, ['organizer']), fails(404));
    await assert.rejects(assertClubRole(asUser(z), clubId, ['organizer']), fails(403));
    await assert.rejects(assertClubRole(asUser(x), clubId, ['organizer']), fails(409));
    const history = await assertClubRole(asUser(x), clubId, ['organizer'], { allowArchived: true });
    assert.equal(history.club.status, 'archived');

    await assert.rejects(
      assertClubRole(asAdmin(admin), clubId, ['organizer'], { allowAdmin: true }),
      fails(409),
    );
    const adminHistory = await assertClubRole(asAdmin(admin), clubId, ['organizer'], {
      allowAdmin: true,
      allowArchived: true,
    });
    assert.equal(adminHistory.viaAdmin, true);
  });

  it('an empty `allowed` list is a programming error', async () => {
    const { x, clubId } = await standardClub();
    await assert.rejects(assertClubRole(asUser(x), clubId, []), /at least one role/);
  });
});
