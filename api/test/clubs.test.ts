import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { Club } from '../src/modules/clubs/club.model.ts';
import { User } from '../src/modules/users/user.model.ts';
import { createAdmin, createClub, standardClub } from './club-fixtures.ts';
import {
  api,
  bearer,
  closeTestDatabase,
  connectTestDatabase,
  registerUser,
  resetDatabase,
} from './helpers.ts';

// REQUIRES the `mongo-test` container (npm run db:up). See
// docs/development-database.md.

const CLUBS = '/api/v1/clubs';
const MISSING_ID = '0123456789abcdef01234567';

describe('clubs', () => {
  before(connectTestDatabase);
  beforeEach(resetDatabase);
  after(closeTestDatabase);

  describe('authentication and actor', () => {
    it('every club route requires a token (401)', async () => {
      assert.equal((await api.get(CLUBS)).status, 401);
      assert.equal((await api.get(`${CLUBS}/${MISSING_ID}`)).status, 401);
      assert.equal((await api.post(CLUBS).send({ name: 'X club' })).status, 401);
    });

    it('a user deleted after login is refused (401, loadActor)', async () => {
      const session = await registerUser('gone@example.com');
      await User.deleteOne({ _id: session.user.id });
      const res = await api.get(CLUBS).set(bearer(session.accessToken));
      assert.equal(res.status, 401);
    });
  });

  describe('creation (admin only)', () => {
    it('a normal user gets 403', async () => {
      const user = await registerUser('user@example.com');
      const res = await api.post(CLUBS).set(bearer(user.accessToken)).send({ name: 'Chess Club' });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('an admin creates a club; the DTO exposes only public fields', async () => {
      const admin = await createAdmin('admin@example.com');
      const res = await api
        .post(CLUBS)
        .set(bearer(admin.accessToken))
        .send({ name: '  Chess Club ', description: 'Weekly games', contactEmail: ' Chess@Campus.EDU ' });
      assert.equal(res.status, 201);
      const club = res.body.data;
      assert.deepEqual(Object.keys(club).sort(), [
        'contactEmail', 'createdAt', 'description', 'id', 'myRole', 'name', 'status',
      ]);
      assert.equal(club.name, 'Chess Club');
      assert.equal(club.contactEmail, 'chess@campus.edu');
      assert.equal(club.status, 'active');
      assert.equal(club.myRole, null); // the creator gets no membership
      assert.ok(!res.text.includes('membershipVersion'));
      assert.ok(!res.text.includes('createdBy'));
    });

    it('ignores mass-assignment fields', async () => {
      const admin = await createAdmin('admin@example.com');
      const res = await api.post(CLUBS).set(bearer(admin.accessToken)).send({
        name: 'Chess Club', status: 'archived', membershipVersion: 99,
        createdBy: MISSING_ID, _id: MISSING_ID,
      });
      assert.equal(res.status, 201);
      assert.notEqual(res.body.data.id, MISSING_ID);
      const stored = await Club.findById(res.body.data.id).select('+membershipVersion').lean();
      assert.equal(stored?.status, 'active');
      assert.equal(stored?.membershipVersion, 0);
      assert.equal(stored?.createdBy.toString(), admin.user.id);
    });

    it('names are unique whatever the case (409)', async () => {
      const admin = await createAdmin('admin@example.com');
      await createClub(admin, 'Chess Club');
      const res = await api.post(CLUBS).set(bearer(admin.accessToken)).send({ name: 'CHESS club' });
      assert.equal(res.status, 409);
    });

    it('two parallel creations of one name: one 201, one 409', async () => {
      const admin = await createAdmin('admin@example.com');
      const results = await Promise.all([
        api.post(CLUBS).set(bearer(admin.accessToken)).send({ name: 'Race Club' }),
        api.post(CLUBS).set(bearer(admin.accessToken)).send({ name: 'race club' }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal(await Club.countDocuments(), 1);
    });

    it('validates input (422)', async () => {
      const admin = await createAdmin('admin@example.com');
      const res = await api.post(CLUBS).set(bearer(admin.accessToken)).send({ name: 'A' });
      assert.equal(res.status, 422);
      const badId = await api.get(`${CLUBS}/123`).set(bearer(admin.accessToken));
      assert.equal(badId.status, 422);
    });
  });

  describe('reading', () => {
    it('unknown club: 404', async () => {
      const user = await registerUser('user@example.com');
      const res = await api.get(`${CLUBS}/${MISSING_ID}`).set(bearer(user.accessToken));
      assert.equal(res.status, 404);
    });

    it('myRole is organizer, staff or null depending on the caller', async () => {
      const { x, z, outsider, clubId } = await standardClub();
      const get = (token: string) => api.get(`${CLUBS}/${clubId}`).set(bearer(token));
      assert.equal((await get(x.accessToken)).body.data.myRole, 'organizer');
      assert.equal((await get(z.accessToken)).body.data.myRole, 'staff');
      assert.equal((await get(outsider.accessToken)).body.data.myRole, null);
    });

    it('lists with pagination meta, sorted by name, limit capped', async () => {
      const admin = await createAdmin('admin@example.com');
      for (const name of ['Gamma club', 'alpha club', 'Beta club']) await createClub(admin, name);
      const page1 = await api.get(`${CLUBS}?page=1&limit=2`).set(bearer(admin.accessToken));
      assert.equal(page1.status, 200);
      assert.deepEqual(page1.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2 });
      assert.deepEqual(page1.body.data.map((c: { name: string }) => c.name), ['alpha club', 'Beta club']);
      const tooBig = await api.get(`${CLUBS}?limit=101`).set(bearer(admin.accessToken));
      assert.equal(tooBig.status, 422);
    });

    it('q searches case-insensitively and treats regex characters literally', async () => {
      const admin = await createAdmin('admin@example.com');
      await createClub(admin, 'Chess Club');
      await createClub(admin, 'Drama Club');
      const chess = await api.get(`${CLUBS}?q=CHESS`).set(bearer(admin.accessToken));
      assert.equal(chess.body.data.length, 1);
      const regex = await api.get(`${CLUBS}?q=${encodeURIComponent('.*')}`).set(bearer(admin.accessToken));
      assert.equal(regex.body.data.length, 0);
    });

    it('mine=true lists only the caller\'s clubs, with myRole', async () => {
      const { x, admin } = await standardClub();
      await createClub(admin, 'Other Club');
      const res = await api.get(`${CLUBS}?mine=true`).set(bearer(x.accessToken));
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].myRole, 'organizer');
    });

    it('myRole for a whole page costs exactly ONE membership query (batched)', async () => {
      const admin = await createAdmin('admin@example.com');
      await Club.insertMany(
        Array.from({ length: 25 }, (_, i) => ({ name: `Club ${String(i).padStart(2, '0')}`, createdBy: admin.user.id })),
      );
      const user = await registerUser('user@example.com');
      let membershipQueries = 0;
      mongoose.set('debug', (collection: string) => {
        if (collection === 'clubmemberships') membershipQueries++;
      });
      try {
        const res = await api.get(`${CLUBS}?limit=25`).set(bearer(user.accessToken));
        assert.equal(res.body.data.length, 25);
      } finally {
        mongoose.set('debug', false);
      }
      assert.equal(membershipQueries, 1);
    });
  });

  describe('updating (organizer of THIS club or admin)', () => {
    it('organizer 200; staff, outsider and an organizer of another club 403', async () => {
      const a = await standardClub('a');
      const b = await standardClub('b');
      const patch = (token: string, clubId: string) =>
        api.patch(`${CLUBS}/${clubId}`).set(bearer(token)).send({ description: 'New text' });
      assert.equal((await patch(a.x.accessToken, a.clubId)).status, 200);
      assert.equal((await patch(a.z.accessToken, a.clubId)).status, 403);
      assert.equal((await patch(a.outsider.accessToken, a.clubId)).status, 403);
      assert.equal((await patch(b.x.accessToken, a.clubId)).status, 403); // cross-club
    });

    it('status is admin-only; empty PATCH is 422', async () => {
      const { x, clubId } = await standardClub();
      const status = await api.patch(`${CLUBS}/${clubId}`).set(bearer(x.accessToken)).send({ status: 'archived' });
      assert.equal(status.status, 403);
      const empty = await api.patch(`${CLUBS}/${clubId}`).set(bearer(x.accessToken)).send({});
      assert.equal(empty.status, 422);
    });
  });

  describe('archiving (soft delete, admin only)', () => {
    it('DELETE: 403 for non-admins, 204 for the admin, idempotent, 404 if missing', async () => {
      const { admin, x, clubId } = await standardClub();
      assert.equal((await api.delete(`${CLUBS}/${clubId}`).set(bearer(x.accessToken))).status, 403);
      assert.equal((await api.delete(`${CLUBS}/${clubId}`).set(bearer(admin.accessToken))).status, 204);
      assert.equal((await api.delete(`${CLUBS}/${clubId}`).set(bearer(admin.accessToken))).status, 204);
      assert.equal((await api.delete(`${CLUBS}/${MISSING_ID}`).set(bearer(admin.accessToken))).status, 404);
    });

    it('archived: hidden from outsiders, read-only for members, restorable by the admin', async () => {
      const { admin, x, outsider, clubId } = await standardClub();
      await api.delete(`${CLUBS}/${clubId}`).set(bearer(admin.accessToken));

      assert.equal((await api.get(`${CLUBS}/${clubId}`).set(bearer(outsider.accessToken))).status, 404);
      const member = await api.get(`${CLUBS}/${clubId}`).set(bearer(x.accessToken));
      assert.equal(member.status, 200);
      assert.equal(member.body.data.status, 'archived');

      const edit = await api.patch(`${CLUBS}/${clubId}`).set(bearer(x.accessToken)).send({ description: 'x' });
      assert.equal(edit.status, 409);

      const list = await api.get(CLUBS).set(bearer(x.accessToken));
      assert.equal(list.body.data.length, 0);
      const filtered = await api.get(`${CLUBS}?status=archived`).set(bearer(x.accessToken));
      assert.equal(filtered.status, 403);
      const adminList = await api.get(`${CLUBS}?status=archived`).set(bearer(admin.accessToken));
      assert.equal(adminList.body.data.length, 1);

      const restored = await api.patch(`${CLUBS}/${clubId}`).set(bearer(admin.accessToken)).send({ status: 'active' });
      assert.equal(restored.status, 200);
      assert.equal(restored.body.data.status, 'active');
    });
  });
});
