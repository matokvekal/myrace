import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/** 0.3.1: "Continue with Google" on the invite page; accepting lands on the race's RACE screen. */
const live = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
  google: vi.fn(async () => undefined),
  accept: vi.fn(async () => ({ raceUuid: "srv-race" })),
  openSharedRace: vi.fn(async () => "local-race"),
}));
vi.mock("@/services/live/liveClient", () => ({
  useLiveStore: (sel: (s: { user: typeof live.user }) => unknown) => sel({ user: live.user }),
  auth: { google: live.google },
  openSharedRace: live.openSharedRace,
  invitations: {
    preview: async () => ({ id: "i", raceUuid: "srv-race", raceName: "Race", raceDate: "2026-11-08", invitedBy: "Org", roles: ["counter"], waves: null, status: "valid", forEmail: null, canAccept: true }),
    accept: live.accept,
  },
}));

import InvitePage from "../InvitePage";
import useUIStore from "@/stores/uiStore";

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;
const show = () =>
  render(
    <MemoryRouter initialEntries={["/invite/tok"]}>
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

describe("InvitePage + Google", () => {
  beforeEach(() => useUIStore.getState().setRaceModeRace(null));
  afterEach(() => vi.unstubAllEnvs());

  it("signed out with a Google client id: shows Continue with Google and the email option", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
    live.user = null;
    show();
    expect(screen.getByTestId("google-signin")).toBeTruthy();
    expect(screen.getByTestId("invite-signin-email").textContent).toMatch(/email/i);
  });

  it("no client id in the build: no Google button (never a dead one)", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    live.user = null;
    show();
    expect(screen.queryByTestId("google-signin")).toBeNull();
  });

  it("accept opens the race on its RACE screen", async () => {
    live.user = { id: "u1", email: "judge@x.test" };
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/race/local-race"));
    expect(useUIStore.getState().raceModeRace).toBe("local-race");
  });
});
