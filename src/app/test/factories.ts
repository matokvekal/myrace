import type { CategoryProps, RiderProps } from "@/types/types";

let seq = 0;

export const makeCategory = (over: Partial<CategoryProps> = {}): CategoryProps => ({
  id: ++seq,
  raceUuid: "race-1",
  name: "Men Elite",
  subCategory: null,
  laps: 3,
  lapsCounter: 0,
  riders: null,
  startTime: "09:00",
  isConnected: null,
  color: "#ff0000",
  heat: 1,
  status: "upcoming",
  ...over,
});

export const makeRider = (over: Partial<RiderProps> = {}): RiderProps => {
  const n = ++seq;
  return {
    id: n,
    raceUuid: "race-1",
    bibNumber: 100 + n,
    firstName: `First${n}`,
    lastName: `Last${n}`,
    category: "Men Elite",
    subCategory: null,
    heat: 1,
    checked: false,
    distance: null,
    elapsedLastLap: null,
    elapsedTimeFromStart: null,
    timeStartRace: null,
    timeArrive: null,
    flag: null,
    lapsCounter: 0,
    lapsDetails: [],
    position_start: null,
    position_category: 0,
    position_race: 0,
    standing: null,
    raceStatus: "upcoming",
    status: "standing",
    team: null,
    viewOrder: 0,
    totalLaps: 3,
    color: "#ff0000",
    image: null,
    comment: null,
    ...over,
  } as RiderProps;
};
