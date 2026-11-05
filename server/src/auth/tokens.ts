import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { jwtVerify, SignJWT } from "jose";
import { env } from "../config/env.js";
import type { Db } from "../db/pool.js";
import { ApiError, logger, randomToken, sha256 } from "../lib/core.js";

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const ISSUER = "commissaire";
const AUDIENCE = "commissaire-api";

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

/** Short-lived access token. A distinct issuer/audience means El Niño tokens never pass. */
export const signAccessToken = (c: AccessClaims) =>
  new SignJWT({ sid: c.sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(secret);

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") throw new Error("claims");
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    throw new ApiError(401, "unauthorized", "Sign in again");
  }
}

// --- sessions (opaque refresh tokens, stored hashed, rotated on every use) ---

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000);

export async function createSession(db: Db, userId: string, deviceId: string | null, userAgent: string | null): Promise<SessionTokens> {
  const refreshToken = randomToken();
  const s = await db.one<{ id: string }>(
    `INSERT INTO sessions ("userId", "refreshTokenHash", "deviceId", "userAgent", "expiresAt")
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, sha256(refreshToken), deviceId, userAgent, refreshExpiry()],
  );
  return { accessToken: await signAccessToken({ userId, sessionId: s!.id }), refreshToken, expiresIn: 15 * 60 };
}

export class RefreshReuseError extends ApiError {
  constructor(readonly userId: string) {
    super(401, "unauthorized", "Sign in again");
  }
}

/** Rotates a refresh token. Re-using an already-rotated token revokes the whole chain. */
export async function refreshSession(db: Db, refreshToken: string): Promise<SessionTokens & { userId: string }> {
  const s = await db.one<{ id: string; userId: string; revokedAt: Date | null; expiresAt: Date; replacedBy: string | null; isActive: boolean }>(
    `SELECT s.id, s."userId", s."revokedAt", s."expiresAt", s."replacedBy", u."isActive"
     FROM sessions s JOIN users u ON u.id = s."userId" WHERE s."refreshTokenHash" = $1`,
    [sha256(refreshToken)],
  );
  if (!s) throw new ApiError(401, "unauthorized", "Sign in again");
  if (s.revokedAt || s.replacedBy) {
    // Token reuse: someone holds an old token. The caller revokes every session of
    // this user OUTSIDE this transaction, so the revocation is not rolled back.
    throw new RefreshReuseError(s.userId);
  }
  if (s.expiresAt < new Date() || !s.isActive) throw new ApiError(401, "unauthorized", "Sign in again");
  const nextToken = randomToken();
  const next = await db.one<{ id: string }>(
    `INSERT INTO sessions ("userId", "refreshTokenHash", "deviceId", "userAgent", "expiresAt")
     SELECT "userId", $2, "deviceId", "userAgent", $3 FROM sessions WHERE id = $1 RETURNING id`,
    [s.id, sha256(nextToken), refreshExpiry()],
  );
  await db.query(`UPDATE sessions SET "revokedAt" = now(), "replacedBy" = $2 WHERE id = $1`, [s.id, next!.id]);
  return {
    userId: s.userId,
    accessToken: await signAccessToken({ userId: s.userId, sessionId: next!.id }),
    refreshToken: nextToken,
    expiresIn: 15 * 60,
  };
}

export const revokeSession = (db: Db, sessionId: string) =>
  db.query(`UPDATE sessions SET "revokedAt" = now() WHERE id = $1 AND "revokedAt" IS NULL`, [sessionId]);

export const revokeAllSessions = (db: Db, userId: string) =>
  db.query(`UPDATE sessions SET "revokedAt" = now() WHERE "userId" = $1 AND "revokedAt" IS NULL`, [userId]);

// --- Google ---

const google = new OAuth2Client();

export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** Verifies a Google ID token issued to Commissaire's own OAuth client(s). */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (env.GOOGLE_CLIENT_IDS.length === 0) throw new ApiError(503, "google_not_configured", "Google sign-in is not configured");
  try {
    const ticket = await google.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_IDS });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error("payload");
    return { subject: p.sub, email: p.email.toLowerCase(), emailVerified: p.email_verified ?? false, name: p.name ?? null };
  } catch {
    throw new ApiError(401, "invalid_google_token", "Google sign-in failed");
  }
}
