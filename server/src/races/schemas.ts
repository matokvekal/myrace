/** Runtime validation of Actions (strict: unknown fields are rejected, so no ID/passport data gets in). */
import { z } from "zod";
import { ACTION_TYPES } from "../../../src/shared/race/actions.js";
import { RACE_INFO_FIELDS } from "../../../src/shared/race/state.js";

const uuid = z.string().uuid();
const text = (max = 200) => z.string().max(max);
const heat = z.number().int().min(0).max(999);
const nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();
/** A normalized "#RRGGBB" colour (bib colours). */
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const newCategory = z.strictObject({
  uuid,
  name: text(120).min(1),
  subCategory: nullable(text(120)),
  laps: nullable(z.number().int().min(0).max(999)),
  heat: nullable(heat),
  startTime: nullable(text(20)),
  color: nullable(text(30)),
  linkGroup: nullable(text(60)),
  importOrder: nullable(z.number().int()),
  bibColor: nullable(hexColor),
  bibTextColor: nullable(hexColor),
});

export const newRider = z.strictObject({
  uuid,
  firstName: text(100),
  middleName: nullable(text(100)),
  lastName: text(100),
  bibNumber: nullable(z.number().int().min(0).max(999999)),
  team: nullable(text(150)),
  chipNumber: nullable(text(50)),
  federation: nullable(text(100)),
  points: nullable(z.number()),
  category: text(120).min(1),
  subCategory: nullable(text(120)),
  heat: nullable(heat),
  standing: nullable(z.number().int()),
  flag: nullable(text(10)),
  uciPoints: nullable(z.number()),
  uciNumber: nullable(text(30)),
  bibColor: nullable(hexColor),
  bibTextColor: nullable(hexColor),
  image: nullable(text(500)),
  comment: nullable(text(1000)),
});

const riderIdentityChanges = newRider.omit({ uuid: true, standing: true, flag: true, uciPoints: true, image: true, comment: true }).partial();

const raceInfoShape = Object.fromEntries(RACE_INFO_FIELDS.map((f) => [f, z.unknown()])) as Record<(typeof RACE_INFO_FIELDS)[number], z.ZodUnknown>;

const payloads = {
  AddLap: z.strictObject({ riderUuid: uuid, recovered: z.literal(true).optional(), enteredAt: z.string().datetime({ offset: true }).optional() }),
  Undo: z.strictObject({ targetActionId: uuid }),
  RiderFinished: z.strictObject({ riderUuid: uuid }),
  LapCountCorrection: z.strictObject({ riderUuid: uuid, laps: z.number().int().min(0).max(999) }),
  StatusCorrection: z.strictObject({ riderUuid: uuid, status: z.enum(["standing", "running", "DNF", "DSQ", "DNS"]) }),
  WaveStarted: z.strictObject({ heat, categoryUuids: z.array(uuid).min(1).optional() }),
  WaveFinished: z.strictObject({ heat }),
  CategoryFinished: z.strictObject({ categoryUuid: uuid }),
  CategoryAdded: z.strictObject({ category: newCategory }),
  CategoryEdited: z.strictObject({
    categoryUuid: uuid,
    changes: z
      .strictObject({
        name: text(120).min(1),
        laps: z.number().int().min(0).max(999).nullable(),
        heat: heat.nullable(),
        startTime: text(20).nullable(),
        color: text(30).nullable(),
        linkGroup: text(60).nullable(),
        linkedFinish: z.boolean().nullable(),
        isConnected: z.boolean().nullable(),
        ignored: z.boolean(),
        bibColor: hexColor.nullable(),
        bibTextColor: hexColor.nullable(),
      })
      .partial(),
  }),
  CategoryDeleted: z.strictObject({ categoryUuid: uuid }),
  RiderAdded: z.strictObject({ rider: newRider }),
  RiderEdited: z.strictObject({ riderUuid: uuid, changes: z.strictObject(riderIdentityChanges.shape) }),
  RiderDeleted: z.strictObject({ riderUuid: uuid }),
  RidersImported: z.strictObject({ riders: z.array(newRider).max(5000), categories: z.array(newCategory).max(500) }),
  RiderCheckedIn: z.strictObject({ riderUuid: uuid, checked: z.boolean() }),
  CommentSet: z.strictObject({ riderUuid: uuid, comment: text(1000).nullable() }),
  RaceEdited: z.strictObject({ changes: z.strictObject(raceInfoShape).partial() }),
  SettingChanged: z.strictObject({ changes: z.strictObject({ leaderFinishAll: z.boolean(), autoColor: z.boolean(), minLapSeconds: z.number().int().min(0).max(3600) }).partial() }),
} as const;

/** Types a Device may send; MemberChanged/Finalized/Amended are written by the Server only. */
export const DEVICE_ACTION_TYPES = Object.keys(payloads) as (keyof typeof payloads)[];

export const envelope = z.object({
  actionId: uuid,
  raceUuid: uuid,
  type: z.enum(ACTION_TYPES),
  payload: z.unknown(),
  deviceTime: z.string().datetime({ offset: true }),
  // Wide on purpose: a broken clock is flagged by the server (clockCheck), never refused.
  clockOffsetMs: z.number().int().min(-30 * 86_400_000).max(30 * 86_400_000),
  deviceId: text(100).min(1),
  protocolVersion: z.number().int().min(1),
});

/** Validates one Action's payload for its type; returns an error message or null. */
export function payloadError(type: string, payload: unknown): string | null {
  const schema = (payloads as Record<string, z.ZodTypeAny>)[type];
  if (!schema) return `${type} cannot be sent by a device`;
  const r = schema.safeParse(payload);
  return r.success ? null : r.error.issues[0]?.message ?? "invalid payload";
}
