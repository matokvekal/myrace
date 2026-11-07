import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const live = vi.hoisted(() => ({ user: { id: "u1", email: "judge@x.test" }, forEmail: "Judge@x.test" as string | null }));
vi.mock("@/services/live/liveClient", () => ({
  useLiveStore: (sel: (s: { user: typeof live.user }) => unknown) => sel({ user: live.user }),
  openSharedRace: vi.fn(),
  invitations: {
    preview: async () => ({ id: "i", raceUuid: "r", raceName: "Race", raceDate: "2026-11-08", invitedBy: "Org", roles: ["counter"], waves: null, status: "valid", forEmail: live.forEmail, canAccept: false }),
    accept: vi.fn(),
  },
}));

import InvitePage from "../InvitePage";

const show = () =>
  render(
    <MemoryRouter initialEntries={["/invite/tok"]}>
      <Routes><Route path="/invite/:token" element={<InvitePage />} /></Routes>
    </MemoryRouter>,
  );

describe("InvitePage: email invitation the account can't accept yet", () => {
  it("own email, not verified: explains it and points to a link / QR (no Accept)", async () => {
    live.forEmail = "Judge@x.test";
    show();
    expect((await screen.findByTestId("invite-cannot-accept")).textContent).toMatch(/verified it yet.*link or QR/);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("another address: the wrong-email message", async () => {
    live.forEmail = "someone@x.test";
    show();
    expect((await screen.findByTestId("invite-cannot-accept")).textContent).toContain("This invitation is for");
  });
});
