import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { authRouter, meRouter } from "./auth/auth.js";
import { env } from "./config/env.js";
import { db } from "./db/pool.js";
import { directoryRouter } from "./directory/routes.js";
import { ApiError, logger } from "./lib/core.js";
import { invitationsRouter, membersRouter, myInvitationsRouter } from "./members/routes.js";
import { preferencesRouter } from "./preferences/routes.js";
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

  app.get("/api/v1/health", async (_req, res) => {
    await db.one("SELECT 1");
    // release: the deployed commit (PM2 sets it from the release's REVISION); deployments check it.
    res.json({ ok: true, time: Date.now(), release: process.env.COMMISSAIRE_RELEASE ?? "dev" });
  });
  // Clock alignment over HTTP (AD-9); the socket has a "time" event too.
  app.get("/api/v1/time", (_req, res) => res.json({ now: Date.now() }));

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/me/invitations", myInvitationsRouter);
  app.use("/api/v1/me", directoryRouter);
  app.use("/api/v1/me", preferencesRouter);
  app.use("/api/v1/me", meRouter);
  app.use("/api/v1/invitations", invitationsRouter);
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
