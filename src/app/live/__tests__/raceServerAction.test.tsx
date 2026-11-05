import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

type State = {
  user: null | { id: string };
  publishErrors: Record<string, string>;
  access: Record<string, { isOwner: boolean }>;
  sync: Record<string, { pending: number; revoked?: boolean }>;
  socketConnected: boolean;
  online: boolean;
};
const live = vi.hoisted(() => ({
  state: {} as State,
  linked: new Set<string>(),
  saveRaceToServer: vi.fn(),
  shareLink: vi.fn(),
  setRacePublished: vi.fn(),
  openLiveRace: vi.fn(async () => {}),
}));
vi.mock("@/services/live/liveClient", () => ({
  useLiveStore: (sel: (s: State) => unknown) => sel(live.state),
  isPendingPublish: () => false,
  saveRaceToServer: (id: string) => live.saveRaceToServer(id),
  shareLink: (id: string) => live.shareLink(id),
  setRacePublished: (id: string, p: boolean) => live.setRacePublished(id, p),
  openLiveRace: live.openLiveRace,
}));
vi.mock("@/services/live/liveBridge", () => ({
  isLiveRace: (id: string) => live.linked.has(id),
  LIVE_ACCESS_EVENT: "commissaire-live-access",
}));

import RaceServerAction from "../RaceServerAction";

const RACE = "race-1";
const URL1 = "https://commissaire.us/share/tok";
const Where = () => <span data-testid="where">{useLocation().pathname + useLocation().search}</span>;
const show = () =>
  render(
    <MemoryRouter initialEntries={["/race/race-1"]}>
      <Routes>
        <Route path="*" element={<><RaceServerAction raceUuid={RACE} raceName="Test" /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
const onServer = (owner = true) => {
  live.state.user = { id: "u1" };
  live.state.access = { [RACE]: { isOwner: owner } };
  live.linked.add(RACE);
};

beforeEach(() => {
  live.state = { user: null, publishErrors: {}, access: {}, sync: {}, socketConnected: true, online: true };
  live.linked.clear();
  live.saveRaceToServer.mockReset();
  live.shareLink.mockReset();
  live.setRacePublished.mockReset();
});

describe("Info server panel: upload", () => {
  it("signed out: 'Sign in to upload' goes to the account page and back to the race", async () => {
    show();
    await userEvent.click(screen.getByTestId("race-upload-btn"));
    expect(live.saveRaceToServer).not.toHaveBeenCalled();
    expect(screen.getByTestId("where")).toHaveTextContent(`/account?next=${encodeURIComponent(`/race/${RACE}`)}`);
  });

  it("signed in: uploads once; the button is disabled while uploading (no double upload)", async () => {
    live.state.user = { id: "u1" };
    let resolve!: (v: string) => void;
    live.saveRaceToServer.mockImplementation(() => new Promise<string>((r) => (resolve = r)));
    show();
    const btn = screen.getByTestId("race-upload-btn");
    expect(btn).toHaveTextContent("Upload Race to Server");
    await userEvent.click(btn);
    expect(screen.getByTestId("race-upload-btn")).toBeDisabled();
    expect(screen.getByTestId("race-upload-btn")).toHaveTextContent("Uploading…");
    await userEvent.click(screen.getByTestId("race-upload-btn"));
    expect(live.saveRaceToServer).toHaveBeenCalledTimes(1);
    live.linked.add(RACE);
    live.shareLink.mockResolvedValue({ url: URL1, published: false });
    live.state.access = { [RACE]: { isOwner: true } };
    resolve("srv-1");
    await waitFor(() => expect(screen.getByTestId("race-server-action")).toHaveAttribute("data-state", "on-server"));
  });

  it("failure: shows the reason and offers Retry upload", () => {
    live.state.user = { id: "u1" };
    live.state.publishErrors = { [RACE]: "No connection to the server" };
    show();
    expect(screen.getByTestId("race-upload-error")).toHaveTextContent("No connection to the server");
    expect(screen.getByTestId("race-upload-btn")).toHaveTextContent("Retry upload");
  });
});

describe("Info server panel: on server + Share Race", () => {
  it("shows the sync state; sending and offline are explicit", () => {
    onServer();
    live.shareLink.mockReturnValue(new Promise(() => {}));
    live.state.sync = { [RACE]: { pending: 2 } };
    const { unmount } = show();
    expect(screen.getByTestId("race-sync-state")).toHaveTextContent("Sending 2 change(s)");
    unmount();
    live.state.socketConnected = false;
    show();
    expect(screen.getByTestId("race-sync-state")).toHaveTextContent("Offline · 2 change(s) waiting");
  });

  it("owner: one red 'Not published' button; its modal publishes, the button turns green", async () => {
    onServer();
    live.shareLink.mockResolvedValue({ url: URL1, published: false });
    live.setRacePublished.mockImplementation(async (_id: string, p: boolean) => ({ url: URL1, published: p }));
    show();
    const status = await screen.findByTestId("race-publish-status");
    await waitFor(() => expect(status).toHaveAttribute("data-state", "off"));
    expect(status).toHaveTextContent("Not published");
    expect(screen.queryByTestId("race-publish-modal")).not.toBeInTheDocument();
    await userEvent.click(status);
    expect(screen.getByTestId("race-publish-modal")).toBeInTheDocument();
    expect(live.shareLink).toHaveBeenCalledTimes(1); // the modal reuses the loaded state
    expect(screen.getByTestId("race-share-copy")).toBeDisabled();
    await userEvent.click(screen.getByTestId("race-share-publish"));
    await waitFor(() => expect(screen.getByTestId("race-share-status")).toHaveTextContent("Published"));
    expect(live.setRacePublished).toHaveBeenCalledWith(RACE, true);
    expect(screen.getByTestId("race-share-copy")).toBeEnabled();
    expect(screen.getByTestId("race-share-url")).toHaveValue(URL1);
    expect(screen.getByTestId("race-publish-status")).toHaveAttribute("data-state", "on");
    expect(screen.getByTestId("race-publish-status")).toHaveTextContent("Published");
    await userEvent.click(screen.getByTestId("race-share-publish"));
    await waitFor(() => expect(screen.getByTestId("race-publish-status")).toHaveAttribute("data-state", "off"));
  });

  it("owner: status can't be read → neutral button; the modal shows the error with Retry", async () => {
    onServer();
    live.shareLink.mockRejectedValueOnce(new Error("Server unavailable")).mockResolvedValue({ url: URL1, published: true });
    show();
    await waitFor(() => expect(screen.getByTestId("race-publish-status")).toHaveAttribute("data-state", "error"));
    await userEvent.click(screen.getByTestId("race-publish-status"));
    await waitFor(() => expect(screen.getByTestId("race-publish-status")).toHaveAttribute("data-state", "on"));
  });

  it("member who is not the owner: no Share controls", () => {
    onServer(false);
    show();
    expect(screen.getByTestId("race-server-action")).toHaveAttribute("data-state", "on-server");
    expect(screen.queryByTestId("race-publish-status")).not.toBeInTheDocument();
    expect(live.shareLink).not.toHaveBeenCalled();
  });
});
