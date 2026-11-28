import { createPrivateKey, createPublicKey } from 'node:crypto';
import { compactVerify, importPKCS8, importSPKI, SignJWT } from 'jose';
import { env } from '../../config/env.ts';
import { AppError } from '../../shared/errors.ts';
import { isObjectId } from '../../shared/validation.ts';

// QR codes (ADR-037 TD3/§4): stateless Ed25519 JWTs. Nothing is stored; the
// server always reads the live ticket before accepting a scan. The public key
// is exported for the offline app's pre-check, which is never authoritative.

export const QR_ISSUER = 'eventpass-api';
export const QR_TYP = 'eventpass-ticket+jwt';

export type TicketForQr = { id: string; event: string; endsAt: Date };
export type VerifiedTicketQr = { ticketId: string; eventId: string };

let publicKeyPromise: Promise<CryptoKey> | null = null;

/** SPKI PEM for the offline bundle (no private material, no secrets). */
export function exportQrPublicKeyPem(): string {
  const privateKey = createPrivateKey(env.QR_SIGNING_PRIVATE_KEY);
  return createPublicKey(privateKey)
    .export({ type: 'spki', format: 'pem' })
    .toString();
}

function qrPublicKey(): Promise<CryptoKey> {
  publicKeyPromise ??= importSPKI(exportQrPublicKeyPem(), 'EdDSA');
  return publicKeyPromise;
}

function invalidQr(): AppError {
  return new AppError(422, 'INVALID_QR', 'Invalid or expired QR code');
}

/** Signs a short-lived JWT: no names, e-mails or ticket status in the payload. */
export async function signTicketQr(ticket: TicketForQr): Promise<string> {
  const privateKey = await importPKCS8(env.QR_SIGNING_PRIVATE_KEY, 'EdDSA');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt =
    Math.floor(ticket.endsAt.getTime() / 1000) + env.QR_TTL_GRACE_SECONDS;
  return new SignJWT({ tid: ticket.id, eid: ticket.event })
    .setProtectedHeader({ alg: 'EdDSA', typ: QR_TYP })
    .setIssuer(QR_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(privateKey);
}

/**
 * Verification order (§4, first failure wins): signature + algorithm, issuer,
 * type, expiry, then tid/eid format. `compactVerify` checks only the signature
 * and the key; the claims are checked here, after the signature is trusted.
 */
export async function verifyTicketQr(token: string): Promise<VerifiedTicketQr> {
  let header: { alg?: string; typ?: string };
  let payload: Record<string, unknown>;
  try {
    const verified = await compactVerify(token, await qrPublicKey(), {
      algorithms: ['EdDSA'],
    });
    header = verified.protectedHeader;
    const decoded: unknown = JSON.parse(new TextDecoder().decode(verified.payload));
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      throw invalidQr();
    }
    payload = decoded as Record<string, unknown>;
  } catch {
    throw invalidQr();
  }

  if (header.alg !== 'EdDSA') throw invalidQr();
  if (payload.iss !== QR_ISSUER) throw invalidQr();
  if (header.typ !== QR_TYP) throw invalidQr();
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= now ||
    typeof payload.iat !== 'number' ||
    !Number.isFinite(payload.iat)
  ) {
    throw invalidQr();
  }
  const { tid, eid } = payload;
  if (
    typeof tid !== 'string' ||
    !isObjectId(tid) ||
    typeof eid !== 'string' ||
    !isObjectId(eid)
  ) {
    throw invalidQr();
  }
  return { ticketId: tid, eventId: eid };
}
