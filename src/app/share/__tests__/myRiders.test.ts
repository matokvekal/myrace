import { beforeEach, describe, expect, it } from "vitest";
import { loadMyRiders, MY_RIDERS_MAX, toggleId } from "../myRiders/myRiders";

/** Hotfix: spectators star riders (My riders), stored per share link in this browser. */
describe("My riders", () => {
  beforeEach(() => localStorage.clear());

  it("toggle adds in order and removes", () => {
    expect(toggleId([], "a")).toEqual(["a"]);
    expect(toggleId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("keeps at most the newest MY_RIDERS_MAX", () => {
    const full = Array.from({ length: MY_RIDERS_MAX }, (_, i) => `r${i}`);
    const next = toggleId(full, "new");
    expect(next).toHaveLength(MY_RIDERS_MAX);
    expect(next[0]).toBe("r1");
    expect(next.at(-1)).toBe("new");
  });

  it("reads only its own link and ignores garbage", () => {
    localStorage.setItem("commissaire.myRiders.v1.t1", JSON.stringify(["a", 5, "b"]));
    localStorage.setItem("commissaire.myRiders.v1.t2", "{not json");
    expect(loadMyRiders("t1")).toEqual(["a", "b"]);
    expect(loadMyRiders("t2")).toEqual([]);
    expect(loadMyRiders("t3")).toEqual([]);
  });
});
