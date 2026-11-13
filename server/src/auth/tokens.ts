import { createHmac, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { jwtVerify, SignJWT } from "jose";
import { env } from "../config/env.js";
import type { Db } from "../db/pool.js";
import { ApiError, logger, randomToken, sha256 } from "../lib/core.js";
import { trialEnded } from "../races/access.js";

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

/** `expiresAt`: an earlier end than the usual refresh lifetime (a trial user's session ends with its trial, 014). */
export async function createSession(db: Db, userId: string, deviceId: string | null, userAgent: string | null, expiresAt?: Date): Promise<SessionTokens> {
  const refreshToken = randomToken();
  const end = expiresAt && expiresAt < refreshExpiry() ? expiresAt : refreshExpiry();
  const s = await db.one<{ id: string }>(
    `INSERT INTO sessions ("userId", "refreshTokenHash", "deviceId", "userAgent", "expiresAt")
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, sha256(refreshToken), deviceId, userAgent, end],
  );
  return { accessToken: await signAccessToken({ userId, sessionId: s!.id }), refreshToken, expiresIn: 15 * 60 };
}

export class RefreshReuseError extends ApiError {
  constructor(readonly userId: string, readonly replayAttempted = false) {
    super(401, "unauthorized", "Sign in again");
  }
}

/**
 * Lost refresh answers (BUG: Nov 13 2026 sign-outs). A device sends its refresh token
 * with a random `requestId` it saved BEFORE sending. The replacement token is then
 * derived from both (HMAC with a server-only key), not random. If the answer is lost
 * and the device retries with the SAME token and SAME requestId, the server can prove
 * the retry is the request it already served and hands back that same replacement —
 * but only while the replacement has never been used (not rotated, not revoked, not
 * expired) and within REFRESH_REPLAY_MS of the rotation. Anything else (no requestId,
 * another requestId, a replacement already used, too late) is reuse: every session
 * of the user is revoked, as before.
 */
export const REFRESH_REPLAY_MS = 12 * 60 * 60_000;
const rotationKey = createHmac("sha256", env.JWT_ACCESS_SECRET).update("commissaire.refresh-rotation.v1").digest();
const REQUEST_ID = /^[A-Za-z0-9_-]{22,128}$/;
/** A valid requestId (≥ 128 bits base64url) or null: a short or odd value never derives a token. */
export const refreshRequestId = (v: unknown): string | null => (typeof v === "string" && REQUEST_ID.test(v) ? v : null);
const rotatedToken = (refreshToken: string, requestId: string) =>
  createHmac("sha256", rotationKey).update(refreshToken).update("\0").update(requestId).digest("base64url");

type SessionRow = {
  id: string; userId: string; revokedAt: Date | null; expiresAt: Date; replacedBy: string | null; isActive: boolean;
  trialExpiresAt: Date | null; trialRevokedAt: Date | null;
};

/**
 * Rotates a refresh token. Re-using an already-rotated token revokes the whole chain,
 * except the exact replay of a lost answer described above.
 */
export async function refreshSession(db: Db, refreshToken: string, rawRequestId?: unknown): Promise<SessionTokens & { userId: string; replayed: boolean }> {
  const requestId = refreshRequestId(rawRequestId);
  // FOR UPDATE: two refreshes of one token (two tabs, a retry racing its original) are
  // serialized, so the second always sees the first one's rotation.
  const s = await db.one<SessionRow>(
    `SELECT s.id, s."userId", s."revokedAt", s."expiresAt", s."replacedBy", u."isActive",
            t."expiresAt" AS "trialExpiresAt", t."revokedAt" AS "trialRevokedAt"
     FROM sessions s JOIN users u ON u.id = s."userId" LEFT JOIN temporary_users t ON t."userId" = u.id
     WHERE s."refreshTokenHash" = $1
     FOR UPDATE OF s`,
    [sha256(refreshToken)],
  );
  if (!s) throw new ApiError(401, "unauthorized", "Sign in again");
  // A trial user's session never outlives its trial (014), whatever the refresh lifetime.
  if (s.trialExpiresAt && trialEnded({ expiresAt: s.trialExpiresAt, revokedAt: s.trialRevokedAt })) {
    throw new ApiError(403, "trial_ended", "Your trial access to this race has ended");
  }
  if (s.revokedAt || s.replacedBy) {
    const replay = requestId && s.replacedBy && s.revokedAt && Date.now() - s.revokedAt.getTime() <= REFRESH_REPLAY_MS && s.isActive
      ? await replayRotation(db, s, refreshToken, requestId)
      : null;
    if (replay) return replay;
    // Token reuse: someone holds an old token. The caller revokes every session of
    // this user OUTSIDE this transaction, so the revocation is not rolled back.
    throw new RefreshReuseError(s.userId, !!requestId);
  }
  if (s.expiresAt < new Date() || !s.isActive) throw new ApiError(401, "unauthorized", "Sign in again");
  const nextExpiry = s.trialExpiresAt && s.trialExpiresAt < refreshExpiry() ? s.trialExpiresAt : refreshExpiry();
  const nextToken = requestId ? rotatedToken(refreshToken, requestId) : randomToken();
  const next = await db.one<{ id: string }>(
    `INSERT INTO sessions ("userId", "refreshTokenHash", "deviceId", "userAgent", "expiresAt")
     SELECT "userId", $2, "deviceId", "userAgent", $3 FROM sessions WHERE id = $1 RETURNING id`,
    [s.id, sha256(nextToken), nextExpiry],
  );
  await db.query(`UPDATE sessions SET "revokedAt" = now(), "replacedBy" = $2 WHERE id = $1`, [s.id, next!.id]);
  return {
    userId: s.userId,
    accessToken: await signAccessToken({ userId: s.userId, sessionId: next!.id }),
    refreshToken: nextToken,
    expiresIn: 15 * 60,
    replayed: false,
  };
}

/** The same answer again, only if the replacement this exact request created is still untouched. */
async function replayRotation(db: Db, s: SessionRow, refreshToken: string, requestId: string) {
  const token = rotatedToken(refreshToken, requestId);
  const r = await db.one<{ id: string }>(
    `SELECT id FROM sessions
     WHERE id = $1 AND "refreshTokenHash" = $2 AND "revokedAt" IS NULL AND "replacedBy" IS NULL AND "expiresAt" > now()
     FOR UPDATE`,
    [s.replacedBy, sha256(token)],
  );
  if (!r) return null;
  logger.info({ userId: s.userId }, "refresh answer replayed after a lost response");
  return {
    userId: s.userId,
    accessToken: await signAccessToken({ userId: s.userId, sessionId: r.id }),
    refreshToken: token,
    expiresIn: 15 * 60,
    replayed: true,
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
