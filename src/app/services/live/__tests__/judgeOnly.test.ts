import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isJudgeOnly, LIVE_LINKS_KEY } from "../liveBridge";

/** 0.3.2: the judge view (no Create / Info / Team) is decided per race from the member's access. */
describe("isJudgeOnly", () => {
  const put = (a: unknown) => localStorage.setItem("commissaire.live.access.r1", JSON.stringify(a));
  const screens = (team: boolean) => ({ team: { view: team, create: false, update: false, delete: false } });
  beforeEach(() => {
    vi.stubEnv("VITE_SERVER_URL", "/");
    localStorage.setItem(LIVE_LINKS_KEY, JSON.stringify({ r1: { serverRaceUuid: "s1" } }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("owner and admin keep Create; a start / counter / check-in member is a judge", () => {
    put({ isOwner: true, screens: screens(true) });
    expect(isJudgeOnly("r1")).toBe(false);
    put({ isOwner: false, screens: screens(true) }); // admin
    expect(isJudgeOnly("r1")).toBe(false);
    put({ isOwner: false, screens: screens(false) });
    expect(isJudgeOnly("r1")).toBe(true);
  });

  it("the same account is a judge only in the race where it is a member, never in local races", () => {
    put({ isOwner: false, screens: screens(false) });
    expect(isJudgeOnly("other-race")).toBe(false);
    localStorage.setItem(LIVE_LINKS_KEY, "{}");
    expect(isJudgeOnly("r1")).toBe(false);
  });
});
