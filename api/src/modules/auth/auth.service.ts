import argon2 from 'argon2';
import { AppError } from '../../shared/errors.ts';
import { User, toUserDto, type UserDocument } from '../users/user.model.ts';
import type { LoginInput, RegisterInput } from './auth.schemas.ts';
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from './token.service.ts';

// Lab reference: section 1.8 (auth.service.ts).

async function buildSession(user: UserDocument) {
  const userId = user._id.toString();
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(userId),
    issueRefreshToken(userId),
  ]);
  return { user: toUserDto(user), accessToken, refreshToken };
}

export async function register(input: RegisterInput) {
  const exists = await User.exists({ email: input.email });
  if (exists) throw AppError.conflict('This email is already registered');

  // argon2id is the default variant: the current OWASP recommendation.
  // Library defaults are kept on purpose (ADR-016): m=64 MiB, t=3, p=4.
  const passwordHash = await argon2.hash(input.password);
  try {
    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
    });
    return await buildSession(user);
  } catch (error) {
    // EVENTPASS MODIFICATION OF THE LAB (ADR-015): two simultaneous
    // registrations with the same e-mail both pass the `exists` check; the
    // unique index then rejects the second insert with E11000, which the
    // lab answered with a 500. The index is the real guarantee: report 409.
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict('This email is already registered');
    }
    throw error;
  }
}

export async function login(input: LoginInput) {
  const user = await User.findOne({ email: input.email }).select(
    '+passwordHash',
  );

  // Same message for "unknown email" and "wrong password":
  // do not tell an attacker which emails have an account.
  const valid =
    user !== null && (await argon2.verify(user.passwordHash, input.password));
  if (!user || !valid) {
    throw AppError.unauthorized('Invalid email or password');
  }
  return buildSession(user);
}

export async function refresh(token: string) {
  const { userId, refreshToken } = await rotateRefreshToken(token);
  const accessToken = await signAccessToken(userId);
  return { accessToken, refreshToken };
}

export async function logout(token: string): Promise<void> {
  await revokeRefreshToken(token);
}

export async function getProfile(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw AppError.unauthorized();
  return toUserDto(user);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
