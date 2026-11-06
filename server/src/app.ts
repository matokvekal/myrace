import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { accountInvitationsRouter, myAccountInvitationsRouter } from "./accounts/invitations.js";
import { accountsRouter, organizationsRouter } from "./accounts/routes.js";
import { authRouter, meRouter } from "./auth/auth.js";
import { env } from "./config/env.js";
import { db } from "./db/pool.js";
import { directoryRouter } from "./directory/routes.js";
import { ApiError, logger } from "./lib/core.js";
import { invitationsRouter, membersRouter, myInvitationsRouter } from "./members/routes.js";
import { preferencesRouter } from "./preferences/routes.js";
import { publicRouter } from "./public/routes.js";
import { racesRouter } from "./races/routes.js";
import { resultsRouter } from "./results/routes.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : true, credentials: true }));
  app.use(express.json({ limit: "10mb" })); // a published start list with course maps
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV !== "test" }));
  // Account data must never be cached (browser, service worker, proxy): an answer
  // for one account's token must not be replayed to another on the same device.
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.vary("Authorization");
    next();
  });

  app.get("/api/v1/health", async (_req, res) => {
    await db.one("SELECT 1");
    // release: the deployed commit (PM2 sets it from the release's REVISION); deployments check it.
    res.json({ ok: true, time: Date.now(), release: process.env.COMMISSAIRE_RELEASE ?? "dev" });
  });
  // Clock alignment over HTTP (AD-9); the socket has a "time" event too.
  app.get("/api/v1/time", (_req, res) => res.json({ now: Date.now() }));

  app.use("/api/v1/auth", authRouter);
  // Guests: read-only, one race per share link, no account (public/routes.ts).
  app.use("/api/v1/public", publicRouter);
  app.use("/api/v1/me/invitations", myInvitationsRouter);
  app.use("/api/v1/me/account-invitations", myAccountInvitationsRouter);
  app.use("/api/v1/me", directoryRouter);
  app.use("/api/v1/me", preferencesRouter);
  app.use("/api/v1/me", meRouter);
  app.use("/api/v1/invitations", invitationsRouter);
  // Accounts & organizations (0.2 Phase 2). Org membership grants no race access.
  app.use("/api/v1/accounts", accountsRouter);
  app.use("/api/v1/organizations", organizationsRouter);
  app.use("/api/v1/account-invitations", accountInvitationsRouter);
  app.use("/api/v1/races/:raceUuid", membersRouter);
  app.use("/api/v1/races/:raceUuid", resultsRouter);
  app.use("/api/v1/races", racesRouter);

  app.use((_req, res) => res.status(404).json({ error: { code: "not_found", message: "Not found" } }));

  // Error shape: { error: { code, message } } (Architecture conventions).
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: { code: "invalid", message: err.issues[0]?.message ?? "Invalid request", details: err.issues.slice(0, 5) } });
    }
    if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    const status = (err as { status?: number })?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return res.status(status).json({ error: { code: "invalid", message: (err as Error).message } });
    }
    logger.error({ err, path: req.path }, "unhandled error");
    res.status(500).json({ error: { code: "internal", message: "Something went wrong" } });
  });
  return app;
}
