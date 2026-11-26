import { Club } from '../src/modules/clubs/club.model.ts';
import { ClubMembership } from '../src/modules/clubs/membership.model.ts';
import type { Actor } from '../src/shared/authorize.ts';
import { api, bearer, promoteToAdmin, registerUser, type Session } from './helpers.ts';

// Shared fixtures for the Phase 3 tests (clubs, memberships, transactions).

export async function createAdmin(email: string): Promise<Session> {
  const session = await registerUser(email);
  await promoteToAdmin(session.user.id);
  return session;
}

export async function createClub(admin: Session, name: string): Promise<string> {
  const res = await api.post('/api/v1/clubs').set(bearer(admin.accessToken)).send({ name });
  if (res.status !== 201) throw new Error(`createClub failed with ${res.status}`);
  return res.body.data.id as string;
}

export function addMember(token: string, clubId: string, email: string, role: string) {
  return api
    .post(`/api/v1/clubs/${clubId}/members`)
    .set(bearer(token))
    .send({ email, role });
}

export function changeRole(token: string, clubId: string, userId: string, role: string) {
  return api
    .patch(`/api/v1/clubs/${clubId}/members/${userId}`)
    .set(bearer(token))
    .send({ role });
}

export function removeMember(token: string, clubId: string, userId: string) {
  return api.delete(`/api/v1/clubs/${clubId}/members/${userId}`).set(bearer(token));
}

export const asUser = (session: Session): Actor => ({ id: session.user.id, role: 'user' });
export const asAdmin = (session: Session): Actor => ({ id: session.user.id, role: 'admin' });

export function organizerCount(clubId: string): Promise<number> {
  return ClubMembership.countDocuments({ club: clubId, role: 'organizer' });
}

export async function membershipVersion(clubId: string): Promise<number> {
  const club = await Club.findById(clubId).select('+membershipVersion').lean();
  if (!club) throw new Error('club not found');
  return club.membershipVersion;
}

export async function roleOf(clubId: string, userId: string) {
  const membership = await ClubMembership.findOne({ club: clubId, user: userId }).lean();
  return membership?.role ?? null;
}

/**
 * A club with two organizers (x, y), one staff member (z), plus an admin
 * and an outsider. All e-mails are prefixed so several fixtures can coexist.
 */
export async function standardClub(prefix = 'a') {
  const admin = await createAdmin(`${prefix}-admin@example.com`);
  const x = await registerUser(`${prefix}-x@example.com`);
  const y = await registerUser(`${prefix}-y@example.com`);
  const z = await registerUser(`${prefix}-z@example.com`);
  const outsider = await registerUser(`${prefix}-outsider@example.com`);
  const clubId = await createClub(admin, `${prefix} Chess Club`);
  for (const [session, role] of [
    [x, 'organizer'],
    [y, 'organizer'],
    [z, 'staff'],
  ] as const) {
    const res = await addMember(admin.accessToken, clubId, session.user.email, role);
    if (res.status !== 201) throw new Error(`fixture addMember failed with ${res.status}`);
  }
  return { admin, x, y, z, outsider, clubId };
}
