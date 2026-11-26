import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../config/env.ts';
import { AppError } from '../../shared/errors.ts';
import { RefreshToken } from './refresh-token.model.ts';

// Lab reference: section 1.7 (token.service.ts). Only the issuer and the
// audience are renamed for EventPass.
const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
export const ISSUER = 'eventpass-api';
export const AUDIENCE = 'eventpass-app';
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- Access token: short-lived, stateless JWT ----------

export function signAccessToken(userId: string): Promise<string> {
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'], // never let the token choose its algorithm
    });
    if (!payload.sub) throw new Error('Missing subject');
    return payload.sub;
  } catch {
    throw AppError.unauthorized('Invalid or expired access token');
  }
}

// ---------- Refresh token: long-lived, opaque, stored hashed ----------

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(
  userId: string,
  family: string = randomUUID(),
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await RefreshToken.create({
    user: userId,
    tokenHash: hashToken(token),
    family,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
  });
  return token;
}

// Rotation: a refresh token can be used exactly ONCE.
export async function rotateRefreshToken(
  token: string,
): Promise<{ userId: string; refreshToken: string }> {
  const tokenHash = hashToken(token);
  const now = new Date();

  // Atomic "claim": only one request can flip usedAt from null to a date.
  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, usedAt: null, expiresAt: { $gt: now } },
    { usedAt: now },
  );

  if (claimed) {
    const userId = claimed.user.toString();
    const refreshToken = await issueRefreshToken(userId, claimed.family);

    // EVENTPASS MODIFICATION OF THE LAB (ADR-019): if a concurrent request
    // replayed this same token, it deleted the family while we were issuing
    // the new token, and our new token may have been inserted AFTER that
    // deletion. Re-check: if the token we claimed is gone, the session was
    // revoked, so revoke again (removing our new token) and refuse.
    if (!(await RefreshToken.exists({ _id: claimed._id }))) {
      await RefreshToken.deleteMany({ family: claimed.family });
      throw AppError.unauthorized('Invalid refresh token');
    }
    return { userId, refreshToken };
  }

  // Not claimable. If it exists and was already used, somebody is
  // replaying an old token: assume theft and end the whole session.
  const stale = await RefreshToken.findOne({ tokenHash });
  if (stale?.usedAt) {
    await RefreshToken.deleteMany({ family: stale.family });
  }
  throw AppError.unauthorized('Invalid refresh token');
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const found = await RefreshToken.findOne({ tokenHash: hashToken(token) });
  if (found) await RefreshToken.deleteMany({ family: found.family });
}
