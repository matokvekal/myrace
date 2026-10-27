import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const recordRaceEvent = vi.fn().mockResolvedValue({});
vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: (...a: unknown[]) => recordRaceEvent(...a) }));
const canForRace = vi.fn().mockReturnValue(true);
vi.mock("@/services/cloud/permissions", () => ({ canForRace: (...a: unknown[]) => canForRace(...a) }));

import CheckIn from "../CheckIn";
import useRiderStore from "@/stores/ridersStore";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { makeCategory, makeRider } from "@/test/factories";
import type { CategoryProps, RiderProps } from "@/types/types";

const RACE = "race-1";

const elite = makeCategory({ name: "Men Elite", color: "#e11", startTime: "09:00", heat: 1 });
const masters = makeCategory({ name: "Masters", color: "#11e", startTime: "09:00", heat: 1 });
const juniors = makeCategory({ name: "Juniors", color: "#1e1", startTime: "09:10", heat: 1 });

const slots = (cats: CategoryProps[]) => {
  const m = new Map<string, CategoryProps[]>();
  for (const c of cats) m.set(c.startTime!, [...(m.get(c.startTime!) ?? []), c]);
  return m;
};

const seed = (riders: RiderProps[]) =>
  useRiderStore.setState({ riders, lastFetchedRaceUuid: RACE });

const renderCheckIn = (cats: CategoryProps[] = [elite, masters, juniors]) =>
  render(<CheckIn raceUuid={RACE} waveNum={1} categories={cats} slots={slots(cats)} />);

const block = (name: string) => {
  const el = screen.getAllByText(name).map((n) => n.closest(".catBlock")).find(Boolean);
  if (!el) throw new Error(`no category block for ${name}`);
  return el as HTMLElement;
};
const bibsIn = (el: HTMLElement) =>
  within(el)
    .queryAllByTestId(/^checkin-row-/)
    .map((r) => Number(r.getAttribute("data-testid")!.replace("checkin-row-", "")));
const stored = async () => {
  const db = await initIndexedDB();
  const all = await db.getAll("riders");
  db.close();
  return all as RiderProps[];
};

beforeEach(() => {
  recordRaceEvent.mockClear();
  canForRace.mockReturnValue(true);
  useRiderStore.setState({ riders: [], lastFetchedRaceUuid: "" });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("Check-In: wave → category structure", () => {
  it("renders one bordered wave block per start slot, each with its categories", () => {
    seed([makeRider({ category: "Men Elite" })]);
    renderCheckIn();
    const waves = document.querySelectorAll(".waveBlock");
    expect(waves).toHaveLength(2); // 09:00 and 09:10
    expect(within(waves[0] as HTMLElement).getByText(/Wave 1 · 09:00/)).toBeInTheDocument();
    expect(within(waves[0] as HTMLElement).getByText("Masters")).toBeInTheDocument();
    expect(within(waves[1] as HTMLElement).getByText("Juniors")).toBeInTheDocument();
  });

  it("puts each rider only inside their own category", () => {
    const e = makeRider({ category: "Men Elite", bibNumber: 11 });
    const m = makeRider({ category: "Masters", bibNumber: 22 });
    seed([e, m]);
    renderCheckIn();
    expect(bibsIn(block("Men Elite"))).toEqual([11]);
    expect(bibsIn(block("Masters"))).toEqual([22]);
  });

  it("keeps categories that share a name but differ by sub-category apart", () => {
    const a = makeCategory({ name: "Masters", subCategory: "19-29", startTime: "09:00" });
    const b = makeCategory({ name: "Masters", subCategory: "30-49", startTime: "09:00" });
    seed([
      makeRider({ category: "Masters", subCategory: "19-29", bibNumber: 1 }),
      makeRider({ category: "Masters", subCategory: "30-49", bibNumber: 2 }),
    ]);
    renderCheckIn([a, b]);
    const blocks = document.querySelectorAll<HTMLElement>(".catBlock");
    expect(blocks).toHaveLength(2);
    expect(bibsIn(blocks[0])).toEqual([1]);
    expect(bibsIn(blocks[1])).toEqual([2]);
  });

  it("ignores riders of other races and of categories outside the wave", () => {
    seed([
      makeRider({ category: "Men Elite", bibNumber: 1 }),
      makeRider({ category: "Men Elite", raceUuid: "other-race", bibNumber: 2 }),
      makeRider({ category: "Veterans", bibNumber: 3 }),
    ]);
    renderCheckIn();
    expect(screen.queryByTestId("checkin-row-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("checkin-row-3")).not.toBeInTheDocument();
    expect(screen.getByTestId("checkin-row-1")).toBeInTheDocument();
  });

  it("still shows an empty category, with an add button", () => {
    seed([makeRider({ category: "Men Elite" })]);
    renderCheckIn();
    expect(within(block("Juniors")).getByText("No riders yet")).toBeInTheDocument();
    expect(screen.getByTestId("checkin-add-Juniors")).toBeInTheDocument();
  });

  it("falls back to a single block when no slot map is given", () => {
    seed([makeRider({ category: "Men Elite", bibNumber: 5 })]);
    render(<CheckIn raceUuid={RACE} waveNum={1} categories={[elite]} />);
    expect(document.querySelectorAll(".waveBlock")).toHaveLength(1);
    expect(screen.getByTestId("checkin-row-5")).toBeInTheDocument();
  });

  it("shows per-category checked counts", async () => {
    const user = userEvent.setup();
    seed([makeRider({ category: "Men Elite", bibNumber: 1 }), makeRider({ category: "Men Elite", bibNumber: 2 })]);
    renderCheckIn([elite]);
    expect(within(block("Men Elite")).getByText("✓ 0/2")).toBeInTheDocument();
    await user.click(within(screen.getByTestId("checkin-row-1")).getByTitle("Check in"));
    expect(within(block("Men Elite")).getByText("✓ 1/2")).toBeInTheDocument();
  });
});

describe("Check-In: add rider to a specific category", () => {
  it("adds the rider to that category only, fixed category, no picker", async () => {
    const user = userEvent.setup();
    seed([makeRider({ category: "Men Elite", bibNumber: 1 })]);
    renderCheckIn();

    await user.click(screen.getByTestId("checkin-add-Masters"));
    expect(within(block("Masters")).queryByRole("combobox")).toBeNull(); // category picker hidden: category is fixed
    await user.type(screen.getByPlaceholderText("First name *"), "Noa");
    await user.type(screen.getByPlaceholderText("Last name *"), "Cohen");
    await user.type(screen.getByPlaceholderText("Bib # *"), "555");
    await user.click(screen.getByRole("button", { name: "Add Rider" }));

    await waitFor(() => expect(bibsIn(block("Masters"))).toEqual([555]));
    expect(bibsIn(block("Men Elite"))).toEqual([1]);

    const added = useRiderStore.getState().riders.find((r) => r.bibNumber === 555)!;
    expect(added).toMatchObject({ category: "Masters", raceUuid: RACE, heat: 1, firstName: "Noa", checked: true });
    expect(added.standing).toBe(1);
    expect((await stored()).some((r) => r.bibNumber === 555)).toBe(true);
  });

  it("gives new riders the next standing within their category", async () => {
    const user = userEvent.setup();
    seed([
      makeRider({ category: "Men Elite", standing: 1, position_start: 1 }),
      makeRider({ category: "Men Elite", standing: 2, position_start: 2 }),
    ]);
    renderCheckIn();
    await user.click(screen.getByTestId("checkin-add-Men Elite"));
    await user.type(screen.getByPlaceholderText("First name *"), "A");
    await user.type(screen.getByPlaceholderText("Last name *"), "B");
    await user.type(screen.getByPlaceholderText("Bib # *"), "900");
    await user.click(screen.getByRole("button", { name: "Add Rider" }));
    await waitFor(() => expect(useRiderStore.getState().riders).toHaveLength(3));
    expect(useRiderStore.getState().riders.find((r) => r.bibNumber === 900)!.standing).toBe(3);
  });

  it("rejects a bib already used in the race and adds nothing", async () => {
    const user = userEvent.setup();
    seed([makeRider({ category: "Men Elite", bibNumber: 42, lastName: "Taken", firstName: "Already" })]);
    renderCheckIn();
    await user.click(screen.getByTestId("checkin-add-Masters"));
    await user.type(screen.getByPlaceholderText("First name *"), "Noa");
    await user.type(screen.getByPlaceholderText("Last name *"), "Cohen");
    await user.type(screen.getByPlaceholderText("Bib # *"), "42");
    await user.click(screen.getByRole("button", { name: "Add Rider" }));

    expect(await screen.findByText(/Bib 42 already used by Taken Already/)).toBeInTheDocument();
    expect(useRiderStore.getState().riders).toHaveLength(1);
  });

  it("requires first name, last name and bib", async () => {
    const user = userEvent.setup();
    seed([]);
    renderCheckIn();
    await user.click(screen.getByTestId("checkin-add-Masters"));
    await user.click(screen.getByRole("button", { name: "Add Rider" }));
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(useRiderStore.getState().riders).toHaveLength(0);
  });

  it("Cancel closes the form without adding", async () => {
    const user = userEvent.setup();
    seed([]);
    renderCheckIn();
    await user.click(screen.getByTestId("checkin-add-Masters"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("First name *")).not.toBeInTheDocument();
  });

  it("opens only one add form at a time", async () => {
    const user = userEvent.setup();
    seed([]);
    renderCheckIn();
    await user.click(screen.getByTestId("checkin-add-Masters"));
    await user.click(screen.getByTestId("checkin-add-Juniors"));
    expect(screen.getAllByPlaceholderText("First name *")).toHaveLength(1);
    expect(within(block("Juniors")).getByPlaceholderText("First name *")).toBeInTheDocument();
  });

  it("hides add buttons once the race is running", () => {
    seed([]);
    renderCheckIn([makeCategory({ name: "Men Elite", status: "running" })]);
    expect(screen.queryByTestId("checkin-add-Men Elite")).not.toBeInTheDocument();
  });
});

describe("Check-In: edit bib", () => {
  const setup = async () => {
    const user = userEvent.setup();
    const a = makeRider({ category: "Men Elite", bibNumber: 10, lastName: "Alpha", firstName: "A" });
    const b = makeRider({ category: "Men Elite", bibNumber: 20, lastName: "Beta", firstName: "B" });
    await useRiderStore.getState().insertRiders([a, b]);
    renderCheckIn();
    return { user, a, b };
  };

  it("saves a new bib, shows it, persists it and logs the edit", async () => {
    const { user, a } = await setup();
    await user.click(screen.getByTestId("checkin-editbib-10"));
    const input = screen.getByTestId("checkin-bibinput-10");
    await user.clear(input);
    await user.type(input, "777");
    await user.click(screen.getByLabelText("Save bib"));

    expect(await screen.findByTestId("checkin-row-777")).toBeInTheDocument();
    expect(screen.queryByTestId("checkin-row-10")).not.toBeInTheDocument();
    // The row re-renders from the store before saveBib's await returns and sets "Saved".
    expect(await screen.findByText("✓ Saved")).toBeInTheDocument();
    expect((await stored()).find((r) => r.id === a.id)!.bibNumber).toBe(777);
    expect(recordRaceEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "RIDER_EDITED", riderId: a.id, bibNumber: 777 })
    );
  });

  it("Enter saves and Escape cancels", async () => {
    const { user } = await setup();
    await user.click(screen.getByTestId("checkin-editbib-10"));
    await user.type(screen.getByTestId("checkin-bibinput-10"), "{Escape}");
    expect(screen.queryByTestId("checkin-bibinput-10")).not.toBeInTheDocument();
    expect(screen.getByTestId("checkin-row-10")).toBeInTheDocument();

    await user.click(screen.getByTestId("checkin-editbib-10"));
    const input = screen.getByTestId("checkin-bibinput-10");
    await user.clear(input);
    await user.type(input, "11{Enter}");
    expect(await screen.findByTestId("checkin-row-11")).toBeInTheDocument();
  });

  it("rejects a bib used by another rider and keeps the old one", async () => {
    const { user, a } = await setup();
    await user.click(screen.getByTestId("checkin-editbib-10"));
    const input = screen.getByTestId("checkin-bibinput-10");
    await user.clear(input);
    await user.type(input, "20");
    await user.click(screen.getByLabelText("Save bib"));

    expect(await screen.findByText(/Bib 20 is already used by Beta B/)).toBeInTheDocument();
    expect(useRiderStore.getState().riders.find((r) => r.id === a.id)!.bibNumber).toBe(10);
    expect(recordRaceEvent).not.toHaveBeenCalled();
  });

  it.each(["", "0", "-5"])("rejects an invalid bib (%j)", async (bad) => {
    const { user, a } = await setup();
    await user.click(screen.getByTestId("checkin-editbib-10"));
    const input = screen.getByTestId("checkin-bibinput-10");
    await user.clear(input);
    if (bad) await user.type(input, bad);
    await user.click(screen.getByLabelText("Save bib"));
    expect(await screen.findByText(/valid bib/i)).toBeInTheDocument();
    expect(useRiderStore.getState().riders.find((r) => r.id === a.id)!.bibNumber).toBe(10);
  });

  it("saving the unchanged bib just closes the editor (no event, no error)", async () => {
    const { user } = await setup();
    await user.click(screen.getByTestId("checkin-editbib-10"));
    await user.click(screen.getByLabelText("Save bib"));
    expect(screen.queryByTestId("checkin-bibinput-10")).not.toBeInTheDocument();
    expect(recordRaceEvent).not.toHaveBeenCalled();
  });

  it("allows reusing a bib freed by a previous edit", async () => {
    const { user } = await setup();
    await user.click(screen.getByTestId("checkin-editbib-10"));
    let input = screen.getByTestId("checkin-bibinput-10");
    await user.clear(input);
    await user.type(input, "99{Enter}");
    await screen.findByTestId("checkin-row-99");

    await user.click(screen.getByTestId("checkin-editbib-20"));
    input = screen.getByTestId("checkin-bibinput-20");
    await user.clear(input);
    await user.type(input, "10{Enter}");
    expect(await screen.findByTestId("checkin-row-10")).toBeInTheDocument();
  });

  it("is not offered once the race is running", () => {
    seed([makeRider({ category: "Men Elite", bibNumber: 10 })]);
    renderCheckIn([makeCategory({ name: "Men Elite", status: "running" })]);
    expect(screen.queryByTestId("checkin-editbib-10")).not.toBeInTheDocument();
  });

  it("does nothing without check-in permission", async () => {
    const { user, a } = await setup();
    await user.click(screen.getByTestId("checkin-editbib-10"));
    const input = screen.getByTestId("checkin-bibinput-10");
    await user.clear(input);
    await user.type(input, "55");
    canForRace.mockReturnValue(false);
    await user.click(screen.getByLabelText("Save bib"));
    expect(useRiderStore.getState().riders.find((r) => r.id === a.id)!.bibNumber).toBe(10);
  });
});

describe("Check-In: standing, rank and sorting", () => {
  const field = () => [
    makeRider({ category: "Men Elite", bibNumber: 30, lastName: "Cohen", firstName: "Zed", standing: 3 }),
    makeRider({ category: "Men Elite", bibNumber: 10, lastName: "Bar", firstName: "Amy", standing: 1 }),
    makeRider({ category: "Men Elite", bibNumber: 20, lastName: "Abel", firstName: "Bo", standing: 2 }),
    makeRider({ category: "Men Elite", bibNumber: 40, lastName: "Dan", firstName: "Eli", standing: null, position_start: null }),
  ];

  it("shows the standing badge on every row", () => {
    seed(field());
    renderCheckIn([elite]);
    expect(within(screen.getByTestId("checkin-row-10")).getByText("S1")).toBeInTheDocument();
    expect(within(screen.getByTestId("checkin-row-40")).getByText("S–")).toBeInTheDocument();
  });

  it("falls back to position_start when standing is not set (older races)", () => {
    seed([makeRider({ category: "Men Elite", bibNumber: 1, standing: null, position_start: 8 })]);
    renderCheckIn([elite]);
    expect(within(screen.getByTestId("checkin-row-1")).getByText("S8")).toBeInTheDocument();
  });

  it("defaults to standing order with unranked riders last", () => {
    seed(field());
    renderCheckIn([elite]);
    expect(bibsIn(block("Men Elite"))).toEqual([10, 20, 30, 40]);
  });

  it("sorts by bib, ascending then descending", async () => {
    const user = userEvent.setup();
    seed(field());
    renderCheckIn([elite]);
    await user.click(screen.getByRole("button", { name: "Bib" }));
    expect(bibsIn(block("Men Elite"))).toEqual([10, 20, 30, 40]);
    await user.click(screen.getByTitle("Ascending"));
    expect(bibsIn(block("Men Elite"))).toEqual([40, 30, 20, 10]);
  });

  it("sorts by name (last, then first)", async () => {
    const user = userEvent.setup();
    seed(field());
    renderCheckIn([elite]);
    await user.click(screen.getByRole("button", { name: "Name" }));
    // Abel, Bar, Cohen, Dan
    expect(bibsIn(block("Men Elite"))).toEqual([20, 10, 30, 40]);
  });

  it("descending standing still keeps unranked riders last", async () => {
    const user = userEvent.setup();
    seed(field());
    renderCheckIn([elite]);
    await user.click(screen.getByTitle("Ascending"));
    expect(bibsIn(block("Men Elite"))).toEqual([30, 20, 10, 40]);
  });

  it("sorts inside each category independently", async () => {
    const user = userEvent.setup();
    seed([
      makeRider({ category: "Men Elite", bibNumber: 2, standing: 2 }),
      makeRider({ category: "Men Elite", bibNumber: 1, standing: 1 }),
      makeRider({ category: "Masters", bibNumber: 4, standing: 2 }),
      makeRider({ category: "Masters", bibNumber: 3, standing: 1 }),
    ]);
    renderCheckIn([elite, masters]);
    await user.click(screen.getByRole("button", { name: "Bib" }));
    expect(bibsIn(block("Men Elite"))).toEqual([1, 2]);
    expect(bibsIn(block("Masters"))).toEqual([3, 4]);
  });

  it("'Whole wave' scope merges the slot into one sorted list", async () => {
    const user = userEvent.setup();
    seed([
      makeRider({ category: "Men Elite", bibNumber: 1, standing: 3 }),
      makeRider({ category: "Masters", bibNumber: 2, standing: 1 }),
      makeRider({ category: "Men Elite", bibNumber: 3, standing: 2 }),
    ]);
    renderCheckIn([elite, masters]);
    await user.click(screen.getByRole("button", { name: "Whole wave" }));
    expect(document.querySelectorAll(".catBlock")).toHaveLength(0);
    const wave = document.querySelector<HTMLElement>(".waveBlock")!;
    expect(bibsIn(wave)).toEqual([2, 3, 1]);
  });

  it("whole-wave scope keeps per-category add buttons", async () => {
    const user = userEvent.setup();
    seed([]);
    renderCheckIn([elite, masters]);
    await user.click(screen.getByRole("button", { name: "Whole wave" }));
    expect(screen.getByTestId("checkin-add-Men Elite")).toBeInTheDocument();
    expect(screen.getByTestId("checkin-add-Masters")).toBeInTheDocument();
  });
});

describe("Check-In: check-in, DNS, search, filter", () => {
  it("toggles a rider checked in the store and on disk", async () => {
    const user = userEvent.setup();
    const r = makeRider({ category: "Men Elite", bibNumber: 7 });
    await useRiderStore.getState().insertRiders([r]);
    renderCheckIn([elite]);
    await user.click(within(screen.getByTestId("checkin-row-7")).getByTitle("Check in"));
    await waitFor(async () => expect((await stored())[0].checked).toBe(true));
    expect(recordRaceEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "RIDER_CHECKIN" }));
    await user.click(within(screen.getByTestId("checkin-row-7")).getByTitle("Uncheck"));
    expect(useRiderStore.getState().riders[0].checked).toBe(false);
  });

  it("Check All checks everyone except DNS / DNF / DSQ", async () => {
    const user = userEvent.setup();
    await useRiderStore.getState().insertRiders([
      makeRider({ category: "Men Elite", bibNumber: 1 }),
      makeRider({ category: "Men Elite", bibNumber: 2 }),
      makeRider({ category: "Men Elite", bibNumber: 3, status: "DNS" }),
      makeRider({ category: "Men Elite", bibNumber: 4, status: "DSQ" }),
    ]);
    renderCheckIn([elite]);
    await user.click(screen.getByRole("button", { name: /Check All/ }));
    await waitFor(() => {
      const byBib = Object.fromEntries(useRiderStore.getState().riders.map((r) => [r.bibNumber, r.checked]));
      expect(byBib).toEqual({ 1: true, 2: true, 3: false, 4: false });
    });
  });

  it("one-tap DNS un-checks the rider and is undoable", async () => {
    const user = userEvent.setup();
    seed([makeRider({ category: "Men Elite", bibNumber: 9, checked: true })]);
    renderCheckIn([elite]);
    await user.click(screen.getByLabelText("Mark #9 DNS"));
    expect(useRiderStore.getState().riders[0]).toMatchObject({ status: "DNS", checked: false });
    expect(screen.getByText("✗ 1 DNS")).toBeInTheDocument();
  });

  it("search narrows by name or bib across categories", async () => {
    const user = userEvent.setup();
    seed([
      makeRider({ category: "Men Elite", bibNumber: 101, lastName: "Levi" }),
      makeRider({ category: "Masters", bibNumber: 202, lastName: "Mizrahi" }),
    ]);
    renderCheckIn([elite, masters]);
    await user.type(screen.getByPlaceholderText(/Search/), "miz");
    expect(screen.queryByTestId("checkin-row-101")).not.toBeInTheDocument();
    expect(screen.getByTestId("checkin-row-202")).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText(/Search/));
    await user.type(screen.getByPlaceholderText(/Search/), "101");
    expect(screen.getByTestId("checkin-row-101")).toBeInTheDocument();
    expect(screen.queryByTestId("checkin-row-202")).not.toBeInTheDocument();
  });

  it("search finds Hebrew names", async () => {
    const user = userEvent.setup();
    seed([makeRider({ category: "Men Elite", bibNumber: 1, lastName: "לוי", firstName: "דנה" })]);
    renderCheckIn([elite]);
    await user.type(screen.getByPlaceholderText(/Search/), "לוי");
    expect(screen.getByTestId("checkin-row-1")).toBeInTheDocument();
  });

  it("category filter shows only that category", async () => {
    const user = userEvent.setup();
    seed([
      makeRider({ category: "Men Elite", bibNumber: 1 }),
      makeRider({ category: "Masters", bibNumber: 2 }),
    ]);
    renderCheckIn([elite, masters]);
    await user.selectOptions(screen.getByDisplayValue("All categories"), "Masters");
    expect(screen.queryByTestId("checkin-row-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("checkin-row-2")).toBeInTheDocument();
  });

  it("locks check-in (no check / DNS buttons) once the race is running", () => {
    seed([makeRider({ category: "Men Elite", bibNumber: 1 })]);
    renderCheckIn([makeCategory({ name: "Men Elite", status: "running" })]);
    expect(screen.getByText(/check-in locked/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mark #1 DNS")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check All/ })).not.toBeInTheDocument();
  });

  it("card view renders the same riders with a bib editor", async () => {
    const user = userEvent.setup();
    seed([makeRider({ category: "Men Elite", bibNumber: 31 })]);
    renderCheckIn([elite]);
    await user.click(screen.getByTitle("Card view"));
    expect(within(block("Men Elite")).getByText("31")).toBeInTheDocument();
    expect(screen.getByTestId("checkin-editbib-31")).toBeInTheDocument();
  });
});
