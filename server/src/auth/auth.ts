/**
 * Accounts and sign-in: password, Google, email code, and SMS code (off unless
 * SMS_ENABLED). Users are keyed by users.id; identities are (provider, subject).
 *
 * Account linking: an identity joins an existing account only when the email is
 * verified on both sides, or explicitly while signed in. A verified Google
 * sign-in to an email whose password account was never verified takes the
 * account over and drops that unverified password (it may have been registered
 * by someone else).
 */
import { type NextFunction, type Request, type Response, Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, type Db, tx } from "../db/pool.js";
import { trialEnded } from "../races/access.js";
import {
  ApiError,
  badRequest,
  hashPassword,
  logger,
  normalizeEmail,
  randomDigits,
  route,
  sha256,
  verifyPassword,
} from "../lib/core.js";
import { mailDeliverable, sendMail, sendSms, smsEnabled } from "../lib/messaging.js";
import {
  createSession,
  RefreshReuseError,
  refreshSession,
  revokeAllSessions,
  revokeSession,
  verifyAccessToken,
  verifyGoogleIdToken,
} from "./tokens.js";

export interface AuthedRequest extends Request {
  userId: string;
  sessionId: string;
}

/** Requires a valid access token (Authorization: Bearer …). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) throw new ApiError(401, "unauthorized", "Sign in first");
    const claims = await verifyAccessToken(header.slice(7));
    const ok = await db.one<{ trialRace: string | null; trialExpiresAt: Date | null; trialRevokedAt: Date | null }>(
      `SELECT t."raceUuid" AS "trialRace", t."expiresAt" AS "trialExpiresAt", t."revokedAt" AS "trialRevokedAt"
       FROM sessions s JOIN users u ON u.id = s."userId" LEFT JOIN temporary_users t ON t."userId" = u.id
       WHERE s.id = $1 AND s."userId" = $2 AND s."revokedAt" IS NULL AND u."isActive"`,
      [claims.sessionId, claims.userId],
    );
    if (!ok) throw new ApiError(401, "unauthorized", "Sign in again");
    if (ok.trialRace) {
      // Quick Trial Access (014): a temporary user works in its one race, until the trial ends.
      if (trialEnded({ expiresAt: ok.trialExpiresAt!, revokedAt: ok.trialRevokedAt })) throw trialEndedError();
      if (!trialRequestAllowed(req)) throw new ApiError(403, "trial_not_allowed", "Not available in trial access. Register for a full account.");
    }
    (req as AuthedRequest).userId = claims.userId;
    (req as AuthedRequest).sessionId = claims.sessionId;
    next();
  } catch (err) {
    next(err);
  }
}

export const authed = (req: Request) => req as AuthedRequest;

/** A temporary user's trial is over (403, not 401: refreshing the token can't help). */
export const trialEndedError = () => new ApiError(403, "trial_ended", "Your trial access to this race has ended");

/**
 * What a temporary user (014) may call. Reads are allowed (each race route still checks
 * membership, so only the trial race answers); writes only to race data through the
 * existing paths, never account-level ones: no races, invitations, trial links, profile,
 * identities, contacts or organizations — a trial user never becomes a permanent account.
 */
const TRIAL_ACCOUNT_PATHS = /^\/api\/v1\/(accounts|organizations|account-invitations|me\/account-invitations|me\/contacts|me\/groups|me\/users)(\/|$)/i;
const TRIAL_WRITES: RegExp[] = [
  /^\/api\/v1\/auth\/logout(-all)?$/,
  /^\/api\/v1\/me\/preferences\/[^/]+$/,
  /^\/api\/v1\/races\/[0-9a-f-]{36}\/(actions|sync)$/i,
  // Podium approval: the existing role rule (canApproveCategory) decides, as for any judge.
  /^\/api\/v1\/races\/[0-9a-f-]{36}\/categories\/[0-9a-f-]{36}\/approval$/i,
];
export function trialRequestAllowed(req: Request): boolean {
  const path = req.originalUrl.split("?")[0];
  if (TRIAL_ACCOUNT_PATHS.test(path)) return false;
  if (req.method === "GET" || req.method === "HEAD") return true;
  return TRIAL_WRITES.some((re) => re.test(path));
}

export interface PublicUser {
  id: string;
  email: string | null;
  name: string;
  createdAt: string;
  identities: { provider: string; email: string | null; emailVerified: boolean }[];
  /** Quick Trial Access (014): set only for a temporary user — its one race and when the trial ends. */
  trial?: { raceUuid: string; expiresAt: string };
}

export async function loadUser(d: Db, userId: string): Promise<PublicUser> {
  const u = await d.one<{ id: string; email: string | null; name: string; createdAt: Date }>(
    `SELECT id, email, name, "createdAt" FROM users WHERE id = $1`,
    [userId],
  );
  if (!u) throw new ApiError(404, "not_found", "No such user");
  const identities = await d.query<{ provider: string; email: string | null; emailVerified: boolean }>(
    `SELECT provider, email, "emailVerified" FROM user_identities WHERE "userId" = $1 ORDER BY "createdAt"`,
    [userId],
  );
  const trial = await d.one<{ raceUuid: string; expiresAt: Date }>(`SELECT "raceUuid", "expiresAt" FROM temporary_users WHERE "userId" = $1`, [userId]);
  return { ...u, createdAt: u.createdAt.toISOString(), identities, ...(trial ? { trial: { raceUuid: trial.raceUuid, expiresAt: trial.expiresAt.toISOString() } } : {}) };
}

const ctx = (req: Request) => ({
  deviceId: typeof req.body?.deviceId === "string" ? req.body.deviceId.slice(0, 100) : null,
  userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null,
});

async function signedIn(d: Db, req: Request, userId: string) {
  const tokens = await createSession(d, userId, ctx(req).deviceId, ctx(req).userAgent);
  return { ...tokens, user: await loadUser(d, userId) };
}

/** Has this user proven ownership of their email anywhere? */
const hasVerifiedEmail = async (d: Db, userId: string) =>
  !!(await d.one(`SELECT 1 FROM user_identities WHERE "userId" = $1 AND "emailVerified"`, [userId]));

/**
 * Finds or creates the account for a verified email identity (Google, email code)
 * and attaches the identity. Returns the user id.
 */
async function upsertVerifiedIdentity(d: Db, provider: "google" | "email_otp", subject: string, email: string, name: string | null): Promise<string> {
  const existing = await d.one<{ userId: string }>(
    `SELECT "userId" FROM user_identities WHERE provider = $1 AND subject = $2`,
    [provider, subject],
  );
  if (existing) {
    await d.query(`UPDATE user_identities SET "lastUsedAt" = now(), email = $3, "emailVerified" = true WHERE provider = $1 AND subject = $2`, [provider, subject, email]);
    return existing.userId;
  }
  let user = await d.one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  if (user && !(await hasVerifiedEmail(d, user.id))) {
    // Nobody ever proved this email on the existing account: drop its unverified password.
    await d.query(`DELETE FROM user_identities WHERE "userId" = $1 AND provider = 'password'`, [user.id]);
    await revokeAllSessions(d, user.id);
    logger.warn({ userId: user.id, provider }, "unverified password identity replaced by a verified sign-in");
  }
  if (!user) {
    user = await d.one<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [email, name ?? email.split("@")[0]]);
  }
  await d.query(
    `INSERT INTO user_identities ("userId", provider, subject, email, "emailVerified", "lastUsedAt") VALUES ($1, $2, $3, $4, true, now())`,
    [user!.id, provider, subject, email],
  );
  if (provider === "email_otp") {
    // The same address on a password identity is now proven too.
    await d.query(`UPDATE user_identities SET "emailVerified" = true WHERE "userId" = $1 AND provider = 'password' AND email = $2`, [user!.id, email]);
  }
  return user!.id;
}

// --- one-time codes (email now, SMS when enabled) ---

const CODE_TTL_MS = 10 * 60_000;

async function issueCode(channel: "email" | "sms", destination: string): Promise<string> {
  const code = randomDigits(6);
  await db.query(
    `INSERT INTO otp_codes (channel, destination, "codeHash", "expiresAt") VALUES ($1, $2, $3, $4)`,
    [channel, destination, sha256(`${destination}:${code}`), new Date(Date.now() + CODE_TTL_MS)],
  );
  return code;
}

/** Emailed codes per address per 24 h, and the wait between two of them. */
export const EMAIL_CODES_PER_DAY = Number(process.env.EMAIL_CODES_PER_DAY ?? 3);
export const EMAIL_RESEND_SECONDS = Number(process.env.EMAIL_RESEND_SECONDS ?? 60);

/**
 * Emails a 6-digit code to a REGISTERED address only, at most EMAIL_CODES_PER_DAY a
 * day and one per EMAIL_RESEND_SECONDS. A failed send is not counted.
 */
async function sendEmailCode(address: string, subject: string, intro: string) {
  if (!mailDeliverable()) {
    throw new ApiError(503, "email_unavailable", "Email can't be sent from the server right now. Please contact support.");
  }
  const user = await db.one(`SELECT 1 FROM users WHERE email = $1 AND "isActive"`, [address]);
  if (!user) throw new ApiError(404, "no_account", "No account uses this email. Check the spelling, or create a new account.");
  const recent = await db.query<{ createdAt: Date }>(
    `SELECT "createdAt" FROM otp_codes WHERE channel = 'email' AND destination = $1 AND "createdAt" > now() - interval '24 hours'
     ORDER BY "createdAt" DESC`,
    [address],
  );
  if (recent.length >= EMAIL_CODES_PER_DAY) {
    const oldest = recent[recent.length - 1]!.createdAt.getTime();
    const hours = Math.max(1, Math.ceil((oldest + 24 * 3600_000 - Date.now()) / 3600_000));
    throw new ApiError(429, "daily_limit", `You've used all ${EMAIL_CODES_PER_DAY} codes for today. Try again in about ${hours} h.`);
  }
  const waited = recent[0] ? (Date.now() - recent[0].createdAt.getTime()) / 1000 : Infinity;
  if (waited < EMAIL_RESEND_SECONDS) {
    throw new ApiError(429, "too_soon", `Wait ${Math.ceil(EMAIL_RESEND_SECONDS - waited)} seconds before asking for another code.`);
  }
  const code = await issueCode("email", address);
  try {
    await sendMail(address, subject, `${intro}\n\nYour code is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for it, ignore this email.`);
  } catch (err) {
    await db.query(`DELETE FROM otp_codes WHERE channel = 'email' AND destination = $1 AND "codeHash" = $2`, [address, sha256(`${address}:${code}`)]);
    logger.error({ err }, "email code could not be sent");
    throw new ApiError(503, "email_failed", "We couldn't send the email. Try again in a few minutes.");
  }
  return { sent: true, remainingToday: EMAIL_CODES_PER_DAY - recent.length - 1, resendAfterSeconds: EMAIL_RESEND_SECONDS };
}

async function consumeCode(d: Db, channel: "email" | "sms", destination: string, code: string): Promise<void> {
  const row = await d.one<{ id: string; codeHash: string; attempts: number }>(
    `SELECT id, "codeHash", attempts FROM otp_codes
     WHERE channel = $1 AND destination = $2 AND "consumedAt" IS NULL AND "expiresAt" > now()
     ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`,
    [channel, destination],
  );
  if (!row || row.attempts >= 5) throw new ApiError(400, "invalid_code", "The code is wrong or expired");
  if (row.codeHash !== sha256(`${destination}:${code}`)) {
    await d.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    throw new ApiError(400, "invalid_code", "The code is wrong or expired");
  }
  await d.query(`UPDATE otp_codes SET "consumedAt" = now() WHERE id = $1`, [row.id]);
}

// --- routes ---

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, "Use at least 8 characters").max(200);
const phone = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Phone in international format, e.g. +972501234567");

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.AUTH_RATE_LIMIT ?? 20), standardHeaders: true, legacyHeaders: false });
authRouter.use(["/register", "/login", "/google", "/email-code", "/sms-code", "/password-reset"], limiter);

authRouter.post("/register", route(async (req, res) => {
  const body = z.object({ email, password, name: z.string().trim().min(1).max(100) }).parse(req.body);
  const out = await tx(async (d) => {
    if (await d.one(`SELECT 1 FROM users WHERE email = $1`, [body.email])) {
      throw new ApiError(409, "email_taken", "An account with this email already exists — sign in instead");
    }
    const u = await d.one<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [body.email, body.name]);
    await d.query(
      `INSERT INTO user_identities ("userId", provider, subject, email, "passwordHash") VALUES ($1, 'password', $2, $2, $3)`,
      [u!.id, body.email, await hashPassword(body.password)],
    );
    return signedIn(d, req, u!.id);
  });
  res.status(201).json(out);
}));

authRouter.post("/login", route(async (req, res) => {
  const body = z.object({ email, password: z.string().min(1).max(200) }).parse(req.body);
  const id = await db.one<{ userId: string; passwordHash: string }>(
    `SELECT i."userId", i."passwordHash" FROM user_identities i JOIN users u ON u.id = i."userId"
     WHERE i.provider = 'password' AND i.subject = $1 AND u."isActive"`,
    [body.email],
  );
  // Same answer for unknown email and wrong password.
  if (!id || !(await verifyPassword(body.password, id.passwordHash))) throw new ApiError(401, "invalid_credentials", "Wrong email or password");
  await db.query(`UPDATE user_identities SET "lastUsedAt" = now() WHERE provider = 'password' AND subject = $1`, [body.email]);
  res.json(await signedIn(db, req, id.userId));
}));

authRouter.post("/google", route(async (req, res) => {
  const { idToken } = z.object({ idToken: z.string().min(10) }).parse(req.body);
  const g = await verifyGoogleIdToken(idToken);
  if (!g.emailVerified) throw new ApiError(401, "email_not_verified", "Your Google email is not verified");
  res.json(await tx(async (d) => signedIn(d, req, await upsertVerifiedIdentity(d, "google", g.subject, g.email, g.name))));
}));

authRouter.post("/email-code", route(async (req, res) => {
  const body = z.object({ email }).parse(req.body);
  res.status(202).json(await sendEmailCode(body.email, "Your Commissaire sign-in code", "Here is your code to sign in to Commissaire."));
}));

/** Forgot password, step 1: email a code to a registered address. */
authRouter.post("/password-reset", route(async (req, res) => {
  const body = z.object({ email }).parse(req.body);
  res.status(202).json(await sendEmailCode(body.email, "Reset your Commissaire password", "Someone (hopefully you) asked to reset your Commissaire password."));
}));

/**
 * Forgot password, step 2: the code proves the email, so set the new password,
 * mark the email verified, sign out every other device and sign in here.
 */
authRouter.post("/password-reset/confirm", route(async (req, res) => {
  const body = z.object({ email, code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email"), password }).parse(req.body);
  res.json(await tx(async (d) => {
    await consumeCode(d, "email", body.email, body.code);
    const user = await d.one<{ id: string }>(`SELECT id FROM users WHERE email = $1 AND "isActive"`, [body.email]);
    if (!user) throw new ApiError(400, "invalid_code", "The code is wrong or expired");
    const set = await d.query(
      `INSERT INTO user_identities ("userId", provider, subject, email, "emailVerified", "passwordHash", "lastUsedAt")
       VALUES ($1, 'password', $2, $2, true, $3, now())
       ON CONFLICT (provider, subject) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "emailVerified" = true, "lastUsedAt" = now()
       WHERE user_identities."userId" = EXCLUDED."userId"
       RETURNING 1`,
      [user.id, body.email, await hashPassword(body.password)],
    );
    if (!set.length) throw new ApiError(409, "identity_taken", "This email's password belongs to another account");
    await d.query(`UPDATE user_identities SET "emailVerified" = true WHERE "userId" = $1 AND email = $2`, [user.id, body.email]);
    await revokeAllSessions(d, user.id);
    return signedIn(d, req, user.id);
  }));
}));

authRouter.post("/email-code/verify", route(async (req, res) => {
  const body = z.object({ email, code: z.string().trim().regex(/^\d{6}$/), name: z.string().trim().max(100).optional() }).parse(req.body);
  res.json(await tx(async (d) => {
    await consumeCode(d, "email", body.email, body.code);
    return signedIn(d, req, await upsertVerifiedIdentity(d, "email_otp", body.email, body.email, body.name ?? null));
  }));
}));

authRouter.get("/sms-code/enabled", (_req, res) => res.json({ enabled: smsEnabled() }));

authRouter.post("/sms-code", route(async (req, res) => {
  if (!smsEnabled()) throw new ApiError(404, "sms_disabled", "SMS sign-in is not enabled");
  const body = z.object({ phone }).parse(req.body);
  const code = await issueCode("sms", body.phone);
  await sendSms(body.phone, `Commissaire code: ${code}`);
  res.status(202).json({ sent: true });
}));

authRouter.post("/sms-code/verify", route(async (req, res) => {
  if (!smsEnabled()) throw new ApiError(404, "sms_disabled", "SMS sign-in is not enabled");
  const body = z.object({ phone, code: z.string().trim().regex(/^\d{6}$/), name: z.string().trim().max(100).optional() }).parse(req.body);
  res.json(await tx(async (d) => {
    await consumeCode(d, "sms", body.phone, body.code);
    let ident = await d.one<{ userId: string }>(`SELECT "userId" FROM user_identities WHERE provider = 'sms' AND subject = $1`, [body.phone]);
    if (!ident) {
      const u = await d.one<{ id: string }>(`INSERT INTO users (email, name) VALUES (NULL, $1) RETURNING id`, [body.name ?? "Commissaire"]);
      await d.query(`INSERT INTO user_identities ("userId", provider, subject) VALUES ($1, 'sms', $2)`, [u!.id, body.phone]);
      ident = { userId: u!.id };
    }
    return signedIn(d, req, ident.userId);
  }));
}));

authRouter.post("/refresh", route(async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
  let out;
  try {
    out = await tx((d) => refreshSession(d, refreshToken));
  } catch (err) {
    if (err instanceof RefreshReuseError) {
      await revokeAllSessions(db, err.userId);
      logger.warn({ userId: err.userId }, "refresh token reuse — all sessions revoked");
    }
    throw err;
  }
  res.json({ accessToken: out.accessToken, refreshToken: out.refreshToken, expiresIn: out.expiresIn });
}));

authRouter.post("/logout", requireAuth, route(async (req, res) => {
  await revokeSession(db, authed(req).sessionId);
  res.status(204).end();
}));

authRouter.post("/logout-all", requireAuth, route(async (req, res) => {
  await revokeAllSessions(db, authed(req).userId);
  res.status(204).end();
}));

// --- current user and linking ---

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get("/", route(async (req, res) => res.json(await loadUser(db, authed(req).userId))));

meRouter.patch("/", route(async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
  await db.query(`UPDATE users SET name = $2, "updatedAt" = now() WHERE id = $1`, [authed(req).userId, body.name]);
  res.json(await loadUser(db, authed(req).userId));
}));

/** Link a Google account to the signed-in user. */
meRouter.post("/identities/google", route(async (req, res) => {
  const { idToken } = z.object({ idToken: z.string().min(10) }).parse(req.body);
  const g = await verifyGoogleIdToken(idToken);
  if (!g.emailVerified) throw new ApiError(400, "email_not_verified", "Your Google email is not verified");
  await tx(async (d) => {
    const taken = await d.one<{ userId: string }>(`SELECT "userId" FROM user_identities WHERE provider = 'google' AND subject = $1`, [g.subject]);
    if (taken && taken.userId !== authed(req).userId) throw new ApiError(409, "identity_taken", "This Google account belongs to another user");
    if (!taken) {
      await d.query(
        `INSERT INTO user_identities ("userId", provider, subject, email, "emailVerified") VALUES ($1, 'google', $2, $3, true)`,
        [authed(req).userId, g.subject, g.email],
      );
    }
  });
  res.json(await loadUser(db, authed(req).userId));
}));

/** Add (or change) a password for the signed-in user's email. */
meRouter.put("/identities/password", route(async (req, res) => {
  const body = z.object({ password }).parse(req.body);
  const me = await loadUser(db, authed(req).userId);
  if (!me.email) throw badRequest("Add an email to your account first");
  const verified = me.identities.some((i) => i.emailVerified && i.email === me.email);
  await db.query(
    `INSERT INTO user_identities ("userId", provider, subject, email, "emailVerified", "passwordHash")
     VALUES ($1, 'password', $2, $2, $3, $4)
     ON CONFLICT (provider, subject) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash"
     WHERE user_identities."userId" = EXCLUDED."userId"`,
    [me.id, me.email, verified, await hashPassword(body.password)],
  );
  res.json(await loadUser(db, me.id));
}));
