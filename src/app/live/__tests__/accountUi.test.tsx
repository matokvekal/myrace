import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// --- the live client, as the badge sees it ---
const live = vi.hoisted(() => ({
  state: { user: null as null | { id: string; name: string; email: string }, publishErrors: {} as Record<string, string> },
  pending: new Set<string>(),
  saveRaceToServer: vi.fn(),
  publishPending: vi.fn(async () => {}),
}));
vi.mock("@/services/live/liveClient", () => ({
  useLiveStore: (sel: (s: typeof live.state) => unknown) => sel(live.state),
  isPendingPublish: (id: string) => live.pending.has(id),
  publishPending: live.publishPending,
  saveRaceToServer: live.saveRaceToServer,
}));

// --- the account hook, as the side menu sees it ---
const account = vi.hoisted(() => ({ user: null as null | { name: string; email: string }, logout: vi.fn(async () => {}) }));
vi.mock("../useLiveAccount", () => ({
  accountsEnabled: true,
  useLiveAccount: () => ({ user: account.user, logout: account.logout }),
}));

import LocalOnlyBadge from "../LocalOnlyBadge";
import HeaderMain from "../../main/components/headerMain/HeaderMain";

const RACE = "race-1";
const Where = () => <span data-testid="where">{useLocation().pathname + useLocation().search}</span>;
const inRouter = (ui: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={["/main"]}>
      <Routes>
        <Route path="*" element={<>{ui}<Where /></>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  live.state = { user: null, publishErrors: {} };
  live.pending.clear();
  live.saveRaceToServer.mockReset();
  account.user = null;
  account.logout.mockClear();
});

describe("Local race badge: where the race is, and saving it", () => {
  it("signed out: says device only and offers sign-in that returns to the race", async () => {
    inRouter(<LocalOnlyBadge raceUuid={RACE} />);
    const badge = screen.getByTestId("local-only-badge");
    expect(badge).toHaveAttribute("data-state", "signed-out");
    expect(badge).toHaveTextContent("On this device only");
    expect(screen.queryByTestId("local-only-save")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("local-only-signin"));
    expect(screen.getByTestId("where")).toHaveTextContent(`/account?next=${encodeURIComponent(`/race/${RACE}`)}`);
  });

  it("signed in, local race: nothing uploads until 'Save to server' is tapped", async () => {
    live.state.user = { id: "u1", name: "O", email: "o@x" };
    live.saveRaceToServer.mockResolvedValue("srv-1");
    inRouter(<LocalOnlyBadge raceUuid={RACE} />);
    expect(screen.getByTestId("local-only-badge")).toHaveAttribute("data-state", "local");
    expect(live.saveRaceToServer).not.toHaveBeenCalled();
    expect(live.publishPending).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("local-only-save"));
    expect(live.saveRaceToServer).toHaveBeenCalledWith(RACE);
  });

  it("queued new race: uploading, then the reason when it fails, with Save to retry", () => {
    live.state.user = { id: "u1", name: "O", email: "o@x" };
    live.pending.add(RACE);
    const { unmount } = inRouter(<LocalOnlyBadge raceUuid={RACE} />);
    expect(screen.getByTestId("local-only-badge")).toHaveAttribute("data-state", "uploading");
    expect(screen.queryByTestId("local-only-save")).not.toBeInTheDocument();
    unmount();
    live.state.publishErrors = { [RACE]: "No connection to the server" };
    inRouter(<LocalOnlyBadge raceUuid={RACE} />);
    const badge = screen.getByTestId("local-only-badge");
    expect(badge).toHaveAttribute("data-state", "failed");
    expect(badge).toHaveTextContent("Not on server yet · No connection to the server");
    expect(screen.getByTestId("local-only-save")).toBeInTheDocument();
  });
});

describe("Side menu: one sign-in system", () => {
  const openMenu = async () => userEvent.click(document.getElementById("main-menu-button")!);

  it("signed out: Register / Login opens /account (not the old /login)", async () => {
    inRouter(<HeaderMain />);
    await openMenu();
    await userEvent.click(screen.getByTestId("menu-login"));
    expect(screen.getByTestId("where")).toHaveTextContent("/account");
    expect(screen.queryByTestId("menu-logout")).not.toBeInTheDocument();
  });

  it("signed in: shows the account and Logout ends the server session", async () => {
    account.user = { name: "Dana Owner", email: "dana@x.test" };
    inRouter(<HeaderMain />);
    await openMenu();
    expect(screen.getByText("Dana Owner")).toBeInTheDocument();
    expect(screen.getByText("dana@x.test")).toBeInTheDocument();
    expect(screen.queryByTestId("menu-login")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("menu-logout"));
    await waitFor(() => expect(account.logout).toHaveBeenCalledTimes(1));
  });
});
