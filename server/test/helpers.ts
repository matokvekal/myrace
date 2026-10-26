/**
 * Test helpers: a live server (HTTP + Socket.IO) on a random port, users,
 * Actions and socket clients. Riders are synthetic.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket } from "socket.io-client";
import request from "supertest";
import { createApp } from "../src/app";
import { attachRealtime } from "../src/realtime/socket";

let http: Server | null = null;
export let baseUrl = "";

export async function startServer() {
  if (http) return;
  http = createServer(createApp());
  attachRealtime(http);
  await new Promise<void>((r) => http!.listen(0, "127.0.0.1", () => r()));
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

/** Each test file ends its server and its database connection (PGlite serves one at a time). */
export async function stopServer() {
  const { closeRealtime } = await import("../src/realtime/socket");
  const { closePool } = await import("../src/db/pool");
  await closeRealtime();
  await new Promise<void>((r) => (http ? http.close(() => r()) : r()));
  http = null;
  await closePool();
}

export const api = () => request(baseUrl);
export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let n = 0;
export interface TestUser {
  id: string;
  email: string;
  token: string;
  refreshToken: string;
}

export async function newUser(name = "User"): Promise<TestUser> {
  n += 1;
  const email = `${name.toLowerCase()}.${Date.now()}.${n}@x.test`;
  const r = await api().post("/api/v1/auth/register").send({ email, password: "password-123", name });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { id: r.body.user.id, email, token: r.body.accessToken, refreshToken: r.body.refreshToken };
}

export interface RaceFixture {
  raceUuid: string;
  cats: { uuid: string; name: string; heat: number; laps: number }[];
  riders: { uuid: string; bibNumber: number; category: string; heat: number }[];
}

/** Publishes a race with `waves` waves, one category each, `perWave` riders each. */
export async function publishRace(owner: TestUser, waves = 3, perWave = 3, laps = 3): Promise<RaceFixture> {
  const cats = Array.from({ length: waves }, (_, i) => ({ uuid: randomUUID(), name: `Wave${i + 1} Elite`, heat: i + 1, laps, startTime: "10:00" }));
  const riders = cats.flatMap((c, w) =>
    Array.from({ length: perWave }, (_, j) => ({
      uuid: randomUUID(), firstName: "Test", lastName: `W${w + 1}R${j + 1}`, bibNumber: (w + 1) * 100 + j + 1, category: c.name, heat: c.heat,
      comment: `private note ${w}${j}`, chipNumber: `chip-${w}${j}`,
    })),
  );
  const r = await api().post("/api/v1/races/publish").set(auth(owner.token)).send({ race: { name: "Test Race", date: "2026-10-27", phone: "050-0000000" }, categories: cats, riders });
  if (r.status !== 201) throw new Error(`publish failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { raceUuid: r.body.race.uuid, cats, riders: riders.map((x) => ({ uuid: x.uuid, bibNumber: x.bibNumber, category: x.category, heat: x.heat })) };
}

/** Invites by open link and accepts as `user`. */
export async function addMember(owner: TestUser, raceUuid: string, user: TestUser, roles: string[], permissions: Record<string, unknown> = {}) {
  const inv = await api().post(`/api/v1/races/${raceUuid}/invitations`).set(auth(owner.token)).send({ link: true, roles, permissions, sendEmail: false });
  if (inv.status !== 201) throw new Error(`invite failed: ${inv.status} ${JSON.stringify(inv.body)}`);
  const token = inv.body.invitations[0].url.split("/invite/")[1];
  const acc = await api().post(`/api/v1/invitations/${token}/accept`).set(auth(user.token));
  if (acc.status !== 200) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.body)}`);
}

export const T = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

export function action(raceUuid: string, type: string, payload: Record<string, unknown>, opts: { at?: string; offset?: number; actionId?: string } = {}) {
  return {
    actionId: opts.actionId ?? randomUUID(), raceUuid, type, payload, deviceTime: opts.at ?? T(), clockOffsetMs: opts.offset ?? 0,
    deviceId: "test-device", protocolVersion: 1,
  };
}

export async function send(user: TestUser, raceUuid: string, ...actions: ReturnType<typeof action>[]) {
  const r = await api().post(`/api/v1/races/${raceUuid}/actions`).set(auth(user.token)).send({ actions });
  if (r.status !== 200) throw new Error(`actions failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.results as { actionId: string; seq: number; applied: boolean; reason: string | null }[];
}

export async function snapshot(user: TestUser, raceUuid: string) {
  return (await api().get(`/api/v1/races/${raceUuid}/snapshot`).set(auth(user.token))).body;
}

export const riderOf = (snap: { riders: { uuid: string }[] }, uuid: string) => snap.riders.find((r) => r.uuid === uuid) as Record<string, any> | undefined;

export async function socketFor(user: TestUser): Promise<Socket> {
  const s = ioClient(`${baseUrl}/race`, { auth: { token: user.token }, transports: ["websocket"] });
  await new Promise<void>((res, rej) => {
    s.on("connect", () => res());
    s.on("connect_error", rej);
  });
  return s;
}

/** Collects every event of a kind on a socket. */
export function collect<T = any>(s: Socket, event: string): T[] {
  const out: T[] = [];
  s.on(event, (m: T) => out.push(m));
  return out;
}

export const until = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
};
