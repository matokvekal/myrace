/**
 * Sign-in and Forgot Password against the real API + test database.
 * Regressions: codes only for registered emails, 3 per day, 60 s between
 * resends, a reset sets the password and signs other devices out.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/db/pool";
import * as messaging from "../../src/lib/messaging";
import { api, auth, newUser, startServer, stopServer } from "./helpers";

beforeAll(startServer);
afterAll(stopServer);

const codeFromMail = () => /code is (\d{6})/.exec(messaging.lastMail?.text ?? "")?.[1];

describe("password sign-in", () => {
  it("register → login with the same password works; email case/spaces don't matter; wrong password is refused", async () => {
    const u = await newUser("Login");
    expect((await api().post("/api/v1/auth/login").send({ email: ` ${u.email.toUpperCase()} `, password: "password-123" })).status).toBe(200);
    const bad = await api().post("/api/v1/auth/login").send({ email: u.email, password: "password-124" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("invalid_credentials");
  });

  it("logout revokes the session; a cleared device can sign in again", async () => {
    const u = await newUser("Logout");
    expect((await api().post("/api/v1/auth/logout").set(auth(u.token))).status).toBe(204);
    expect((await api().get("/api/v1/me").set(auth(u.token))).status).toBe(401);
    expect((await api().post("/api/v1/auth/login").send({ email: u.email, password: "password-123" })).status).toBe(200);
  });
});

describe("forgot password", () => {
  it("an unregistered email gets no code (and no mail)", async () => {
    const r = await api().post("/api/v1/auth/password-reset").send({ email: `nobody.${Date.now()}@x.test` });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("no_account");
  });

  it("code → new password: signed in, old password refused, new one works, other sessions signed out", async () => {
    const u = await newUser("Reset");
    const sent = await api().post("/api/v1/auth/password-reset").send({ email: u.email });
    expect(sent.status).toBe(202);
    expect(sent.body).toMatchObject({ sent: true, remainingToday: 2, resendAfterSeconds: 60 });
    const code = codeFromMail();
    expect(code).toMatch(/^\d{6}$/);
    const wrong = await api().post("/api/v1/auth/password-reset/confirm").send({ email: u.email, code: code === "000000" ? "111111" : "000000", password: "new-password-1" });
    expect(wrong.status).toBe(400);
    const ok = await api().post("/api/v1/auth/password-reset/confirm").send({ email: u.email, code, password: "new-password-1" });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect((await api().get("/api/v1/me").set(auth(u.token))).status).toBe(401); // the old device is signed out
    expect((await api().post("/api/v1/auth/login").send({ email: u.email, password: "password-123" })).status).toBe(401);
    expect((await api().post("/api/v1/auth/login").send({ email: u.email, password: "new-password-1" })).status).toBe(200);
    // a used code can't be used again
    expect((await api().post("/api/v1/auth/password-reset/confirm").send({ email: u.email, code, password: "another-pass-1" })).status).toBe(400);
  });

  it("a second code within 60 s is refused (too_soon)", async () => {
    const u = await newUser("Soon");
    expect((await api().post("/api/v1/auth/password-reset").send({ email: u.email })).status).toBe(202);
    const again = await api().post("/api/v1/auth/password-reset").send({ email: u.email });
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe("too_soon");
  });

  it("at most 3 codes per address per 24 h (daily_limit); older codes don't count", async () => {
    const u = await newUser("Daily");
    const insert = (agoMs: number) =>
      db.query(`INSERT INTO otp_codes (channel, destination, "codeHash", "createdAt", "expiresAt") VALUES ('email', $1, 'x', $2, $2)`, [u.email, new Date(Date.now() - agoMs)]);
    await insert(25 * 3600_000); // yesterday: not counted
    await insert(3 * 3600_000);
    await insert(2 * 3600_000);
    const third = await api().post("/api/v1/auth/password-reset").send({ email: u.email });
    expect(third.status).toBe(202);
    expect(third.body.remainingToday).toBe(0);
    await db.query(`UPDATE otp_codes SET "createdAt" = now() - interval '5 minutes' WHERE destination = $1 AND "codeHash" <> 'x'`, [u.email]);
    const fourth = await api().post("/api/v1/auth/password-reset").send({ email: u.email });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe("daily_limit");
  });
});
