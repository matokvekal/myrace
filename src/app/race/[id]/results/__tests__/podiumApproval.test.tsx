/**
 * 0.3.5 — the Approve dialog (exact word, server call) and the rider lock after GO in the
 * old editors (shared races only).
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const live = vi.hoisted(() => ({ linked: true, approve: vi.fn() }));
vi.mock("@/services/live/liveBridge", () => ({ isLiveRace: () => live.linked }));
vi.mock("@/services/live/liveClient", () => ({ team: { approveCategory: live.approve } }));

import ApproveCategoryModal from "../ApproveCategoryModal";
import { riderLockedAfterGo, riderStartedLocally } from "@/utils/riderLock";

beforeEach(() => {
  live.linked = true;
  live.approve.mockReset().mockResolvedValue({ approval: { status: "approved" } });
});

describe("Approve dialog", () => {
  it("enabled only for exactly APPROVED; sends what was typed; closes and reloads on success", async () => {
    const onClose = vi.fn();
    const onApproved = vi.fn();
    render(<ApproveCategoryModal raceUuid="race-1" categoryUuid="cat-1" categoryName="Elite" onClose={onClose} onApproved={onApproved} />);
    const input = screen.getByTestId("approve-input");
    const btn = screen.getByTestId("approve-confirm");
    for (const v of ["", "approved", "APPROVE", "APPROVED ", " APPROVED"]) {
      fireEvent.change(input, { target: { value: v } });
      expect(btn).toBeDisabled();
    }
    fireEvent.change(input, { target: { value: "APPROVED" } });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(onApproved).toHaveBeenCalled());
    expect(live.approve).toHaveBeenCalledWith("race-1", "cat-1", "APPROVED");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    live.approve.mockRejectedValue(new Error("Your role in this race does not allow approving results"));
    const onClose = vi.fn();
    render(<ApproveCategoryModal raceUuid="race-1" categoryUuid="cat-1" categoryName="Elite" onClose={onClose} onApproved={vi.fn()} />);
    fireEvent.change(screen.getByTestId("approve-input"), { target: { value: "APPROVED" } });
    fireEvent.click(screen.getByTestId("approve-confirm"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/does not allow/);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("rider lock after GO (old editors)", () => {
  const cat = (status: string) => ({ id: 1, raceUuid: "R", name: "Elite", subCategory: null, status }) as never;
  const rider = (over: Record<string, unknown> = {}) => ({ id: 1, raceUuid: "R", category: "Elite", subCategory: null, raceStatus: "upcoming", timeStartRace: null, ...over }) as never;

  it("started = running category, a rider who ran, or a finished category that ran", () => {
    expect(riderStartedLocally(rider(), [cat("upcoming")], [])).toBe(false);
    expect(riderStartedLocally(rider(), [cat("running")], [])).toBe(true);
    expect(riderStartedLocally(rider({ timeStartRace: "10:00:00" }), [cat("upcoming")], [])).toBe(true);
    expect(riderStartedLocally(rider(), [cat("finished")], [rider()])).toBe(false); // closed "not started"
    expect(riderStartedLocally(rider(), [cat("finished")], [rider({ id: 2, raceStatus: "finished" })])).toBe(true);
  });

  it("locks only shared races", () => {
    expect(riderLockedAfterGo(rider(), [cat("running")], [])).toBe(true);
    live.linked = false;
    expect(riderLockedAfterGo(rider(), [cat("running")], [])).toBe(false);
  });
});
