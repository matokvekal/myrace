/**
 * Action types — the closed enum of shared race changes (Architecture AD-3,
 * revised by the Event Coverage audit). Adding a type is an architecture change.
 *
 * Pure TypeScript: no React, IndexedDB, DOM or Node APIs.
 */
import type {
  ActionId,
  CategoryUuid,
  RaceInfoField,
  RaceSettings,
  RaceUuid,
  RiderIdentityField,
  RiderUuid,
  SharedCategory,
  SharedRace,
  SharedRider,
  UserId,
} from "./state";
import type { MemberRole } from "./roles";
import type { MemberPermissions } from "./access";

/** Bumped on any incompatible change to an Action's shape (AD-17). */
export const PROTOCOL_VERSION = 1;

export const ACTION_TYPES = [
  "AddLap",
  "Undo",
  "RiderFinished",
  "LapCountCorrection",
  "StatusCorrection",
  "WaveStarted",
  "WaveFinished",
  "CategoryFinished",
  "CategoryAdded",
  "CategoryEdited",
  "CategoryDeleted",
  "RiderAdded",
  "RiderEdited",
  "RiderDeleted",
  "RidersImported",
  "RiderCheckedIn",
  "CommentSet",
  "RaceEdited",
  "SettingChanged",
  "MemberChanged",
  "Finalized",
  "Amended",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

const ACTION_TYPE_SET: ReadonlySet<string> = new Set(ACTION_TYPES);
export const isActionType = (value: unknown): value is ActionType =>
  typeof value === "string" && ACTION_TYPE_SET.has(value);

/** The only Action types an `Undo` may target (AD-19). Status reversal is a StatusCorrection. */
export const UNDOABLE_ACTION_TYPES = ["AddLap", "RiderFinished"] as const satisfies readonly ActionType[];

/** Values a `StatusCorrection` can set. "running" = clear back to racing. */
export type StatusCorrectionValue = "standing" | "running" | "DNF" | "DSQ" | "DNS";

/** Category fields a `CategoryEdited` may change. */
export type CategoryEditableField = "name" | "laps" | "heat" | "startTime" | "color" | "linkGroup" | "linkedFinish" | "isConnected" | "ignored" | "bibColor" | "bibTextColor";
/** Fields of a category a Start commissaire may change (start times, wave assignment). */
export const START_EDITABLE_CATEGORY_FIELDS = ["startTime", "heat"] as const satisfies readonly CategoryEditableField[];

/** A category as created by `CategoryAdded` / `RidersImported` (uuid made on the Device). */
export type NewCategory = Pick<SharedCategory, "uuid" | "name" | "subCategory" | "laps" | "heat" | "startTime" | "color" | "linkGroup" | "importOrder"> &
  Partial<Pick<SharedCategory, "bibColor" | "bibTextColor">>;
/** A rider as created by `RiderAdded` / `RidersImported`: identity and start-list fields only. */
export type NewRider = Pick<SharedRider, "uuid" | Exclude<RiderIdentityField, "bibColor" | "bibTextColor"> | "standing" | "flag" | "uciPoints" | "uciNumber" | "image" | "comment"> &
  Partial<Pick<SharedRider, "bibColor" | "bibTextColor">>;


export interface ActionPayloads {
  AddLap: { riderUuid: RiderUuid };
  Undo: { targetActionId: ActionId };
  RiderFinished: { riderUuid: RiderUuid };
  LapCountCorrection: { riderUuid: RiderUuid; laps: number };
  StatusCorrection: { riderUuid: RiderUuid; status: StatusCorrectionValue };
  /** Start a wave, or only some of its categories (a start group). */
  WaveStarted: { heat: number; categoryUuids?: CategoryUuid[] };
  WaveFinished: { heat: number };
  CategoryFinished: { categoryUuid: CategoryUuid };
  CategoryAdded: { category: NewCategory };
  CategoryEdited: { categoryUuid: CategoryUuid; changes: Partial<Pick<SharedCategory, CategoryEditableField>> };
  CategoryDeleted: { categoryUuid: CategoryUuid };
  RiderAdded: { rider: NewRider };
  RiderEdited: { riderUuid: RiderUuid; changes: Partial<Pick<SharedRider, RiderIdentityField>> };
  RiderDeleted: { riderUuid: RiderUuid };
  /** Riders plus only the categories that don't exist yet. Never ID/passport fields. */
  RidersImported: { riders: NewRider[]; categories: NewCategory[] };
  RiderCheckedIn: { riderUuid: RiderUuid; checked: boolean };
  CommentSet: { riderUuid: RiderUuid; comment: string | null };
  RaceEdited: { changes: Partial<Pick<SharedRace, RaceInfoField>> };
  SettingChanged: { changes: Partial<RaceSettings> };
  /** Server-side membership change; `roles: null` = revoked. */
  MemberChanged: { userId: UserId; roles: MemberRole[] | null; permissions: MemberPermissions };
  /** Server-computed official result (AD-13). */
  Finalized: { version: number; token: string };
  /** `includeActionIds` = not-applied Actions this version accepts. */
  Amended: { version: number; prevToken: string; reason: string; includeActionIds: ActionId[] };
}

/** Stable codes for an Action stored as not applied (same strings as API errors). */
export const NOT_APPLIED_REASONS = [
  "not_member",
  "forbidden",
  "out_of_scope",
  "race_official",
  "locked",
  "invalid",
  "upgrade_required",
] as const;
export type NotAppliedReason = (typeof NOT_APPLIED_REASONS)[number];

/** Fields the Server sets; a Device never sends them. */
export interface ServerActionFields {
  /** The signed-in account that sent it. */
  userId: UserId | null;
  /** ISO 8601. */
  receivedAt: string;
  seq: number;
  applied: boolean;
  reason: NotAppliedReason | null;
}

/** The Action envelope (AD-3). All Device fields are required. */
export interface ActionEnvelope<T extends ActionType = ActionType> {
  /** UUID v4 created on the Device at tap time. */
  actionId: ActionId;
  raceUuid: RaceUuid;
  type: T;
  payload: ActionPayloads[T];
  /** ISO 8601 device clock at tap time. */
  deviceTime: string;
  clockOffsetMs: number;
  deviceId: string;
  protocolVersion: number;
}

/** Any Action, discriminated on `type`. */
export type RaceAction = { [T in ActionType]: ActionEnvelope<T> }[ActionType];

/** An Action as stored and broadcast by the Server. */
export type SequencedAction = RaceAction & ServerActionFields;
