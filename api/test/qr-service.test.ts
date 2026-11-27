import assert from 'node:assert/strict';
import {
  compactVerify,
  decodeProtectedHeader,
  importPKCS8,
  importSPKI,
  SignJWT,
} from 'jose';
import { describe, it } from 'node:test';
import { env } from '../src/config/env.ts';
import { AppError } from '../src/shared/errors.ts';
import {
  exportQrPublicKeyPem,
  QR_ISSUER,
  QR_TYP,
  signTicketQr,
  verifyTicketQr,
} from '../src/modules/checkins/qr.service.ts';

// Pure jose tests: no database, no HTTP. The key comes from .env.test.
const ticketId = '507f1f77bcf86cd799439011';
const eventId = '507f1f77bcf86cd799439012';
const ticket = {
  id: ticketId,
  event: eventId,
  endsAt: new Date(Date.now() + 3_600_000),
};

function expectInvalidQr(error: unknown): boolean {
  return error instanceof AppError && error.code === 'INVALID_QR';
}

async function signRaw(claims: Record<string, unknown>, expiresAt: number) {
  const key = await importPKCS8(env.QR_SIGNING_PRIVATE_KEY, 'EdDSA');
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA', typ: QR_TYP })
    .setIssuer(QR_ISSUER)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
    .setExpirationTime(expiresAt)
    .sign(key);
}

describe('QR service (EdDSA JWT)', () => {
  it('signs a token with the required header and claims, and verifies it', async () => {
    const token = await signTicketQr(ticket);
    const header = decodeProtectedHeader(token);
    assert.equal(header.alg, 'EdDSA');
    assert.equal(header.typ, QR_TYP);
    assert.ok(token.length > 150 && token.length < 600);

    const verified = await verifyTicketQr(token);
    assert.deepEqual(verified, { ticketId, eventId });
  });

  it('rejects a tampered signature', async () => {
    const token = await signTicketQr(ticket);
    const [head, payload, signature] = token.split('.');
    assert.ok(head && payload && signature);
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    await assert.rejects(
      () => verifyTicketQr(`${head}.${payload}.${flipped}`),
      expectInvalidQr,
    );
  });

  it('rejects an expired token', async () => {
    const token = await signRaw(
      { tid: ticketId, eid: eventId },
      Math.floor(Date.now() / 1000) - 10,
    );
    await assert.rejects(() => verifyTicketQr(token), expectInvalidQr);
  });

  it('rejects a wrong issuer or type even when the signature is valid', async () => {
    const wrongIssuer = await new SignJWT({ tid: ticketId, eid: eventId })
      .setProtectedHeader({ alg: 'EdDSA', typ: QR_TYP })
      .setIssuer('another-api')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(await importPKCS8(env.QR_SIGNING_PRIVATE_KEY, 'EdDSA'));
    await assert.rejects(() => verifyTicketQr(wrongIssuer), expectInvalidQr);

    const wrongType = await new SignJWT({ tid: ticketId, eid: eventId })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .setIssuer(QR_ISSUER)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(await importPKCS8(env.QR_SIGNING_PRIVATE_KEY, 'EdDSA'));
    await assert.rejects(() => verifyTicketQr(wrongType), expectInvalidQr);
  });

  it('rejects malformed ids but returns a well-formed eid for the event check', async () => {
    const token = await signRaw(
      { tid: 'not-an-id', eid: eventId },
      Math.floor(Date.now() / 1000) + 60,
    );
    await assert.rejects(() => verifyTicketQr(token), expectInvalidQr);

    const valid = await signRaw(
      { tid: ticketId, eid: '507f1f77bcf86cd799439099' },
      Math.floor(Date.now() / 1000) + 60,
    );
    assert.equal((await verifyTicketQr(valid)).eventId, '507f1f77bcf86cd799439099');
  });

  it('exports a public SPKI PEM that verifies the token and holds no secret', async () => {
    const pem = exportQrPublicKeyPem();
    assert.match(pem, /^-----BEGIN PUBLIC KEY-----/);
    assert.doesNotMatch(pem, /PRIVATE KEY/);
    const publicKey = await importSPKI(pem, 'EdDSA');
    const token = await signTicketQr(ticket);
    const { payload } = await compactVerify(token, publicKey, {
      algorithms: ['EdDSA'],
    });
    assert.equal(JSON.parse(new TextDecoder().decode(payload)).tid, ticketId);
  });
});
