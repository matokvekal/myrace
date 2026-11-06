/**
 * Info tab: the server/sharing panel sits behind one icon and opens in a modal (user request).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const state = vi.hoisted(() => ({ linked: false, store: { sync: {} as Record<string, unknown>, publishErrors: {} as Record<string, string>, online: true, socketConnected: true } }));
vi.mock("@/services/live/liveClient", () => ({
  useLiveStore: (sel: (s: typeof state.store) => unknown) => sel(state.store),
}));
vi.mock("@/services/live/liveBridge", () => ({ isLiveRace: () => state.linked, LIVE_ACCESS_EVENT: "x" }));
const inner = vi.hoisted(() => ({ open: false }));
vi.mock("../RaceServerAction", () => ({
  default: () => (
    <section data-testid="race-server-action">
      panel <button>Upload Race to Server</button>
      {inner.open && <div role="dialog" data-testid="inner">publish</div>}
    </section>
  ),
}));

import RaceServerButton from "../RaceServerButton";

beforeEach(() => {
  inner.open = false;
  state.linked = false;
  state.store = { sync: {}, publishErrors: {}, online: true, socketConnected: true };
});

describe("RaceServerButton", () => {
  it("shows only the icon; the panel opens in a modal and closes (button, backdrop, Escape)", () => {
    render(<RaceServerButton raceUuid="r1" raceName="Race" />);
    expect(screen.getByTestId("race-server-open")).toBeInTheDocument();
    expect(screen.queryByTestId("race-server-action")).toBeNull();

    fireEvent.click(screen.getByTestId("race-server-open"));
    expect(screen.getByRole("dialog")).toHaveTextContent("panel");
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("race-server-open"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the icon tells the state: local = action, synced = ok, waiting = wait, failed upload = error", () => {
    const { rerender } = render(<RaceServerButton raceUuid="r1" raceName="Race" />);
    expect(screen.getByTestId("race-server-open")).toHaveAttribute("data-tone", "action");
    state.store.publishErrors = { r1: "no connection" };
    rerender(<RaceServerButton raceUuid="r1" raceName="Race" />);
    expect(screen.getByTestId("race-server-open")).toHaveAttribute("data-tone", "error");
    state.linked = true;
    rerender(<RaceServerButton raceUuid="r1" raceName="Race" />);
    expect(screen.getByTestId("race-server-open")).toHaveAttribute("data-tone", "ok");
    state.store.sync = { r1: { pending: 2 } };
    rerender(<RaceServerButton raceUuid="r1" raceName="Race" />);
    expect(screen.getByTestId("race-server-open")).toHaveAttribute("data-tone", "wait");
  });

  it("moves focus into the dialog and back to the icon; Escape leaves it open while a nested dialog is open", () => {
    render(<RaceServerButton raceUuid="r1" raceName="Race" />);
    const icon = screen.getByTestId("race-server-open");
    fireEvent.click(icon);
    expect(document.activeElement).toBe(screen.getByLabelText("Close"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(icon);

    inner.open = true;
    fireEvent.click(icon);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("race-server-modal")).toBeInTheDocument(); // only the inner one may close
  });

  it("the icon's label says the state for screen readers", () => {
    state.linked = true;
    state.store.sync = { r1: { pending: 1 } };
    render(<RaceServerButton raceUuid="r1" raceName="Race" />);
    expect(screen.getByTestId("race-server-open")).toHaveAttribute("aria-label", "On server — waiting to sync");
  });
});
