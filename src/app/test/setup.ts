import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";

// Network is never reachable in tests: any unmocked fetch fails loudly instead of
// touching a real server or production data.
vi.stubGlobal("fetch", () => Promise.reject(new Error("Network disabled in unit tests")));

// jsdom has no layout engine and no ResizeObserver. Components that measure
// themselves (RacingRider's pace ring) only need it to exist: with no layout
// there is never a resize to report, so observe/unobserve/disconnect are no-ops.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(_callback: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(async () => {
  cleanup();
  // Fresh IndexedDB + storage for every test => fully isolated, no shared state.
  (globalThis as any).indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
});
