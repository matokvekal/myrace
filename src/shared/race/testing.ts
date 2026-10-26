/**
 * Test harness for the shared race model: deterministic builders for state and
 * Actions, usable by client and Server tests. Pure TypeScript, no test-runner
 * imports. Riders are synthetic. Not used by app code.
 */
import { PROTOCOL_VERSION, type ActionEnvelope, type ActionPayloads, type ActionType } from "./actions";
import type { RaceState, SharedCategory, SharedRace, SharedRider } from "./state";

/** A fixed race-clock origin: 2026-06-01 10:00:00 UTC. */
export const T0 = Date.UTC(2026, 5, 1, 10, 0, 0);
export const TEST_RACE_UUID = "00000000-0000-4000-8000-000000000001";
export const TEST_USER_ID = "00000000-0000-4000-8000-0000000000aa";
export const TEST_DEVICE_ID = "device-test-1";
const ISO0 = new Date(T0).toISOString();

let counter = 0;
/** Restart the id sequence so each test gets the same ids. */
export const resetHarnessIds = (): void => {
  counter = 0;
};
/** A deterministic UUID-shaped id. */
export const nextId = (): string => {
  counter += 1;
  return `00000000-0000-4000-8000-${(0x100 + counter).toString(16).padStart(12, "0")}`;
};

export const makeRace = (over: Partial<SharedRace> = {}): SharedRace => ({
  uuid: TEST_RACE_UUID,
  ownerUserId: TEST_USER_ID,
  raceId: "2026-06-01-test-race",
  owner: "",
  name: "Test Race",
  location: "",
  time: "",
  date: "2026-06-01",
  image: "",
  heat: "",
  status: "upcoming",
  type: "",
  raceType: "MTB",
  level: "",
  orgenizer: "",
  manager: "",
  phone: "",
  takanon: "",
  site: "",
  map: "",
  distance: 0,
  isActive: true,
  autoColor: null,
  leaderFinishAll: null,
  waveColors: null,
  mapCenter: null,
  mapZoom: null,
  trackPoints: null,
  mapMarkers: null,
  tracks: null,
  joinCode: null,
  lastSeq: 0,
  createdAt: ISO0,
  lastUpdateAt: ISO0,
  ...over,
});

export const makeCategory = (over: Partial<SharedCategory> = {}): SharedCategory => ({
  uuid: nextId(),
  raceUuid: TEST_RACE_UUID,
  name: "Elite Men",
  subCategory: null,
  laps: 3,
  startTime: "10:00",
  isConnected: false,
  color: null,
  heat: 1,
  status: "upcoming",
  linkedFinish: null,
  linkGroup: null,
  startedAt: null,
  finishedAt: null,
  importOrder: null,
  ...over,
});

/** A synthetic rider in category "Elite Men" unless told otherwise. */
export const makeRider = (over: Partial<SharedRider> = {}): SharedRider => {
  const uuid = over.uuid ?? nextId();
  return {
    uuid,
    raceUuid: TEST_RACE_UUID,
    bibNumber: null,
    category: "Elite Men",
    subCategory: null,
    checked: false,
    firstName: "Test",
    middleName: null,
    lastName: `Rider ${uuid.slice(-3)}`,
    flag: null,
    team: null,
    standing: null,
    heat: 1,
    status: "standing",
    comment: null,
    image: null,
    chipNumber: null,
    points: null,
    uciPoints: null,
    federation: null,
    uciNumber: null,
    viewOrder: 0,
    raceStatus: "upcoming",
    timeStartRace: null,
    timeArrive: null,
    lapsCounter: 0,
    lapsDetails: [],
    totalLaps: 0,
    elapsedLastLap: null,
    elapsedTimeFromStart: null,
    distance: null,
    position_start: null,
    position_category: 0,
    position_race: 0,
    color: null,
    createdAt: ISO0,
    updatedAt: ISO0,
    ...over,
  };
};

/** A race state holding the given categories and riders, keyed by uuid. */
export const makeRaceState = (
  opts: { race?: Partial<SharedRace>; categories?: SharedCategory[]; riders?: SharedRider[] } = {},
): RaceState => ({
  race: makeRace(opts.race),
  categories: Object.fromEntries((opts.categories ?? []).map((c) => [c.uuid, c])),
  riders: Object.fromEntries((opts.riders ?? []).map((r) => [r.uuid, r])),
});

/**
 * An Action envelope with test defaults. `atMs` is the aligned race-clock time
 * (default T0); it is written as `deviceTime` with a zero clock offset.
 */
export const makeAction = <T extends ActionType>(
  type: T,
  payload: ActionPayloads[T],
  over: Partial<Omit<ActionEnvelope<T>, "type" | "payload">> & { atMs?: number } = {},
): ActionEnvelope<T> => {
  const { atMs, ...rest } = over;
  return {
    actionId: nextId(),
    raceUuid: TEST_RACE_UUID,
    type,
    payload,
    deviceTime: new Date(atMs ?? T0).toISOString(),
    clockOffsetMs: 0,
    deviceId: TEST_DEVICE_ID,
    protocolVersion: PROTOCOL_VERSION,
    ...rest,
  };
};
