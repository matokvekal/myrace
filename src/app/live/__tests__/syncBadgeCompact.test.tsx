/**
 * Live top bar: compact sync. Status as a dot (text kept for screen readers / tests),
 * a warning icon with the not-applied count that opens the full list. Nothing hidden.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const store = vi.hoisted(() => ({
  state: {
    sync: {} as Record<string, { pending: number; notApplied: unknown[]; revoked?: boolean }>,
    socketConnected: true,
    online: true,
    user: { id: "u1" } as unknown,
  },
}));
// A t() that fills {{placeholders}} like the app's initialised i18next does.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, def: string, vars: Record<string, unknown> = {}) => def.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k] ?? "")),
  }),
}));
vi.mock("@/services/live/liveClient", () => ({
  openLiveRace: vi.fn(async () => {}),
  useLiveStore: (sel: (s: typeof store.state) => unknown) => sel(store.state),
  rejectedActions: vi.fn(async () => []),
  dismissRejected: vi.fn(async () => {}),
}));

import SyncBadge from "../SyncBadge";

beforeEach(() => {
  store.state.sync = { r1: { pending: 0, notApplied: [] } };
  store.state.socketConnected = true;
  store.state.online = true;
  store.state.user = { id: "u1" };
});

describe("SyncBadge compact", () => {
  it("synced: dot only, no warning icon, state text still present", () => {
    render(<SyncBadge raceUuid="r1" compact />);
    expect(screen.getByTestId("sync-badge")).toHaveTextContent("Synced");
    expect(screen.queryByTestId("not-applied-open")).toBeNull();
    expect(screen.queryByTestId("sync-alert-open")).toBeNull();
  });

  it("55 not applied: icon with count; tapping it opens the full list with the message", async () => {
    store.state.sync = { r1: { pending: 0, notApplied: Array.from({ length: 55 }, (_, i) => ({ id: i })) } };
    render(<SyncBadge raceUuid="r1" compact />);
    const btn = screen.getByTestId("not-applied-open");
    expect(btn).toHaveTextContent("55");
    expect(btn).toHaveTextContent("55 not applied"); // accessible name
    fireEvent.click(btn);
    expect(await screen.findByTestId("rejected-actions")).toBeInTheDocument();
    expect(screen.getByTestId("rejected-status")).toHaveTextContent("Synced · 55 not applied");
  });

  it("offline with nothing rejected: warning icon (no count) opens the status", () => {
    store.state.online = false;
    store.state.sync = { r1: { pending: 3, notApplied: [] } };
    render(<SyncBadge raceUuid="r1" compact />);
    expect(screen.getByTestId("sync-badge")).toHaveTextContent("Offline · 3 waiting");
    fireEvent.click(screen.getByTestId("sync-alert-open"));
    expect(screen.getByTestId("sync-details")).toHaveTextContent("Offline · 3 waiting");
  });

  it("the full badge (other screens) is unchanged", () => {
    store.state.sync = { r1: { pending: 0, notApplied: [{}, {}] } };
    render(<SyncBadge raceUuid="r1" />);
    expect(screen.getByTestId("not-applied-open")).toHaveTextContent("2 not applied");
  });
});
