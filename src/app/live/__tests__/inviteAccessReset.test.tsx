/**
 * Invite: after a link / email invitation is created, the role picker goes back to its
 * default — the next link must never silently carry the previous one's extra roles.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const live = vi.hoisted(() => ({ invite: vi.fn() }));
vi.mock("@/services/live/liveClient", () => ({
  useLiveStore: () => null,
  accessFor: () => null,
  detachRace: vi.fn(),
  outboxCounts: vi.fn(),
  publishRace: vi.fn(),
  directory: {
    groups: async () => ({ groups: [] }),
    contacts: async () => ({ contacts: [] }),
    addContact: async () => ({}),
  },
  team: { invite: (...a: unknown[]) => live.invite(...a) },
}));
vi.mock("@/services/live/liveBridge", () => ({ isLiveRace: () => true }));

import { Invite } from "../TeamPanel";

let n = 0;
beforeEach(() => {
  n = 0;
  live.invite.mockReset().mockImplementation(async (_race: string, body: { link: boolean }) => ({
    invitations: body.link ? [{ link: true, url: `https://x.test/invite/t${++n}`, qrSvg: "<svg></svg>" }] : [{ link: false }],
  }));
});

const linkEditor = () => screen.getByRole("button", { name: "Create link + QR" }).closest("div")!.parentElement as HTMLElement;
const emailEditor = () => screen.getByRole("button", { name: "Send invitations" }).closest("div")!.parentElement as HTMLElement;

describe("Invite access picker", () => {
  it("resets to the default role after Create link + QR, and labels each link with its roles", async () => {
    const user = userEvent.setup();
    render(<Invite raceUuid="race-1" isOwner />);

    await user.click(within(linkEditor()).getByRole("button", { name: "Laps (counter)" })); // viewer + counter
    await user.click(screen.getByRole("button", { name: "Create link + QR" }));
    await waitFor(() => expect(screen.getAllByTestId("invite-link")).toHaveLength(1));
    expect(live.invite.mock.calls[0][1].roles).toEqual(["viewer", "counter"]);

    // Second link without touching the picker: only the default role.
    await user.click(screen.getByRole("button", { name: "Create link + QR" }));
    await waitFor(() => expect(screen.getAllByTestId("invite-link")).toHaveLength(2));
    expect(live.invite.mock.calls[1][1].roles).toEqual(["viewer"]);

    const labels = screen.getAllByTestId("invite-link-access").map((e) => e.textContent);
    expect(labels[0]).toContain("Viewer (read-only)"); // newest first
    expect(labels[0]).not.toContain("Laps (counter)");
    expect(labels[1]).toContain("Laps (counter)");
  });

  it("resets after Send invitations too, and says what was sent", async () => {
    const user = userEvent.setup();
    render(<Invite raceUuid="race-1" isOwner />);
    await user.type(screen.getByPlaceholderText(/Email addresses/), "a@x.test");
    await user.click(within(emailEditor()).getByRole("button", { name: "Check-in" })); // counter + checkin
    await user.click(screen.getByRole("button", { name: "Send invitations" }));
    await waitFor(() => expect(screen.getByTestId("invites-sent").textContent).toContain("Check-in"));
    expect(live.invite.mock.calls[0][1].roles).toEqual(["counter", "checkin"]);

    await user.type(screen.getByPlaceholderText(/Email addresses/), "b@x.test");
    await user.click(screen.getByRole("button", { name: "Send invitations" }));
    await waitFor(() => expect(live.invite).toHaveBeenCalledTimes(2));
    expect(live.invite.mock.calls[1][1].roles).toEqual(["counter"]);
  });

  it("a failed create keeps the picker as chosen", async () => {
    const user = userEvent.setup();
    live.invite.mockRejectedValueOnce(new Error("offline"));
    render(<Invite raceUuid="race-1" isOwner />);
    await user.click(within(linkEditor()).getByRole("button", { name: "Laps (counter)" }));
    await user.click(screen.getByRole("button", { name: "Create link + QR" }));
    await screen.findByText("offline");
    await user.click(screen.getByRole("button", { name: "Create link + QR" }));
    await waitFor(() => expect(live.invite).toHaveBeenCalledTimes(2));
    expect(live.invite.mock.calls[1][1].roles).toEqual(["viewer", "counter"]);
  });
});
