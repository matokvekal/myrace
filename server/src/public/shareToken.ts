/**
 * Race share links. A token is `<race uuid, base64url>.<HMAC-SHA256, 16 bytes>`:
 * stable (the same race always gets the same link), unique per race and
 * unguessable without the server secret, with no table to keep. It grants READ
 * access to that one race's public data and nothing else — management routes
 * never accept it (they require a signed-in owner or member).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const key = () => env.SHARE_LINK_SECRET || createHmac("sha256", env.JWT_ACCESS_SECRET).update("commissaire:share-link:v1").digest("hex");
const mac = (raceUuid: string) => createHmac("sha256", key()).update(`race:${raceUuid.toLowerCase()}`).digest().subarray(0, 16);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function shareTokenFor(raceUuid: string): string {
  const id = Buffer.from(raceUuid.replace(/-/g, ""), "hex").toString("base64url");
  return `${id}.${mac(raceUuid).toString("base64url")}`;
}

/** The race behind a share token, or null when the token is malformed or not signed by this server. */
export function raceUuidFromShareToken(token: string): string | null {
  const m = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  const hex = Buffer.from(m[1], "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!UUID.test(uuid)) return null;
  const given = Buffer.from(m[2], "base64url");
  const want = mac(uuid);
  return given.length === want.length && timingSafeEqual(given, want) ? uuid : null;
}
