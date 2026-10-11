import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";

// Network is never reachable in tests: any unmocked fetch fails loudly instead of
// touching a real server or production data.
vi.stubGlobal("fetch", () => Promise.reject(new Error("Network disabled in unit tests")));

afterEach(async () => {
  cleanup();
  // Fresh IndexedDB + storage for every test => fully isolated, no shared state.
  (globalThis as any).indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
});
