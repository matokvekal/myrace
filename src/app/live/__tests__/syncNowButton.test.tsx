/**
 * LIVE Sync button: busy state, translated error that clears by itself, success text.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mock = vi.hoisted(() => ({ impl: (async () => ({ pending: 0, rejected: 0 })) as (local: string) => Promise<{ pending: number; rejected: number }> }));
vi.mock("@/services/live/liveClient", () => {
  class SyncError extends Error { constructor(public code: string) { super(code); } }
  class LiveApiError extends Error { constructor(public status: number) { super("api"); } }
  return { SyncError, LiveApiError, syncRaceNow: (l: string) => mock.impl(l) };
});

import SyncNowButton from "../SyncNowButton";
import { SyncError } from "@/services/live/liveClient";

beforeEach(() => { mock.impl = async () => ({ pending: 0, rejected: 0 }); });

describe("SyncNowButton", () => {
  it("shows busy while syncing, then Synced", async () => {
    let release!: () => void;
    mock.impl = () => new Promise((r) => { release = () => r({ pending: 0, rejected: 0 }); });
    render(<SyncNowButton raceUuid="r1" />);
    fireEvent.click(screen.getByTestId("live-sync-now"));
    expect(screen.getByTestId("live-sync-now")).toBeDisabled();
    await act(async () => release());
    expect(screen.getByTestId("live-sync-now-status")).toHaveTextContent("Synced");
  });

  it("an error is short, translated by code (never the raw English Error) and clears after 6 s", async () => {
    vi.useFakeTimers();
    try {
      mock.impl = async () => { throw new (SyncError as unknown as new (c: string) => Error)("offline"); };
      render(<SyncNowButton raceUuid="r1" />);
      await act(async () => { fireEvent.click(screen.getByTestId("live-sync-now")); });
      expect(screen.getByTestId("live-sync-now-status")).toHaveTextContent("No connection — changes stay queued");
      await act(async () => { vi.advanceTimersByTime(6100); });
      expect(screen.getByTestId("live-sync-now-status")).toHaveTextContent("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("compact (Live top bar): icon only, labelled, same sync action and result bubble", async () => {
    vi.useFakeTimers();
    try {
      mock.impl = async () => { throw new (SyncError as unknown as new (c: string) => Error)("offline"); };
      render(<SyncNowButton raceUuid="r1" compact />);
      const btn = screen.getByTestId("live-sync-now");
      expect(btn).toHaveAccessibleName("Sync");
      expect(btn.textContent).toBe(""); // no visible text in the bar
      expect(screen.getByTestId("live-sync-now-status")).toBeEmptyDOMElement();
      await act(async () => { fireEvent.click(btn); });
      expect(screen.getByTestId("live-sync-now-status")).toHaveTextContent("No connection — changes stay queued");
      await act(async () => { vi.advanceTimersByTime(6100); });
      expect(screen.getByTestId("live-sync-now-status")).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });
});
