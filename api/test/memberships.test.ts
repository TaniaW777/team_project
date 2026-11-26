import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ClubMembership } from '../src/modules/clubs/membership.model.ts';
import {
  addMember,
  changeRole,
  membershipVersion,
  organizerCount,
  removeMember,
  roleOf,
  standardClub,
} from './club-fixtures.ts';
import {
  api,
  bearer,
  closeTestDatabase,
  connectTestDatabase,
  registerUser,
  resetDatabase,
} from './helpers.ts';

// REQUIRES the `mongo-test` container (npm run db:up).

const members = (clubId: string) => `/api/v1/clubs/${clubId}/members`;

describe('memberships', () => {
  before(connectTestDatabase);
  beforeEach(resetDatabase);
  after(closeTestDatabase);

  describe('adding members', () => {
    it('201 with { user: { id, name, email }, role, createdAt } and nothing else', async () => {
      const { x, clubId } = await standardClub();
      const newcomer = await registerUser('new@example.com');
      const res = await addMember(x.accessToken, clubId, ' NEW@example.com ', 'staff');
      assert.equal(res.status, 201);
      assert.deepEqual(Object.keys(res.body.data.user).sort(), ['email', 'id', 'name']);
      assert.equal(res.body.data.user.id, newcomer.user.id);
      assert.equal(res.body.data.role, 'staff');
      assert.ok(!res.text.includes('passwordHash'));
    });

    it('unknown e-mail: 404', async () => {
      const { x, clubId } = await standardClub();
      const res = await addMember(x.accessToken, clubId, 'nobody@example.com', 'staff');
      assert.equal(res.status, 404);
    });

    it('desired state: same role again -> 200 unchanged; another role -> 409', async () => {
      const { x, z, clubId } = await standardClub();
      const same = await addMember(x.accessToken, clubId, z.user.email, 'staff');
      assert.equal(same.status, 200);
      assert.equal(same.body.data.role, 'staff');
      const other = await addMember(x.accessToken, clubId, z.user.email, 'organizer');
      assert.equal(other.status, 409);
      assert.equal(other.body.error.details.role, 'staff');
      assert.equal(await roleOf(clubId, z.user.id), 'staff'); // unchanged
    });

    it('two simultaneous additions of one user: one document, no 500', async () => {
      const { x, clubId } = await standardClub();
      const newcomer = await registerUser('new@example.com');
      const results = await Promise.all([
        addMember(x.accessToken, clubId, newcomer.user.email, 'staff'),
        addMember(x.accessToken, clubId, newcomer.user.email, 'staff'),
      ]);
      // Same role: the second one finds the desired state already reached.
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
      assert.equal(await ClubMembership.countDocuments({ club: clubId, user: newcomer.user.id }), 1);
    });

    it('two simultaneous additions with DIFFERENT roles: one 201, one 409', async () => {
      const { x, clubId } = await standardClub();
      const newcomer = await registerUser('new@example.com');
      const results = await Promise.all([
        addMember(x.accessToken, clubId, newcomer.user.email, 'staff'),
        addMember(x.accessToken, clubId, newcomer.user.email, 'organizer'),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal(await ClubMembership.countDocuments({ club: clubId, user: newcomer.user.id }), 1);
    });
  });

  describe('permissions and BOLA', () => {
    it('staff and outsiders cannot manage or list members (403)', async () => {
      const { z, outsider, clubId } = await standardClub();
      const newcomer = await registerUser('new@example.com');
      assert.equal((await addMember(z.accessToken, clubId, newcomer.user.email, 'staff')).status, 403);
      assert.equal((await addMember(outsider.accessToken, clubId, newcomer.user.email, 'staff')).status, 403);
      assert.equal((await api.get(members(clubId)).set(bearer(z.accessToken))).status, 403);
      assert.equal((await api.get(members(clubId)).set(bearer(outsider.accessToken))).status, 403);
    });

    it('an organizer of club A has no rights on club B', async () => {
      const a = await standardClub('a');
      const b = await standardClub('b');
      const t = a.x.accessToken;
      assert.equal((await addMember(t, b.clubId, a.outsider.user.email, 'staff')).status, 403);
      assert.equal((await changeRole(t, b.clubId, b.z.user.id, 'organizer')).status, 403);
      assert.equal((await removeMember(t, b.clubId, b.z.user.id)).status, 403);
      assert.equal((await api.get(members(b.clubId)).set(bearer(t))).status, 403);
    });

    it("mixed URL: A's organizer cannot reach B's member through club A", async () => {
      const a = await standardClub('a');
      const b = await standardClub('b');
      // Club A in the URL, but the target only has a membership in club B.
      const res = await removeMember(a.x.accessToken, a.clubId, b.z.user.id);
      assert.equal(res.status, 404);
      assert.equal(await roleOf(b.clubId, b.z.user.id), 'staff'); // untouched
    });

    it('organizers and admins list members, paginated, with a role filter', async () => {
      const { x, admin, clubId } = await standardClub();
      const all = await api.get(`${members(clubId)}?limit=2`).set(bearer(x.accessToken));
      assert.equal(all.status, 200);
      assert.deepEqual(all.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2 });
      const organizers = await api.get(`${members(clubId)}?role=organizer`).set(bearer(admin.accessToken));
      assert.equal(organizers.body.data.length, 2);
    });

    it('the permission check runs inside the transaction: a demoted organizer loses rights', async () => {
      const { x, y, clubId } = await standardClub();
      assert.equal((await changeRole(y.accessToken, clubId, x.user.id, 'staff')).status, 200);
      const newcomer = await registerUser('new@example.com');
      const res = await addMember(x.accessToken, clubId, newcomer.user.email, 'staff');
      assert.equal(res.status, 403);
    });
  });

  describe('roles and the last-organizer rule (sequential)', () => {
    it('promote; already organizer -> 200 unchanged; demote already staff -> 200 unchanged', async () => {
      const { x, z, clubId } = await standardClub();
      assert.equal((await changeRole(x.accessToken, clubId, z.user.id, 'organizer')).status, 200);
      assert.equal(await roleOf(clubId, z.user.id), 'organizer');
      assert.equal((await changeRole(x.accessToken, clubId, z.user.id, 'organizer')).status, 200);
      assert.equal((await changeRole(x.accessToken, clubId, z.user.id, 'staff')).status, 200);
      assert.equal((await changeRole(x.accessToken, clubId, z.user.id, 'staff')).status, 200);
      assert.equal(await roleOf(clubId, z.user.id), 'staff');
    });

    it('demoting, removing or leaving as the LAST organizer: 409 (organizer)', async () => {
      const { x, y, clubId } = await standardClub();
      assert.equal((await removeMember(x.accessToken, clubId, y.user.id)).status, 204);
      assert.equal((await changeRole(x.accessToken, clubId, x.user.id, 'staff')).status, 409);
      assert.equal((await removeMember(x.accessToken, clubId, x.user.id)).status, 409); // leave
      assert.equal(await organizerCount(clubId), 1);
    });

    it('the rule applies to admins too', async () => {
      const { admin, x, y, clubId } = await standardClub();
      assert.equal((await removeMember(admin.accessToken, clubId, y.user.id)).status, 204);
      const demote = await changeRole(admin.accessToken, clubId, x.user.id, 'staff');
      assert.equal(demote.status, 409);
      assert.equal(demote.body.error.message, 'A club must keep at least one organizer');
      assert.equal((await removeMember(admin.accessToken, clubId, x.user.id)).status, 409);
      assert.equal(await organizerCount(clubId), 1);
    });

    it('replace the last organizer: promote first, then remove', async () => {
      const { admin, x, y, z, clubId } = await standardClub();
      await removeMember(admin.accessToken, clubId, y.user.id);
      assert.equal((await changeRole(admin.accessToken, clubId, z.user.id, 'organizer')).status, 200);
      assert.equal((await removeMember(admin.accessToken, clubId, x.user.id)).status, 204);
      assert.equal(await organizerCount(clubId), 1);
    });

    it('staff can leave; staff cannot remove others; absent -> 404', async () => {
      const { x, z, clubId } = await standardClub();
      assert.equal((await removeMember(z.accessToken, clubId, x.user.id)).status, 403);
      assert.equal((await removeMember(z.accessToken, clubId, z.user.id)).status, 204);
      assert.equal((await removeMember(x.accessToken, clubId, z.user.id)).status, 404);
    });

    it('archived club: members get 409, outsiders 404', async () => {
      const { admin, x, outsider, clubId } = await standardClub();
      await api.delete(`/api/v1/clubs/${clubId}`).set(bearer(admin.accessToken));
      const newcomer = await registerUser('new@example.com');
      assert.equal((await addMember(x.accessToken, clubId, newcomer.user.email, 'staff')).status, 409);
      assert.equal((await addMember(outsider.accessToken, clubId, newcomer.user.email, 'staff')).status, 404);
    });
  });

  describe('transaction rollback', () => {
    it('a refused change leaves membershipVersion unchanged; a successful one adds exactly 1', async () => {
      const { x, y, clubId } = await standardClub();
      await removeMember(x.accessToken, clubId, y.user.id);
      const before = await membershipVersion(clubId);
      assert.equal((await changeRole(x.accessToken, clubId, x.user.id, 'staff')).status, 409);
      assert.equal(await membershipVersion(clubId), before); // shared write rolled back

      const newcomer = await registerUser('new@example.com');
      assert.equal((await addMember(x.accessToken, clubId, newcomer.user.email, 'staff')).status, 201);
      assert.equal(await membershipVersion(clubId), before + 1);
    });
  });
});
