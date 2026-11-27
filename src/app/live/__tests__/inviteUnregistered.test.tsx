import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * An UNREGISTERED commissaire opens /invite/:token: never the public spectator page — registration
 * (or login) keeps the invitation, then Accept lands in the invited race.
 */
const live = vi.hoisted(() => ({ store: null as null | ((sel: (s: { user: unknown }) => unknown) => unknown), setUser: (_u: unknown) => {} }));
vi.mock("@/services/live/liveClient", async () => {
  const { create: mk } = await import("zustand");
  const s = mk<{ user: unknown }>(() => ({ user: null }));
  live.setUser = (u) => s.setState({ user: u });
  return {
    useLiveStore: s,
    LiveApiError: class extends Error { constructor(readonly status: number, readonly code: string, m: string) { super(m); } },
    auth: {
      register: vi.fn(async () => { live.setUser({ id: "u9", email: "new@x.test", name: "New" }); }),
      login: vi.fn(async () => { live.setUser({ id: "u9", email: "new@x.test", name: "New" }); }),
      google: vi.fn(),
    },
    openSharedRace: vi.fn(async () => "local-race"),
    invitations: {
      preview: async () => ({ id: "i", raceUuid: "srv-race", raceName: "Race", raceDate: "2026-11-08", invitedBy: "Org", roles: ["counter"], waves: null, status: "valid", forEmail: null, canAccept: true }),
      accept: vi.fn(async () => ({ raceUuid: "srv-race" })),
    },
  };
});

import InvitePage from "../InvitePage";
import AccountPage from "../AccountPage";

const Where = () => {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}</span>;
};
const show = () =>
  render(
    <MemoryRouter initialEntries={["/invite/tok"]}>
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/share/:token" element={<span data-testid="spectator">spectator</span>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

describe("commissaire invitation, not registered / not logged in", () => {
  beforeEach(() => live.setUser(null));

  it("register: invite → account (register tab) → back to the invite → Accept → the race; never the spectator page", async () => {
    show();
    expect(screen.queryByTestId("spectator")).toBeNull();
    await userEvent.click(screen.getByTestId("invite-register"));
    await userEvent.type(await screen.findByPlaceholderText("Your name"), "Dana");
    await userEvent.type(screen.getByPlaceholderText("Email"), "new@x.test");
    await userEvent.type(screen.getByPlaceholderText("Password (8+ characters)"), "secret-123");
    await userEvent.type(screen.getByPlaceholderText("Repeat password"), "secret-123");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/race/local-race"));
    expect(screen.queryByTestId("spectator")).toBeNull();
  });

  it("login: invite → sign in → back to the invite → Accept → the race", async () => {
    show();
    await userEvent.click(screen.getByTestId("invite-signin-email"));
    await userEvent.type(await screen.findByPlaceholderText("Email"), "new@x.test");
    await userEvent.type(screen.getByPlaceholderText("Password"), "secret-123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/race/local-race"));
  });
});
